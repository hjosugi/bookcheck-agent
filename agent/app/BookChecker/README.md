# BookChecker agent

Amazon Nova Pro を利用する Strands / AgentCore エージェントです。

## ローカル起動

リポジトリルートから実行します。

```bash
cp agent/app/BookChecker/.env.example agent/app/BookChecker/.env
bun run agent:sync
bun run agent:local
```

既定モデルは `us.amazon.nova-pro-v1:0` です。別の Amazon Nova
モデルを利用する場合は `.env` の `BEDROCK_MODEL_ID` を変更します。

## AgentCore へデプロイ

Python コードはローカルからデプロイできます。Container build のため、
AgentCore CLI が CodeBuild でイメージを構築し、ECR と AgentCore Runtime
へ反映します。

```bash
bun run agent:validate
bun run agent:deploy
bun run agent:status
```

ブラウザ機能が Playwright を使うため、`CodeZip` ではなく
`Container` を使用します。
