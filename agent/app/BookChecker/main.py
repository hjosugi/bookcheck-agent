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

MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
MEMORY_ID = os.getenv("MEMORY_BOOKCHECKERMEMORY_ID")

SYSTEM_PROMPT = """あなたは技術書の新刊情報を調べるアシスタントです。

## 手順
1. ブラウザで新刊カレンダー（https://www.sbcr.jp/calender/）にアクセス
2. 「PC/IT書籍」カテゴリでフィルタし、技術書の新刊一覧を取得
3. ユーザーの好みや指示に合う書籍を選ぶ
4. カレンダーツールが利用可能なら、ユーザーに確認してから発売日を登録

## ルール
- メモリーにユーザーの好みがあればレコメンドに利用する
- カレンダーの予定名は書籍タイトル、説明欄は著者と概要にする
- 終日予定として登録し、end_dateにはstart_dateの翌日を指定する
- Markdownの表は使わず、箇条書きで簡潔に回答する
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


@app.entrypoint
async def invoke(payload: dict[str, Any], context: Any):
    del context
    prompt = str(payload.get("prompt", ""))
    session_id = str(payload.get("session_id") or "local-session")
    actor_id = str(payload.get("actor_id") or "local-user")
    event_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    browser = AgentCoreBrowser()
    tools = [browser.browser]
    if calendar_is_configured():
        tools.append(make_calendar_tool(event_queue))

    agent = Agent(
        model=MODEL_ID,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        session_manager=create_session_manager(session_id, actor_id),
    )

    async def agent_stream() -> None:
        in_tool_use = False
        try:
            async for event in agent.stream_async(prompt):
                data = event.get("data")
                if isinstance(data, str):
                    if in_tool_use:
                        await event_queue.put({"type": "tool_result"})
                        in_tool_use = False
                    await event_queue.put({"type": "text", "data": data})
                elif "current_tool_use" in event:
                    if in_tool_use:
                        await event_queue.put({"type": "tool_result"})
                    tool_info = event["current_tool_use"]
                    await event_queue.put(
                        {
                            "type": "tool_use",
                            "tool_name": tool_info.get("name", ""),
                        }
                    )
                    in_tool_use = True
        except Exception as error:
            await event_queue.put({"type": "error", "data": str(error)})
        finally:
            if in_tool_use:
                await event_queue.put({"type": "tool_result"})
            await event_queue.put(None)

    task = asyncio.create_task(agent_stream())
    while True:
        item = await event_queue.get()
        if item is None:
            break
        yield item
    await task


if __name__ == "__main__":
    app.run()
