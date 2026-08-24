import asyncio
import os
from typing import Any

from bedrock_agentcore.memory.integrations.strands.config import (
    AgentCoreMemoryConfig,
    RetrievalConfig,
)
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands_tools.browser import AgentCoreBrowser

from calendar_tool import calendar_is_configured, make_calendar_tool

MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.amazon.nova-lite-v1:0")
MEMORY_ID = os.getenv("MEMORY_BOOKCHECKERMEMORY_ID")

# Hard cap on agent loop turns. Without it the model can retry a failing
# browser selector indefinitely: one observed run made 80+ browser calls
# with identical reasoning before giving up and inventing a book.
MAX_TURNS = int(os.getenv("AGENT_MAX_TURNS", "15"))

LIMIT_NOTICE = (
    f"\n\n（操作が {MAX_TURNS} 回に達したので中断しました。"
    "ページの構造が変わっていて目的の情報にたどり着けていません。"
    "推測で埋めることはしないので、条件を変えてもう一度試してください。）"
)

SYSTEM_PROMPT = """あなたは技術書の新刊情報を調べるアシスタントです。

## 手順
1. browser の init_session でセッションを開く。session_name には
   `bookcheck-session` をそのまま使う
2. navigate で https://www.sbcr.jp/calender/ を開く
3. PC/IT書籍の一覧は id="pc" の要素に最初から入っている。タブをクリックする
   必要はない。evaluate で次のスクリプトをそのまま実行して一覧を取得する:
   JSON.stringify([...new Map([...document.querySelectorAll('#pc .schedule-list-box')].map(b=>[b.querySelector('.schedule-list-box__title')?.textContent.trim(),b.querySelector('.schedule-list-box__date')?.textContent.replace('発売日：','').trim()])).entries()])
4. ユーザーの好みや指示に合う書籍を選ぶ
5. カレンダーツールが利用可能なら、ユーザーに確認してから発売日を登録

## session_name の制約
`^[a-z0-9-]+$` の 10〜36 文字。日本語、大文字、アンダースコア、
9 文字以下はすべて拒否される。手順どおり `bookcheck-session` を使えば通る。
init_session は 1 回だけ。「already exists」と返ったらセッションは
使える状態なので、作り直さずそのまま navigate に進む。

## ルール
- メモリーにユーザーの好みがあればレコメンドに利用する
- カレンダーの予定名は書籍タイトル、説明欄は著者と概要にする
- 終日予定として登録し、end_dateにはstart_dateの翌日を指定する
- Markdownの表は使わず、箇条書きで簡潔に回答する

## やってはいけないこと
- 同じ操作を繰り返さない。同じ引数で2回失敗したらその方法は捨て、
  別の手段に切り替える。3回試して駄目なら諦めて報告する
- session_name を自分で考え直さない。失敗しても `bookcheck-session` のまま
  次の手順に進む
- ページから実際に読み取れた情報だけを答える。書名・著者・発売日を推測や
  記憶から補ってはいけない。取得できなかったときは「取得できなかった」と
  はっきり伝え、何が起きたかを説明する
"""

app = BedrockAgentCoreApp()


def create_session_manager(session_id: str, actor_id: str):
    if not MEMORY_ID:
        return None

    memory_config = AgentCoreMemoryConfig(
        memory_id=MEMORY_ID,
        session_id=session_id,
        actor_id=actor_id,
        retrieval_config={
            "/users/{actorId}/preferences": RetrievalConfig(),
        },
    )
    return AgentCoreMemorySessionManager(agentcore_memory_config=memory_config)


def build_agent(
    session_id: str,
    actor_id: str,
    event_queue: asyncio.Queue[dict[str, Any] | None],
) -> Agent:
    browser = AgentCoreBrowser()
    tools = [browser.browser]
    if calendar_is_configured():
        tools.append(make_calendar_tool(event_queue))

    return Agent(
        model=MODEL_ID,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        session_manager=create_session_manager(session_id, actor_id),
    )


def translate_event(
    event: dict[str, Any], in_tool_use: bool
) -> tuple[list[dict[str, Any]], bool]:
    """Map one Strands event to UI events.

    Returns the events to emit and whether a tool is still running. A tool
    that was running is closed with tool_result before anything else, so the
    spinner in the UI never outlives its tool.
    """
    close = [{"type": "tool_result"}] if in_tool_use else []

    data = event.get("data")
    if isinstance(data, str):
        return close + [{"type": "text", "data": data}], False

    if "result" in event:
        if getattr(event["result"], "stop_reason", "") == "limit_turns":
            return close + [{"type": "text", "data": LIMIT_NOTICE}], False
        return [], in_tool_use

    if "current_tool_use" in event:
        tool_info = event["current_tool_use"]
        return close + [{"type": "tool_use", "tool_name": tool_info.get("name", "")}], True

    return [], in_tool_use


async def pump_agent(
    agent: Agent,
    prompt: str,
    event_queue: asyncio.Queue[dict[str, Any] | None],
) -> None:
    """Drain the agent stream into the queue. None marks the end."""
    in_tool_use = False
    try:
        async for event in agent.stream_async(prompt, limits={"turns": MAX_TURNS}):
            print(f"[DEBUG] agent_stream: event={event}")
            emitted, in_tool_use = translate_event(event, in_tool_use)
            for item in emitted:
                await event_queue.put(item)
    except Exception as error:
        await event_queue.put({"type": "error", "data": str(error)})
    finally:
        if in_tool_use:
            await event_queue.put({"type": "tool_result"})
        await event_queue.put(None)


@app.entrypoint
async def invoke(payload: dict[str, Any], context: Any):
    del context
    prompt = str(payload.get("prompt", ""))
    session_id = str(payload.get("session_id") or "local-session")
    actor_id = str(payload.get("actor_id") or "local-user")

    event_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    agent = build_agent(session_id, actor_id, event_queue)
    task = asyncio.create_task(pump_agent(agent, prompt, event_queue))

    while True:
        item = await event_queue.get()
        if item is None:
            break
        yield item
    await task


if __name__ == "__main__":
    app.run()
