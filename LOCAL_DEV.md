# ローカル開発手順

ローカルでは Cognito と AgentCore Runtime を使わず、Next.js、Python
エージェント、DynamoDB Local を直接起動します。モデル呼び出しだけは
Amazon Bedrock の Amazon Nova Pro を使うため、AWS 認証情報が必要です。

## 構成

```text
localhost:3000   Next.js（UI + Route Handlers）
localhost:8080   Python エージェント（uv）
localhost:8000   DynamoDB Local（Docker / Podman）
localhost:8001   dynamodb-admin
                 Amazon Bedrock（Amazon Nova Pro）
```

## 1. 前提ツール

- Node.js 20.9 以上
- Bun
- Python 3.12 以上と uv
- Docker、または Podman + Compose provider
- AWS CLI v2

Arch Linux / CachyOS では AWS CLI v2 を `paru` で導入します。

```bash
paru -S --needed aws-cli-v2
aws --version
aws configure
aws sts get-caller-identity
```

他の OS は [AWS_SETUP.md](AWS_SETUP.md) を参照してください。

## 2. 依存関係

リポジトリルートで実行します。Bun workspace と Python の uv 環境を
まとめてセットアップします。

```bash
bun run setup
```

`aws` がまだ無い場合、`setup:check` は警告だけを表示します。上の
インストール手順を実行してから Bedrock を呼び出してください。

## 3. 環境変数

```bash
cp .env.local.example .env.local
cp agent/app/BookChecker/.env.example agent/app/BookChecker/.env
```

既定値はローカル認証、DynamoDB Local、Next.js の同一オリジン proxy、
Amazon Nova Pro `us.amazon.nova-pro-v1:0` を使います。

## 4. DynamoDB Local

次のコマンドは Podman があれば `compose.podman.yml`、無ければ
Docker の `compose.yml` を自動で選びます。

```bash
bun run dcc:up
bun run dcc:ps
```

Podman 用構成は完全修飾した `docker.io/` イメージ名、SELinux の `:Z`
ラベル、host network を使います。短縮名解決設定や rootless bridge
作成権限は不要です。

初回だけテーブルを作成します。DynamoDB Local は認証情報を検証しませんが、
AWS CLI が値を要求するためダミー値を設定します。

```bash
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_DEFAULT_REGION=us-east-1
export DYNAMO_ENDPOINT=http://127.0.0.1:8000
export DYNAMO_TABLE_NAME=bookchecker-app

aws dynamodb create-table \
  --endpoint-url "$DYNAMO_ENDPOINT" \
  --table-name "$DYNAMO_TABLE_NAME" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

管理画面は <http://localhost:8001> です。状態確認は次で行えます。

```bash
aws dynamodb describe-table \
  --endpoint-url "$DYNAMO_ENDPOINT" \
  --table-name "$DYNAMO_TABLE_NAME" \
  --query 'Table.TableStatus' \
  --output text
```

ローカルデータをすべて消して作り直す場合だけ、次を実行した後、上の
`create-table` を再実行します。

```bash
aws dynamodb delete-table \
  --endpoint-url "$DYNAMO_ENDPOINT" \
  --table-name "$DYNAMO_TABLE_NAME"

aws dynamodb wait table-not-exists \
  --endpoint-url "$DYNAMO_ENDPOINT" \
  --table-name "$DYNAMO_TABLE_NAME"
```

## 5. Python エージェント

2つ目のターミナルで起動します（`.env` の環境変数は `uv run --env-file` で自動読み込みされます）。

```bash
bun run agent:local
```

ローカルでは AgentCore Memory の ID と Google OAuth 設定が無ければ、
その2機能だけを自動で無効化します。Nova とブラウザツールは利用できます。

## 6. Next.js

3つ目のターミナルで起動します。

```bash
bun run dev
```

<http://localhost:3000> を開きます。黄色い `LOCAL MODE` バーが表示され、
送信、ストリーミング、履歴保存、リロード後の復元ができれば成功です。

## 日常コマンド

```bash
bun run dev          # Next.js
bun run agent:local  # Python agent
bun run dcc:up       # DynamoDB Local を起動
bun run dcc:down     # ローカルコンテナを停止
bun run dcc:logs     # コンテナログ
bun run test         # Web テスト
bun run check        # format + lint + types + Web/infra tests
```

## Oxc / VS Code

Oxc 拡張の ID は `oxc.oxc-vscode` です。リポジトリの
`.vscode/extensions.json` と `.vscode/settings.json` に推奨拡張と
保存時フォーマットを設定済みです。拡張導入後は
`Developer: Reload Window` を実行してください。

CLI はエディタ拡張に依存しません。

```bash
bun run fmt
bun run fmt:check
bun run lint
```

## クラウドへ移す

1. [AWS_SETUP.md](AWS_SETUP.md) の CDK コマンドで DynamoDB と IAM を作る
2. `bun run agent:validate` と `bun run agent:deploy` で Python を AgentCore へ送る
3. `LOCAL_AUTH`、`NEXT_PUBLIC_LOCAL_AUTH`、`DYNAMO_ENDPOINT`、
   `NEXT_PUBLIC_AGENT_LOCAL_URL` を本番環境へ渡さない
4. Cognito、DynamoDB、AgentCore ARN の環境変数を Amplify に設定する

## トラブルシューティング

| 症状                                | 確認                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| Podman が short-name を解決できない | `bun run dcc:up` を使い、`compose.podman.yml` が選ばれているか |
| `/api/sessions` が 401              | `.env.local` の `LOCAL_AUTH=1` を確認して Next.js を再起動     |
| `ResourceNotFoundException`         | この文書の `create-table` を実行                               |
| Agent が起動しない                  | `aws sts get-caller-identity` と `.env` のモデル ID を確認     |
| Bedrock が `AccessDeniedException`  | [AWS_SETUP.md](AWS_SETUP.md) の Nova 一覧と IAM 権限を確認     |
