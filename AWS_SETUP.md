# AWS_SETUP.md — provision AWS from your machine

Everything this delta needs in AWS is defined as code in `infra/`
(AWS CDK). You run it from your laptop. Two environments, `dev`
and `prod`, live side by side in one account.

## What the stack creates

| Resource                                                  | Why                                                      |
| --------------------------------------------------------- | -------------------------------------------------------- |
| DynamoDB table (`PK`/`SK`, on-demand, TTL on `expiresAt`) | sessions, messages, rate buckets                         |
| IAM managed policy                                        | exactly the six DynamoDB actions the Route Handlers call |

It deliberately does NOT create the AgentCore runtime, the
Amplify app, or Cognito. Those come from the book's hands-on, so
this stack can be deployed and destroyed without touching them.

## Environment differences

|                        | dev                   | prod              |
| ---------------------- | --------------------- | ----------------- |
| Table name             | `bookchecker-app-dev` | `bookchecker-app` |
| On stack delete        | table is deleted      | table is retained |
| Point-in-time recovery | off                   | on                |
| Session TTL policy     | 7 days                | 90 days           |

The whole difference lives in `infra/lib/env-config.ts`. Change
it there, not in the stack.

## One-time prerequisites

- AWS CLI v2
- Node 20+
- Bedrock model access enabled for Amazon Nova in your region

### AWS CLI v2 のインストール（Arch Linux / CachyOS）

`paru` からディストリビューションの最新版を導入します。これは OS
パッケージのインストールなので、sudo パスワードの入力が必要です。

```bash
paru -S --needed aws-cli-v2
aws --version
```

導入後、認証情報を設定します。

```bash
aws configure
aws sts get-caller-identity
```

AgentCore のデプロイ先も設定します。まず account ID を確認します。

```bash
aws sts get-caller-identity --query Account --output text
```

デプロイ先ファイルはテンプレートから作ります。

```bash
cp agent/agentcore/aws-targets.example.json agent/agentcore/aws-targets.json
```

`agent/agentcore/aws-targets.json` の `account` に、表示された12桁の値を入れます。
テンプレート内の `000000000000` は誤デプロイを防ぐためのプレースホルダーです。
リージョンを変更する場合は、同じファイルの `region` と以下で使う
`AWS_REGION` を揃えてください。

> `aws-targets.json` は `.gitignore` で追跡対象から外してあります。
> このリポジトリは public なので、AWS アカウント ID をコミットしないためです。
> 追跡されるのはプレースホルダー入りの `aws-targets.example.json` だけです。

Codespaces では `aws login --remote` も利用できます。Arch 系以外は
[AWS 公式の AWS CLI v2 インストール手順](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
に従ってください。

Check the installed tools and the AWS identity:

```bash
node --version
bun --version
uv --version
(podman --version || docker --version)
aws --version

export AWS_REGION=us-east-1
aws sts get-caller-identity
```

Check that the account can see an Amazon Nova model and call DynamoDB in
the selected region. These commands are read-only.

```bash
aws bedrock list-foundation-models \
  --region "$AWS_REGION" \
  --query "modelSummaries[?providerName == 'Amazon' && contains(modelName, 'Nova')].[modelName,modelId]" \
  --output table

aws dynamodb list-tables \
  --region "$AWS_REGION" \
  --output table
```

If the first table is empty, enable access to an Amazon Nova model in the
Bedrock console. An `AccessDeniedException` means the current AWS
identity is missing the corresponding read permission.

## Deploy

Run the following from the `bookcheck-agent` repository root. Install
the CDK dependencies, run the offline tests, and export the account
and region used by the stack.

```bash
bun install
bun run infra:test
cd infra

export AWS_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION="$AWS_REGION"

bunx cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION"
```

For the `dev` environment, inspect the changes before deploying:

```bash
bunx cdk diff -c env=dev
bunx cdk deploy -c env=dev --require-approval any-change
```

For `prod`, also pass the Amplify SSR role created in section 13.4.7:

```bash
bunx cdk diff \
  -c env=prod \
  -c ssrRoleName=bookchecker-ssr-role

bunx cdk deploy \
  -c env=prod \
  -c ssrRoleName=bookchecker-ssr-role \
  --require-approval any-change
```

Review the `cdk diff` output before running the matching deploy
command. CDK asks for confirmation when the change affects security.
Re-running the same commands is safe; CDK applies the difference.

If you skip the role name, the policy is created but not attached.
Attach `TableAccessPolicyArn` to the SSR role in the IAM console,
or re-run with the name.

## After deploying

Copy the stack outputs into the right place:

| Output                 | dev                                 | prod                   |
| ---------------------- | ----------------------------------- | ---------------------- |
| `TableName`            | `.env.local` -> `DYNAMO_TABLE_NAME` | Amplify env var        |
| `TableAccessPolicyArn` | not needed locally                  | attach to the SSR role |

See `.env.production.example` for the full production variable list.

## Teardown

From the `infra` directory, preview the resources affected and then
destroy the `dev` stack:

```bash
bunx cdk diff -c env=dev
bunx cdk destroy -c env=dev
```

`prod` retains the table by design, so destroying that stack
leaves the data behind. If you intentionally want to destroy the
stack while retaining its table, run:

```bash
bunx cdk diff -c env=prod
bunx cdk destroy -c env=prod
```

Deleting the retained production table is a separate destructive
operation and is not part of this procedure.

## Working on the infra itself

```bash
bun run infra:test
bun run infra:typecheck
bun run infra:synth:dev
cd infra
bunx cdk diff -c env=prod
```

The tests assert the things worth protecting: prod retains data,
dev does not, the policy never contains a wildcard action, and
the role attachment happens only when a role name is given. They
run offline in about five seconds.

## Cost

Both environments are on-demand DynamoDB, so an idle stack costs
effectively nothing. The spend in this project comes from Bedrock
model calls and the AgentCore runtime, not from this stack.
