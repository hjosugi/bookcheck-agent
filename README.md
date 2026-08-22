# bookcheck-agent

Amazon Nova、Bedrock AgentCore、Next.js、DynamoDB を一つのリポジトリで
管理する polyglot monorepo です。書籍第13章のコードと強化版フロントエンドを、
ローカル実行・テスト・AWS デプロイまで同じルートから操作できます。

## 構成

```text
app/                         Next.js App Router（Web UI + API）
agent/
  agentcore/                 AgentCore の宣言設定
  app/BookChecker/           Python / Strands エージェント（uv）
infra/                       DynamoDB と IAM の AWS CDK
test/                        Web アプリの Vitest
package.json                 Bun の共通コマンド
compose.yml                  Docker 用ローカルサービス
compose.podman.yml           rootless Podman 用ローカルサービス
```

JavaScript/TypeScript はルートの `package.json` と `bun.lock`、Python は
`agent/app/BookChecker/pyproject.toml` と `uv.lock` で固定します。`infra/` は
Bun workspace に含まれるため、ルートの一回の install で依存関係が揃います。

## 最初のセットアップ

AWS CLI v2 の導入と認証は [AWS_SETUP.md](AWS_SETUP.md) の手順を先に実行します。
その後、リポジトリルートで依存関係を導入します。

```bash
bun run setup
cp .env.local.example .env.local
cp agent/app/BookChecker/.env.example agent/app/BookChecker/.env
```

ローカルサービスとアプリを起動します。

```bash
bun run dcc:up
bun run agent:local
# 別のターミナル
bun run dev
```

DynamoDB テーブルを最初に作るコマンドは [LOCAL_DEV.md](LOCAL_DEV.md) にあります。

## 主なコマンド

| コマンド                      | 内容                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `bun run setup`               | Bun workspace と Python uv 環境をセットアップ        |
| `bun run dcc:up` / `dcc:down` | Docker または Podman のローカルサービスを起動 / 停止 |
| `bun run dev`                 | Next.js をローカル起動                               |
| `bun run agent:local`         | Python エージェントをポート 8080 で起動              |
| `bun run agent:validate`      | AgentCore 設定を検証                                 |
| `bun run agent:deploy`        | ローカルの Python コードを AgentCore へデプロイ      |
| `bun run check`               | format、lint、型検査、Web/infra テスト               |

エージェントの既定モデルは Amazon Nova Pro
`us.amazon.nova-pro-v1:0` です。変更する場合は
`agent/app/BookChecker/.env` の `BEDROCK_MODEL_ID` を設定します。

## ドキュメント

| ファイル                                                           | 内容                                  |
| ------------------------------------------------------------------ | ------------------------------------- |
| [LOCAL_DEV.md](LOCAL_DEV.md)                                       | Docker / Podman でのローカル開発      |
| [agent/app/BookChecker/README.md](agent/app/BookChecker/README.md) | Python エージェントの起動とデプロイ   |
| [AWS_SETUP.md](AWS_SETUP.md)                                       | AWS CLI、Nova 確認、CDK デプロイ      |
| [TESTING.md](TESTING.md)                                           | テストの対象と実行方法                |
| [HANDSON.md](HANDSON.md)                                           | 書籍第13章の再構成手順                |
