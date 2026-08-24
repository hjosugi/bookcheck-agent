import asyncio
import os
from typing import Any

import requests
from bedrock_agentcore.identity import requires_access_token
from strands import tool

PROVIDER_NAME = os.getenv("CREDENTIAL_PROVIDER_NAME")
CALLBACK_URL = os.getenv("CALLBACK_URL")
CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


def calendar_is_configured() -> bool:
    return bool(PROVIDER_NAME and CALLBACK_URL)


def _all_day_event(
    summary: str, start_date: str, end_date: str, description: str
) -> dict[str, Any]:
    return {
        "summary": summary,
        "description": description,
        "start": {"date": start_date},
        "end": {"date": end_date},
    }


def _insert_event(access_token: str, event: dict[str, Any]) -> dict[str, Any]:
    """Blocking call. Run it off the event loop."""
    response = requests.post(
        CALENDAR_API,
        headers={"Authorization": f"Bearer {access_token}"},
        json=event,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


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
        event = _all_day_event(summary, start_date, end_date, description)

        @requires_access_token(
            provider_name=PROVIDER_NAME,
            scopes=CALENDAR_SCOPES,
            auth_flow="USER_FEDERATION",
            on_auth_url=on_auth_url,
            callback_url=CALLBACK_URL,
        )
        async def call_api(access_token: str = "") -> dict[str, Any]:
            return await asyncio.to_thread(_insert_event, access_token, event)

        try:
            result = await call_api()
        except requests.RequestException as error:
            return f"カレンダー登録に失敗しました: {error}"

        title = result.get("summary", summary)
        date = result.get("start", {}).get("date", start_date)
        return f"カレンダーに登録しました: {title} ({date})"

    return add_calendar_event
