import asyncio
import os
from typing import Any

import requests
from bedrock_agentcore.identity import requires_access_token
from strands import tool

PROVIDER_NAME = os.getenv("CREDENTIAL_PROVIDER_NAME")
CALLBACK_URL = os.getenv("CALLBACK_URL")
CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


def calendar_is_configured() -> bool:
    return bool(PROVIDER_NAME and CALLBACK_URL)


def make_calendar_tool(event_queue: asyncio.Queue[dict[str, Any] | None]):
    if not calendar_is_configured():
        raise RuntimeError(
            "CREDENTIAL_PROVIDER_NAME and CALLBACK_URL are required for Calendar"
        )

    async def on_auth_url(url: str) -> None:
        await event_queue.put({"type": "auth_url", "url": url})

    @tool
    async def add_calendar_event(
        summary: str,
        start_date: str,
        end_date: str,
        description: str = "",
    ) -> str:
        """Google Calendarに終日予定を追加する。

        Args:
            summary: 予定のタイトル
            start_date: 開始日（YYYY-MM-DD形式）
            end_date: 終了日（YYYY-MM-DD形式、開始日の翌日）
            description: 予定の詳細説明
        """

        @requires_access_token(
            provider_name=PROVIDER_NAME,
            scopes=CALENDAR_SCOPES,
            auth_flow="USER_FEDERATION",
            on_auth_url=on_auth_url,
            callback_url=CALLBACK_URL,
        )
        async def call_api(access_token: str = "") -> dict[str, Any]:
            event = {
                "summary": summary,
                "description": description,
                "start": {"date": start_date},
                "end": {"date": end_date},
            }

            def post_event() -> dict[str, Any]:
                response = requests.post(
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    headers={"Authorization": f"Bearer {access_token}"},
                    json=event,
                    timeout=30,
                )
                response.raise_for_status()
                return response.json()

            return await asyncio.to_thread(post_event)

        try:
            result = await call_api()
        except requests.RequestException as error:
            return f"カレンダー登録に失敗しました: {error}"

        title = result.get("summary", summary)
        date = result.get("start", {}).get("date", start_date)
        return f"カレンダーに登録しました: {title} ({date})"

    return add_calendar_event
