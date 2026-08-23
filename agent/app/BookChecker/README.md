# BookChecker

Bedrock AgentCore Runtime 上で動く技術書チェック用エージェントです。
AgentCore Browser で新刊情報を調べ、選ばれた本の発売日を Google カレンダーへ登録します。

- `main.py` — AgentCore Runtime のエントリポイント（Strands Agent + AgentCore Memory）
- `calendar_tool.py` — AgentCore Identity 経由で Google Calendar に登録するツール
- `Dockerfile` — `Container` ビルド用。Playwright を使うため ZIP ではなくコンテナで配布します

セットアップ・ローカル実行・デプロイ手順はリポジトリルートの
[README.md](../../../README.md) にまとめてあります。

```bash
uv sync                          # 依存を入れる
uv run --env-file .env main.py   # ローカルで起動（ポート 8080）
```

このファイルは `pyproject.toml` の `readme` から参照されています。
削除するとコンテナビルドが `OSError: Readme file does not exist: README.md` で失敗します。
