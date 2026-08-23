# bookcheck-agent

技術書の新刊をエージェントがブラウザで調べ、選んだ本の発売日を
ユーザーの Google カレンダーに登録するアプリです。
Amazon Bedrock AgentCore + Next.js + DynamoDB。

書籍『Amazon Bedrock AgentCore 実践入門』第13章の構成をベースに、
マルチセッション永続化・SSE 堅牢化・レートリミット・サーバー側認証を
足した強化版です。**このドキュメント 1 本で、手元での実行から
production デプロイまで順番どおりに進められます。**

目安は、ローカル起動まで 30 分、production まで通しで 4〜5 時間です。

---

## 目次

|          |                                                                                                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 準備     | [1. 全体像](#1-全体像) / [2. 必要なもの](#2-必要なもの) / [3. 環境を用意する](#3-環境を用意する)                                                                                                                                                                                                                 |
| ローカル | [4. ローカルで動かす](#4-ローカルで動かす) / [5. テスト](#5-テスト)                                                                                                                                                                                                                                              |
| 本番     | [6. メモ帳を用意する](#6-メモ帳を用意する) / [7. Google 連携の準備](#7-google-連携の準備) / [8. AWS リソースを作る](#8-aws-リソースを作る) / [9. エージェントをデプロイ](#9-エージェントをデプロイ) / [10. Web アプリをデプロイ](#10-web-アプリをデプロイ) / [11. 結線](#11-結線) / [12. 動作確認](#12-動作確認) |
| その後   | [13. 運用](#13-運用) / [14. クリーンアップ](#14-クリーンアップ) / [トラブルシューティング](#トラブルシューティング)                                                                                                                                                                                              |
| 付録     | [A. コマンド一覧](#付録a-コマンド一覧) / [B. 設計メモ](#付録b-設計メモ) / [C. 書籍との対応](#付録c-書籍との対応)                                                                                                                                                                                                 |

---

## 1. 全体像

![全体の流れ](img/00-overview.svg)

![アーキテクチャ](img/01-architecture.svg)

### リポジトリ構成

```text
app/                         Next.js App Router（Web UI + Route Handlers）
  api/                       サーバー側 API
  components/ hooks/ lib/    UI とロジック
agent/
  agentcore/                 AgentCore の宣言設定
  app/BookChecker/           Python / Strands エージェント（uv）
amplify/                     Cognito 認証（Amplify Gen 2）
infra/                       DynamoDB と IAM の AWS CDK
test/                        Vitest
img/                         このドキュメントの図
handson-memo.txt             値のメモテンプレート
compose.yml                  Docker 用ローカルサービス
compose.podman.yml           rootless Podman 用
```

JavaScript/TypeScript はルートの `package.json` と `pnpm-lock.yaml`、Python は
`agent/app/BookChecker/pyproject.toml` と `uv.lock` で固定します。
`infra/` は pnpm workspace に含まれるので、ルートで一度 install すれば揃います。

### ローカルと本番の違い

|                   | ローカル               | 本番               |
| ----------------- | ---------------------- | ------------------ |
| 認証              | なし（`LOCAL_AUTH=1`） | Cognito            |
| エージェント      | `localhost:8080`       | AgentCore Runtime  |
| DB                | DynamoDB Local         | DynamoDB           |
| モデル            | Amazon Bedrock         | 同左               |
| Google カレンダー | 未設定なら自動で無効化 | AgentCore Identity |

ローカルでも **Bedrock だけは実際に呼ぶ**ので、AWS 認証情報が必要です。

---

## 2. 必要なもの

- [ ] 自分の AWS アカウント。作業リージョンはバージニア北部 `us-east-1`
- [ ] Bedrock のモデルアクセスで Amazon Nova Lite が有効
- [ ] Google アカウント（カレンダーの登録先）
- [ ] 手元に Node.js 20.9+ / pnpm / Python 3.12+ と uv / Docker か Podman / AWS CLI v2

---

## 3. 環境を用意する

### 3-1. AWS CLI v2 と認証

Arch Linux / CachyOS awscliのinstsall

```bash
paru -S --needed aws-cli-v2
```

他の OS は
[AWS 公式のインストール手順](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
に従ってください。

認証は `aws login` を使います。短期・自動ローテーションの認証情報が得られるので、
アクセスキーをディスクに置かずに済みます。

```bash
aws configure set region us-east-1
aws login
aws sts get-caller-identity
```

ブラウザが開けない環境では `aws login --remote` が使えます。

### 3-2. 依存関係

リポジトリルートで実行します。pnpm workspace と Python の uv 環境がまとめて入ります。

```bash
pnpm run setup
pnpm run setup:check
```

`agent/agentcore/cdk/` だけは pnpm workspace に含めていません。AgentCore CLI が
そのディレクトリで `npm install` を直接実行するためです。理由は
[`agent/agentcore/cdk/README.md`](agent/agentcore/cdk/README.md) に書いてあります。
このディレクトリは `agentcore` コマンドが面倒を見るので、手で触る必要はありません。

### 3-3. 設定ファイルを作る

`.env` と `aws-targets.json` は `.gitignore` に入っています（このリポジトリは
public なので、認証情報と AWS アカウント ID をコミットしないため）。
クローンしたら毎回この 3 行を実行してください。

```bash
cp .env.local.example .env.local
cp agent/app/BookChecker/.env.example agent/app/BookChecker/.env
cp agent/agentcore/aws-targets.example.json agent/agentcore/aws-targets.json
```

`aws-targets.json` の `account` を自分の 12 桁のアカウント ID に置き換えます。

```bash
aws sts get-caller-identity --query Account --output text
```

`000000000000` のままだと誤デプロイを防ぐために失敗します。

### 3-4. Bedrock のモデルアクセスを確認

読み取りだけのコマンドです。

```bash
aws bedrock list-foundation-models --region us-east-1 \
  --query "modelSummaries[?providerName=='Amazon' && contains(modelName,'Nova')].[modelName,modelId]" \
  --output table
```

空なら Bedrock コンソールで Amazon Nova のモデルアクセスを有効化します。
`AccessDeniedException` なら今の IAM 権限に読み取り権限がありません。

既定モデルは Amazon Nova Lite `us.amazon.nova-lite-v1:0` です。
変更するときは `agent/app/BookChecker/.env` の `BEDROCK_MODEL_ID` を書き換えます。

---

## 4. ローカルで動かす

Cognito と AgentCore Runtime を使わず、3 つのプロセスを直接立てます。

```text
localhost:3000   Next.js（UI + Route Handlers）
localhost:8080   Python エージェント
localhost:8000   DynamoDB Local
localhost:8001   dynamodb-admin
```

### 4-1. DynamoDB Local

Podman があれば `compose.podman.yml`、無ければ `compose.yml` を自動で選びます。

```bash
pnpm run dc:up
pnpm run dc:ps
```

初回のみテーブルを作成、AWS CLIはdummy設定。

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_DEFAULT_REGION=us-east-1 \
  aws dynamodb create-table \
    --endpoint-url http://127.0.0.1:8000 \
    --table-name bookchecker-app \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
    --key-schema \
      AttributeName=PK,KeyType=HASH \
      AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST
```

`ResourceInUseException: Cannot create preexisting table` が出たら、すでに作成済みなので次へ進む。

状態の確認と管理画面 <http://localhost:8001> はこちら。

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_DEFAULT_REGION=us-east-1 \
  aws dynamodb describe-table \
    --endpoint-url http://127.0.0.1:8000 \
    --table-name bookchecker-app \
    --query 'Table.TableStatus' --output text
```

作り直したいときだけ、削除してから上の `create-table` を再実行します。

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_DEFAULT_REGION=us-east-1 \
  aws dynamodb delete-table \
    --endpoint-url http://127.0.0.1:8000 --table-name bookchecker-app
```

### 4-2. エージェントと Next.js

別々のターミナルで起動します。

```bash
pnpm run agent:local   # 2 つ目のターミナル
pnpm run dev           # 3 つ目のターミナル
```

<http://localhost:3000> を開きます。黄色い `LOCAL MODE` バーが出て、送信・
ストリーミング・履歴保存・リロード後の復元ができれば成功です。

ローカルでは AgentCore Memory の ID と Google OAuth 設定が無ければ、
**その 2 機能だけ**を自動で無効化します。モデルとブラウザツールは使えます。

---

## 5. テスト

どちらもオフラインで数秒で終わります。AWS は呼びません。

```bash
pnpm run test        # アプリ 38 件
pnpm run infra:test  # CDK 8 件
pnpm run check       # format + lint + 型 + 上記すべて
```

### アプリのテスト（`test/`）

| ファイル                   | 対象                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `rate-limit.test.ts`       | トークンバケット: 補充、上限、楽観ロック、競合再試行、fail-closed |
| `use-agent-stream.test.ts` | SSE のチャンク跨ぎ解析、再試行ポリシー、URL 構築                  |
| `sessions-api.test.ts`     | Route Handler: 所有権分離、順序、バリデーション、タイトル付け     |
| `keys-and-auth.test.ts`    | キー構築（＝認可モデルそのもの）、ローカル認証モード              |

DynamoDB は `aws-sdk-client-mock` でモックしているので、戻り値ではなく
**送信されたコマンドそのもの**を検証します。`ConditionExpression` と
パーティション分離が壊れないのはこのためです。

とくに次の 3 つは黙って壊れやすいので、壊れたら必ず落ちるテストを置いています。

1. **SSE の行バッファリング** — 2 チャンクに分割されたイベントを落とさない
2. **最初の 1 バイト以降は再試行しない** — 盲目的な再接続はカレンダー登録を二重実行しうる
3. **キー構築による所有権** — 認可チェックを別に持たず、ユーザー ID をパーティションキーに含める

React コンポーネントのテストは意図的に書いていません。テストする価値のある
ロジックを `use-agent-stream.ts` と `lib/` に追い出してあるためです。

### インフラのテスト（`infra/test/`）

スタックをメモリ上で synth してテンプレートを検証します。prod はデータ保持、
dev は削除、IAM ポリシーにワイルドカードが無いこと、ロール名を渡したときだけ
アタッチされること、を守っています。

---

# ここから本番

以降はクラウドに作っていきます。**ローカルが動く状態まで来てから**進めてください。

## 6. メモ帳を用意する

このハンズオンの失敗の大半は「値の貼り間違い」です。先にメモ帳を開いてください。

```bash
cp handson-memo.txt handson-memo.local.txt
```

`*.local.txt` は `.gitignore` 済みなので、埋めた値が push されることはありません。

![値の対応マップ](img/02-value-map.svg)

| #   | 値                           | 生まれる場所                | 使う場所                 |
| --- | ---------------------------- | --------------------------- | ------------------------ |
| 1   | クレデンシャルプロバイダー名 | [7-5][memo1]                | ランタイム環境変数       |
| 2   | ランタイム ARN               | [9-1][memo2]                | Amplify 環境変数         |
| 3   | ランタイム ID                | [9-1][memo3] の ARN 末尾    | ワークロード ID 更新 CLI |
| 4   | Amplify ドメイン URL         | [10-1][memo4]               | コールバック URL の材料  |
| 5   | コールバック URL             | [10-1][memo5] で #4 に付す  | **2 か所**に設定         |
| 6   | Cognito ユーザープール ID    | [10-1][memo6]               | 検出 URL に埋め込む      |
| 7   | Cognito クライアント ID      | [10-1][memo7]               | 許可されたクライアント   |

センシティブな値なので、GitHub には絶対にプッシュしないでください。

---

## 7. Google 連携の準備

所要 30〜40 分。ブラウザ作業だけで、コードは書きません。

### なぜ先にこれをやるのか

エージェントは AWS の中で動きますが、書き込む先は**ユーザー個人の Google
カレンダー**です。AWS の IAM 権限では届きません。本人が Google の画面で
許可する必要があります。

![3LO 認可の流れ](img/03-3lo-sequence.svg)

この「本人に許可を取り、預かったトークンをエージェントに渡す」役目を担うのが
**AgentCore アイデンティティ**です。Google のクライアント ID とシークレットを
先に預けておくと、エージェント側は `@requires_access_token` を付けるだけで済みます。

ゴールは **プロバイダー名（[メモ #1][memo1]）を手に入れること**です。

### 7-1. Google Cloud プロジェクトを作る

<https://console.cloud.google.com/> を開き、プロジェクト選択メニュー →
「新しいプロジェクト」→ 名前を `bookchecker` にして作成。**課金の有効化は不要**です。

作成後、画面上部が `bookchecker` になっていることを必ず確認してください。
別プロジェクトのまま進めるのが最初のつまずきどころです。

### 7-2. Google Calendar API を有効にする

「APIとサービス」→「ライブラリ」→ `Google Calendar API` を検索 →「有効にする」。

忘れると、認可自体は通るのに**カレンダー登録の瞬間だけ 403** という、
切り分けの難しい失敗になります。

### 7-3. OAuth 同意画面を設定する

「APIとサービス」→「OAuth 同意画面」（新しい UI では「Google Auth Platform」）。

| 項目                            | 値               |
| ------------------------------- | ---------------- |
| User Type / 対象                | 外部（External） |
| アプリ名                        | `BookChecker`    |
| ユーザーサポートメール / 連絡先 | 自分のアドレス   |

忘れやすい設定が 2 つあります。

- **スコープ**: `https://www.googleapis.com/auth/calendar.events` を追加。
  `agent/app/BookChecker/calendar_tool.py` の `CALENDAR_SCOPES` と同じ値です
- **テストユーザー**: カレンダーを登録したい Google アカウントを追加。
  公開ステータスは「テスト」のままで構いませんが、ここに入っていないアカウントは
  認可画面で `access_denied` になります

### 7-4. OAuth クライアント ID を作る

「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。

| 項目                   | 値                         |
| ---------------------- | -------------------------- |
| アプリケーションの種類 | **ウェブアプリケーション** |
| 名前                   | `bookchecker-agentcore`    |

「承認済みのリダイレクト URI」はまだ分からないので、**空のまま作成**します。

**クライアント ID とシークレット**が表示されるのでメモ帳へ。
シークレットはダイアログを閉じると再表示できません（発行し直しは可能）。

### 7-5. AgentCore にクレデンシャルプロバイダーを登録する

AWS マネジメントコンソールが `us-east-1` であることを確認し、
Amazon Bedrock AgentCore →「アイデンティティ」→「OAuth クライアント/API キー」→
「OAuth クライアントを追加」。

| 項目                           | 値                                                 |
| ------------------------------ | -------------------------------------------------- |
| 名前                           | `google-oauth-client`（**これが メモ #1**）        |
| プロバイダータイプ             | Google                                             |
| クライアント ID / シークレット | 7-4 の値                                           |

名前はあとで環境変数に一字一句そのまま貼るので、記号やスペースを入れず、
控えた文字列と完全に一致させてください。

作成すると、**Google 側に登録すべきリダイレクト URI** が表示されます。
`https://bedrock-agentcore.us-east-1.amazonaws.com/identities/oauth2/callback`
のような形ですが、**画面に出た文字列をそのままコピー**してください。

### 7-6. Google 側にリダイレクト URI を登録する

Google Cloud の「認証情報」→ `bookchecker-agentcore` →
「承認済みのリダイレクト URI」→「URI を追加」→ 7-5 の URI を貼って保存。
反映に数分かかることがあります。

> この URI と、あとで出てくる**コールバック URL（[メモ #5][memo5]）は別物**です。
> [メモ #5][memo5] は自分の Amplify アプリの `/api/oauth2/callback` で、登録先は
> 「ランタイム環境変数」と「ワークロード ID」の 2 か所。
> 一方この URI は AgentCore 自身のもので、登録先は Google だけです。
> 混同すると [11. 結線](#11-結線) で必ず詰まります。

**チェックポイント**

- [ ] Google Calendar API が有効
- [ ] スコープに `calendar.events` がある
- [ ] テストユーザーに自分のアカウントが入っている
- [ ] AgentCore にプロバイダーができ、**名前を[メモ #1][memo1] に控えた**
- [ ] Google の承認済みリダイレクト URI に AgentCore の URI を保存した

---

## 8. AWS リソースを作る

DynamoDB テーブルと IAM ポリシーは `infra/`（AWS CDK）に定義済みです。
`dev` と `prod` が 1 アカウントに同居します。

|                            | dev                   | prod              |
| -------------------------- | --------------------- | ----------------- |
| テーブル名                 | `bookchecker-app-dev` | `bookchecker-app` |
| スタック削除時             | テーブルも削除        | テーブルは保持    |
| ポイントインタイムリカバリ | off                   | on                |
| セッション TTL             | 7 日                  | 90 日             |

違いは `infra/lib/env-config.ts` だけに書かれています。スタック側ではなくそこを直してください。

このスタックはdyanamoのみ作成

```bash
pnpm run infra:test
cd infra

export AWS_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION="$AWS_REGION"

pnpm exec cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION"
pnpm exec cdk diff -c env=prod
pnpm exec cdk deploy -c env=prod --require-approval any-change
```

`cdk diff` の出力を読んでから deploy してください。同じコマンドの再実行は安全です。

出力された `TableName` を控えます。`TableAccessPolicyArn` は
[11-1](#11-1-ssr-コンピュートロールを作る) で SSR ロールを作った後に
`-c ssrRoleName=bookchecker-ssr-role` を足して再実行すると自動でアタッチされます。

> 両環境ともオンデマンドなので、放置してもほぼ課金されません。
> このプロジェクトの費用は Bedrock の呼び出しと AgentCore ランタイムです。

---

## 9. エージェントをデプロイ

Python コードを AgentCore Runtime へ送ります。ローカルから実行できます。

```bash
pnpm run agent:validate
pnpm run agent:deploy
pnpm run agent:status
```

- 「CDK bootstrapping required」と出たら Enter
- 「Deploy to AWS Complete」で完了。7〜8 分かかります

裏では Python から Docker イメージがビルドされ、ECR を経由して
AgentCore ランタイムにデプロイされます。同時に AgentCore メモリーも作られます。

ブラウザツールが Playwright を使うため、ビルドは `CodeZip` ではなく
**`Container`** （ZIP 展開では実行権限が失われるため）。

### 9-1. ランタイム ARN を控える（メモ #2, #3）

AgentCore コンソール →「ランタイム」→ `agent_BookChecker` → 画面上部の
「ランタイム ARN」をコピーして メモ #2 へ。
ARN の `runtime/` 以降（例: `agent_BookChecker-XXXXXXXXXX`）が
メモ #3 のランタイム ID です。

### 9-2. ブラウザツール用の IAM 権限

**この節に手作業はありません。** 何が設定済みかの説明です。

`agentcore deploy` はランタイム実行ロールを作り、モデル呼び出し・ログ・メモリーの
権限を自動で付けます。ブラウザツールの権限はそこに含まれないので、
[`agent/agentcore/agentcore.json`](agent/agentcore/agentcore.json) の
`runtimes[].additionalPolicies` で 2 つのマネージドポリシーを足してあります。

```json
"additionalPolicies": [
  "arn:aws:iam::aws:policy/AmazonBedrockFullAccess",
  "arn:aws:iam::aws:policy/BedrockAgentCoreFullAccess"
]
```

デプロイのたびに CloudFormation が実行ロールへアタッチします。確認するなら:

```fish
set -l STACK AgentCore-BookcheckAgent-prod

set -l ROLE (aws cloudformation describe-stack-resources \
  --stack-name $STACK --region us-east-1 \
  --query "StackResources[?contains(LogicalResourceId,'RuntimeExecutionRole')].PhysicalResourceId" \
  --output text)

aws iam list-attached-role-policies --role-name $ROLE \
  --query "AttachedPolicies[].PolicyName" --output text
```

`AmazonBedrockFullAccess` と `BedrockAgentCoreFullAccess` が並べば正常です。

> どちらも範囲の広い AWS マネージドポリシーです。最小権限に寄せたいときは、
> `additionalPolicies` の要素を ARN ではなくポリシー JSON のパス
> （`codeLocation` からの相対）にすると、インラインポリシーとして付きます。

---

## 10. Web アプリをデプロイ

このリポジトリには Amplify Gen 2 の構成（`amplify/auth/resource.ts` と
`amplify.yml`）が入っているので、**このリポジトリをそのまま Amplify に繋げば
Cognito ごと作られます**。書籍のようにテンプレートから別リポジトリを作る必要はありません。

先に GitHub へ push しておきます。

AWS Amplify を開き、`us-east-1` にいることを確認して「アプリケーションをデプロイ」。

1. 「GitHub」を選んで認可し、Amplify GitHub App にこのリポジトリを許可
2. リポジトリと `main` ブランチを選択
3. 「詳細設定」で環境変数を追加

| キー                    | 値                               |
| ----------------------- | -------------------------------- |
| `NEXT_PUBLIC_AGENT_ARN` | [メモ #2][memo2] のランタイム ARN |
| `DYNAMO_TABLE_NAME`     | `bookchecker-app`                |
| `AWS_REGION`            | `us-east-1`                      |

4. 「保存してデプロイ」

Next.js が SSR モードで検出され、6〜7 分でビルドが終わります。

ビルド設定はリポジトリの [`amplify.yml`](amplify.yml) が使われるので、コンソール側で
編集する必要はありません。Amplify のビルドイメージに pnpm は入っていないため、
`preBuild` で `npm install -g pnpm@…` を実行しています。バージョンは
`package.json` の `packageManager` から引くので、pnpm を上げるときも
`amplify.yml` を触る必要はありません。

### ★ bun ではなく pnpm を使う理由

`ampx`（Amplify Gen 2 のバックエンド CLI）は **bun をサポートしていません**。
`ampx` は `npm_config_user_agent` 環境変数からパッケージマネージャーを判定し、
`npm` / `yarn` / `pnpm` 以外なら起動時点で落ちます。

```text
AmplifyError [UnsupportedPackageManagerError]: Package manager bun is not supported.
    resolution: 'Use npm, yarn, or pnpm.'
```

### 10-1. 値を 3 つ控える（メモ #4, #6, #7）

- **ドメイン URL**（メモ #4）: `https://main.xxxxxxxxxx.amplifyapp.com`
- `main` ブランチ →「デプロイされたバックエンドのリソース」→ `AWS::Cognito::UserPool`
  のリンクから Cognito コンソールへ
- **ユーザープール ID**（メモ #6）: 「ユーザープール情報」
- **クライアント ID**（メモ #7）: 左メニュー「アプリケーションクライアント」

ここで**コールバック URL**（メモ #5）も作ります。ドメイン URL にパスを足すだけです。

```text
https://main.xxxxxxxxxx.amplifyapp.com/api/oauth2/callback
```

[メモ #6][memo6] と [#7][memo7] が確定したら、Amplify の環境変数に `COGNITO_USER_POOL_ID` と
`COGNITO_CLIENT_ID` も追加します（全量は `.env.production.example` を参照）。

**チェックポイント**: ドメイン URL で Cognito のサインアップ画面が出ること。
チャットはまだ動きません。

---

## 11. 結線

★ ここが一番ミスが起きます。作業は 4 つです。

### 11-1. SSR コンピュートロールを作る

Route Handler が `CompleteResourceTokenAuth` を呼ぶので、Amplify のサーバー側に
IAM 権限が要ります。IAM →「ロール」→「ロールを作成」。

1. 「カスタム信頼ポリシー」を選び、JSON を次に置き換え

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "amplify.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

2. `BedrockAgentCoreFullAccess` をチェック
3. ロール名を `bookchecker-ssr-role` にして作成

Amplify コンソール →「アプリケーションの設定」→「IAM ロール」→
「コンピューティングロール」→「デフォルトのロール」でこれを選んで保存。

DynamoDB へのアクセス権は CDK から付けます。

```bash
cd infra
pnpm exec cdk deploy -c env=prod -c ssrRoleName=bookchecker-ssr-role --require-approval any-change
```

### 11-2. ランタイムの環境変数と JWT 認証

**コンソールでは設定しません。** ここで手入力すると、次の `agentcore deploy` で
CloudFormation に上書きされて消えます（[★ 再デプロイ時の落とし穴](#-再デプロイ時の落とし穴)）。
[`agent/agentcore/agentcore.json`](agent/agentcore/agentcore.json) に書いて
デプロイし直すのが正解です。

`CREDENTIAL_PROVIDER_NAME` は最初から入っているので、`envVars` に
`CALLBACK_URL` を足し、`authorizerType` と `authorizerConfiguration` を
新しく足します。

```jsonc
// agent/agentcore/agentcore.json の runtimes[0]
"envVars": [
  { "name": "CREDENTIAL_PROVIDER_NAME", "value": "google-oauth-client" },
  { "name": "CALLBACK_URL", "value": "<メモ#5>" }
],
"authorizerType": "CUSTOM_JWT",
"authorizerConfiguration": {
  "customJwtAuthorizer": {
    "discoveryUrl": "https://cognito-idp.us-east-1.amazonaws.com/<メモ#6>/.well-known/openid-configuration",
    "allowedClients": ["<メモ#7>"]
  }
}
```

```bash
pnpm run agent:validate
pnpm run agent:deploy
```

これで Cognito でログインしたユーザーだけがエージェントを呼べます。
`MEMORY_BOOKCHECKERMEMORY_ID` は CDK が自動で注入するので、書く必要はありません。

> `AWS` で始まる名前の環境変数は AgentCore が受け付けません
> （`Environment variables cannot start with the reserved prefix "AWS"`）。
> リージョンはランタイムが `AWS_REGION` を用意するので、書く必要はありません。

> [メモ #6][memo6] と [#7][memo7] はブラウザに配られる公開識別子で秘密ではありませんが、
> このリポジトリは public なので、Cognito のセルフサインアップは
> [`amplify/backend.ts`](amplify/backend.ts) で閉じてあります。
> ユーザーの作り方は [12. 動作確認](#12-動作確認)を参照。

### 11-3. ワークロード ID に許可 URL を登録

コールバック URL は**もう 1 か所**、AgentCore アイデンティティのワークロード ID
にも必要です。コンソールからは設定できないので CLI で行います。

```bash
aws bedrock-agentcore-control update-workload-identity \
  --name <メモ#3 のランタイムID> \
  --allowed-resource-oauth2-return-urls <メモ#5 のコールバックURL>
```

`<>` は書かず、値だけを入れます。

### 11-4. Google Cloud 側の確認

新しい作業ではなく [7-6](#7-6-google-側にリダイレクト-uri-を登録する) の確認です。
Google の「認証情報」→ `bookchecker-agentcore` に、**AgentCore 自身の URI** が
保存されているかを見てください。[メモ #5][memo5] をここに入れてしまう取り違えが多いです。

**結線の最終確認**

- [ ] コールバック URL が「ランタイム環境変数」と「ワークロード ID」で**完全に同じ文字列**
- [ ] 検出 URL のユーザープール ID が[メモ #6][memo6] と一致
- [ ] 許可されたクライアントが[メモ #7][memo7] と一致
- [ ] Amplify のコンピューティングロールが設定済み

---

## 12. 動作確認

### 12-1. 自分のアカウントを作る

このリポジトリは public なので、Cognito のセルフサインアップは
[`amplify/backend.ts`](amplify/backend.ts) で閉じてあります
（`AdminCreateUserConfig.AllowAdminCreateUserOnly`）。ログイン画面にも
サインアップのタブは出ません。利用者は CLI から作ります。

メールアドレスを 3 か所に書くことになるので、先に変数に入れます（fish）。

```fish
set -l POOL_ID us-east-1_xxxxxxxxx   # メモ #6
set -l EMAIL you@example.com

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username $EMAIL \
  --user-attributes Name=email,Value=$EMAIL Name=email_verified,Value=true \
  --region us-east-1
```

仮パスワードが記載された招待メールが届きます。初回ログインで新しい
パスワードを求められるので、そこで設定してください。

家族や同僚に使ってもらうときは、`$EMAIL` を入れ替えて同じコマンドを人数分。
やめてもらうときは削除します。

```fish
aws cognito-idp admin-delete-user \
  --user-pool-id $POOL_ID \
  --username $EMAIL \
  --region us-east-1
```

いま誰が使えるかは一覧で確認できます。

```fish
aws cognito-idp list-users \
  --user-pool-id $POOL_ID \
  --region us-east-1 \
  --query "Users[].[Username,UserStatus]" --output table
```

bash や zsh を使っているときは `set -l NAME value` を `NAME=value` に、
`# コメント` を行末から外して読み替えてください。

### 12-2. 動かしてみる

ドメイン URL にアクセスします。

1. 12-1 のアカウントでログイン
2. 例:「私は AI に興味があります。来月の技術書の新刊をチェックして、
   面白そうなものを1つ選んでカレンダーに入れて」

| #   | 起きること                                                       |
| --- | ---------------------------------------------------------------- |
| 1   | ブラウザツールで新刊カレンダーにアクセスし、PC/IT 書籍を読む     |
| 2   | 技術書を選び、登録してよいか確認してくる                         |
| 3   | 「はい」で Google 連携ボタンが表示される                         |
| 4   | ボタンから Google 認可へ（「確認されていません」警告は「続行」） |
| 5   | 連携完了ページが出たらタブを閉じてチャットに戻る                 |
| 6   | エージェントが自動で登録を続行し、完了メッセージが出る           |
| 7   | Google カレンダーに実際に予定が入っている                        |

一度連携するとトークンがキャッシュされるので、しばらくはボタンが出ずに直接登録が走ります。

### メモリーの動作

- **短期記憶**: 続けて「他におすすめの本は?」と送ると、直前の提示を覚えている
- **長期記憶**: リロードしてから「私の好みに基づいて新しい書籍をおすすめして」と送る。
  セッションは変わるが、同じ Cognito ユーザーなら過去の好みを踏まえた応答が返る

---

## 13. 運用

### トレースとログ

AgentCore CLI でデプロイしたアプリは自動で CloudWatch にトレースを送ります。

AgentCore →「ランタイム」→ `agent_BookChecker` →「DEFAULT」エンドポイントの
「ダッシュボード」→ CloudWatch の生成 AI オブザーバビリティ →「トレース」。
スパンの階層で各ステップの処理時間とトークン数が見えます。

トレースはエージェントが**正常起動した場合だけ**記録されます。起動自体に失敗したときは
「DEFAULT」エンドポイントの「ログ」から CloudWatch Logs を見てください。
コンテナ起動ごとにログストリームが分かれるので、「すべてのログストリームを検索」が早いです。

### ★ 再デプロイ時の落とし穴

`agentcore deploy` は CloudFormation でランタイムを宣言的に更新します。つまり
**コンソールで手入力した環境変数とインバウンド認証は、デプロイのたびに消えます**。
テンプレートに出てくる `EnvironmentVariables` は `agentcore.json` の `envVars` と
CDK が注入する `MEMORY_*` だけ、`AuthorizerConfiguration` に至ってはプロパティごと
存在しない（＝ `AWS_IAM` に戻る）ためです。

なので設定は必ず [`agent/agentcore/agentcore.json`](agent/agentcore/agentcore.json)
に書きます（[11-2](#11-2-ランタイムの環境変数と-jwt-認証)）。そうしておけば
再デプロイしても勝手に消えません。

**スタックを削除して作り直した場合**は、ランタイムが別物になるので追加で必要です。

| 順  | やること                                                                             |
| --- | ------------------------------------------------------------------------------------ |
| 1   | `agentcore deploy`                                                                   |
| 2   | [9-1](#9-1-ランタイム-arn-を控えるメモ-2-3) で ARN / ID を控え直す（値が変わります） |
| 3   | [11-3](#11-3-ワークロード-id-に許可-url-を登録) を新しいランタイム ID でやり直す     |
| 4   | Amplify の `NEXT_PUBLIC_AGENT_ARN` を新しい ARN に更新して再デプロイ                 |

[9-2](#9-2-ブラウザツール用の-iam-権限を足す) と
[11-2](#11-2-ランタイムの環境変数と-jwt-認証) は `agentcore.json` 側にあるので不要です。
[メモ #1][memo1] のクレデンシャルプロバイダーはスタック管理外なので残ります。
ただし AgentCore メモリーは作り直しになるため、それまでの会話と好みは消えます。

フロントエンドの修正は GitHub に push するだけで Amplify が自動再デプロイします。

### ★ public リポジトリで運用する

このリポジトリは public です。デプロイ先の URL や Cognito の ID は
（`agentcore.json` からも Amplify のビルド成果物からも）人目に触れる前提で、
**知られても踏み込めない**ようにしてあります。

| 入口                                     | 誰が通れるか                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| ログイン画面                             | 管理者が `admin-create-user` で作ったユーザーだけ（[12-1](#12-1-自分のアカウントを作る)） |
| チャット（AgentCore Runtime を直接叩く） | ランタイムのインバウンド JWT 認証（[11-2](#11-2-ランタイムの環境変数と-jwt-認証)）        |
| `/api/sessions` `/api/rate-check`        | `requireUser` が Cognito アクセストークンを検証                                           |
| `/api/set-token`                         | 受け取ったトークンを検証してから Cookie に入れる                                          |
| `/api/oauth2/callback`                   | Cookie のトークンを検証（存在チェックだけでは通さない）                                   |

`/api/oauth2/callback` は Google からのリダイレクトで戻ってくるので
`Authorization` ヘッダーが付きません。だから Cookie を見ますが、**中身の JWT を
検証**します。ここは AgentCore を Amplify 側の IAM ロールで呼ぶハンドラーなので、
未ログインの訪問者に実行させてはいけません。

`LOCAL_AUTH` による認証バイパスは
[`app/lib/verify-token.ts`](app/lib/verify-token.ts) で
`NODE_ENV !== 'production'` を条件にしてあり、production ビルドでは
環境変数に何を入れても有効になりません。

コミットしない値は `.gitignore` にまとめてあります（`.env*`、
`aws-targets.json`、`handson-memo.local.txt`）。

### エージェントの暴走対策

ページ構造が変わると、モデルが同じ操作を延々と繰り返すことがあります。
`AGENT_MAX_TURNS`（既定 15）でループ回数に上限を設けてあり、超えると
「中断した」と明示して止まります。推測で答えを埋めないよう、
システムプロンプトでも禁止しています。

---

## 14. クリーンアップ

すべてサーバーレスなので放置しても大きな課金はありません。ただし
このアプリは URL を知っていれば誰でも利用登録できます。終わったら消してください。

1. **AgentCore**: ランタイム `agent_BookChecker` / 自動作成されたメモリー /
   アイデンティティのクレデンシャルプロバイダー
2. **Amplify アプリ**: アプリケーションの設定 → 全般設定 →「アプリの削除」
3. **ECR リポジトリ**: `agent/bookchecker`
4. **CDK スタック**: `cd infra && pnpm exec cdk destroy -c env=prod`
   （prod はテーブルを保持する設計なので、データは残ります。消すのは別作業です）
5. **Google Cloud プロジェクト**: 不要なら「IAM と管理」→「設定」からシャットダウン

これらを消しても、11-1 で作った IAM ロールや `agentcore deploy` が自動作成した
IAM ロール・ロググループ・CodeBuild プロジェクトは残ります。課金は発生しませんが、
気になる場合は各コンソールから手動で削除してください。

---

## トラブルシューティング

まず疑うのは**手順の抜けか、入力値の誤字**です。前から順に見直すのが結局いちばん速いです。

### ローカル

| 症状                                                        | 確認                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResourceNotFoundException`                                 | [4-1](#4-1-dynamodb-local) の `create-table` を実行したか                                                                                                   |
| `InvalidClientTokenId` / `aws login` したのに認証が通らない | ダミー認証情報がシェルに残っている。fish は `set -e AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN`、bash は `unset`。新しいシェルを開いてもよい |
| `ResourceInUseException` (create-table)                     | テーブル作成済み。無視して次へ                                                                                                                              |
| `/api/sessions` が 401                                      | `.env.local` の `LOCAL_AUTH=1` を確認して Next.js を再起動                                                                                                  |
| Podman が short-name を解決できない                         | `pnpm run dc:up` を使い、`compose.podman.yml` が選ばれているか                                                                                              |
| エージェントが起動しない                                    | `aws sts get-caller-identity` と `.env` のモデル ID                                                                                                         |
| Bedrock が `AccessDeniedException`                          | [3-4](#3-4-bedrock-のモデルアクセスを確認) のモデルアクセスと IAM 権限                                                                                      |
| 保存時フォーマットが効かない                                | oxc 拡張は起動時に `node_modules` の oxfmt を探すので、`pnpm install` 後に `Developer: Reload Window`                                                       |

### 本番

| 症状                                                                             | 確認                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 「考え中…」のまま返らない                                                        | Amplify とランタイム両方の環境変数。JWT のユーザープール ID / クライアント ID が[メモ #6][memo6] [#7][memo7] と一致しているか |
| エージェントがブラウザを使えない                                                 | ランタイム実行ロールに 2 つのポリシー（[9-2](#9-2-ブラウザツール用の-iam-権限を足す)）                                      |
| Google 連携に失敗する                                                            | [メモ #5][memo5] がランタイム環境変数とワークロード ID の**2 か所**に同じ値で入っているか                                    |
| カレンダー登録だけ 403                                                           | Google Calendar API が有効か、テストユーザーに自分が入っているか                                                            |
| ビルドが失敗する                                                                 | Amplify の `main` ブランチのカードから「ビルド」「デプロイ」ログ                                                            |
| Amplify の `backend` フェーズが `Package manager bun is not supported.` で落ちる | `ampx` は bun を受け付けません。`amplify.yml` が `pnpm exec ampx` を使っているか（[10](#10-web-アプリをデプロイ)）          |
| Amplify が `pnpm: command not found`（exit 127）                                 | コンソール側のビルド設定がリポジトリの [`amplify.yml`](amplify.yml) を上書きしていないか。pnpm は `preBuild` で入れています |

エラーの原因が分からないときは、コードとエラーメッセージを添えて AI に聞くのが速いです
（機密情報は送らないこと）。AgentCore と Strands はアップデートが速いので、
公式ドキュメントの URL を渡すか公式 MCP サーバーを設定して最新情報を参照させてください。
チャット画面からエージェント自身に「今どこでエラーが起きていますか?」と聞くのも効きます。

---

## 付録A コマンド一覧

| コマンド                                                    | 内容                                           |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `pnpm run setup`                                            | pnpm workspace と Python uv 環境をセットアップ |
| `pnpm run setup:check`                                      | 必要なツールが揃っているか確認                 |
| `pnpm run dev`                                              | Next.js をローカル起動                         |
| `pnpm run agent:local`                                      | Python エージェントをポート 8080 で起動        |
| `pnpm run dc:up` / `dc:down` / `dc:ps` / `dc:logs`          | ローカルコンテナ                               |
| `pnpm run test` / `test:watch` / `test:cov`                 | アプリのテスト                                 |
| `pnpm run fmt` / `fmt:check` / `lint` / `typecheck`         | 整形と静的検査                                 |
| `pnpm run check`                                            | 上記すべて + infra テスト                      |
| `pnpm run agent:validate` / `agent:deploy` / `agent:status` | AgentCore                                      |
| `pnpm run infra:test` / `infra:synth:dev` / `infra:check`   | CDK                                            |

---

## 付録B 設計メモ

書籍版に対して足した部分と、その理由です。

### DynamoDB シングルテーブル

所有権をパーティションキーに埋め込んでいます。

| アイテム       | PK                  | SK                |
| -------------- | ------------------- | ----------------- |
| セッション     | `USER#{sub}`        | `SESSION#{id}`    |
| メッセージ     | `USER#{sub}#S#{id}` | `MSG#{ts}#{rand}` |
| レートバケット | `USER#{sub}`        | `RATE`            |

- セッション一覧: PK = `USER#{sub}`、SK が `SESSION#` で始まる Query
- 履歴読み込み: PK = `USER#{sub}#S#{id}` を昇順 Query
- レート確認: バケットの Get + 条件付き Put

**認可チェックのクエリを別に持たない**のがポイントです。他人のデータは
キーの作り方の時点で到達できません。

### 主な変更点

1. **マルチセッション UI** — セッションとメッセージを DynamoDB に永続化。
   リロードしても履歴が残る
2. **AgentCore セッション ID の安定化** — 書籍はタブごとに新規発行するが、
   ここでは DynamoDB に保持するのでリロードしても短期記憶が生き残る
3. **SSE の堅牢化** — チャンクを跨いだ行をバッファする。再接続は最初の 1 バイト
   より前だけ。それ以降はツールの二重実行を招くので停止して「再開」ボタンを出す
4. **レートリミット** — DynamoDB のトークンバケット。ユーザーあたりバースト 10、
   毎分 10 補充。楽観ロックで 2 タブの競合を処理
5. **サーバー側認証** — 全 Route Handler が `aws-jwt-verify` で Cognito の
   アクセストークンを検証
6. **Markdown 表示** — GFM のテーブルと安全なリンク

### ストリームの経路

ストリームは今もブラウザから AgentCore へ**直接**繋いでいます。
Next.js を経由させれば `Last-Event-ID` による真の再開ができますが、
ホップが 1 つ増え、サーバー側でのバッファリングが必要になります。

真の再開を実装するなら、(1) Route Handler でストリームを中継し、
(2) 各 SSE イベントに ID を振って DynamoDB に追記し、
(3) 再接続時に `Last-Event-ID` から再生してからライブに繋ぐ、という形になります。
代償はレイテンシ、ストレージ費用、バックプレッシャー処理です。

---

## 付録C 書籍との対応

このリポジトリには**コードがすべて実装済み**です。書籍をなぞって
ゼロから書く場合の対応表です。

| 書籍                                 | このリポジトリ                                                 |
| ------------------------------------ | -------------------------------------------------------------- |
| 13.1〜13.2 Google / アイデンティティ | [7. Google 連携の準備](#7-google-連携の準備)                   |
| 13.3.1 `agentcore create`            | `agent/agentcore/agentcore.json` に生成済み                    |
| 13.3.2〜13.3.3 カレンダーツール      | `agent/app/BookChecker/calendar_tool.py`                       |
| 13.3.4 エージェント本体              | `agent/app/BookChecker/main.py`                                |
| 13.3.5 デプロイ                      | [9. エージェントをデプロイ](#9-エージェントをデプロイ)         |
| 13.4.1〜13.4.3 フロント              | `app/`（強化版）                                               |
| 13.4.4 Route Handler 2 本            | `app/api/set-token/`、`app/api/oauth2/callback/`               |
| 13.4.5〜13.4.6 Amplify               | [10. Web アプリをデプロイ](#10-web-アプリをデプロイ)           |
| 13.4.7〜13.4.8 結線                  | [11. 結線](#11-結線)                                           |
| 13.5 確認・運用・片付け              | [12](#12-動作確認) / [13](#13-運用) / [14](#14-クリーンアップ) |

公式サンプル: <https://github.com/minorun365/agentcore-book/tree/main/chapter13>（MIT）

![キュー合流](img/04-queue.svg)

1. ツールを直接定義せず `make_calendar_tool(event_queue)` という**関数で生成**している。
   キューを閉じ込めるため
2. ツール関数が `async def` になっている。認可待ちの間もストリーミングを止めないため
3. `@requires_access_token` が `@tool` の**内側**にある。
   外側だとトークン引数が LLM に見えてしまうため

[memo1]: #7-5-agentcore-にクレデンシャルプロバイダーを登録する
[memo2]: #9-1-ランタイム-arn-を控えるメモ-2-3
[memo3]: #9-1-ランタイム-arn-を控えるメモ-2-3
[memo4]: #10-1-値を-3-つ控えるメモ-4-6-7
[memo5]: #10-1-値を-3-つ控えるメモ-4-6-7
[memo6]: #10-1-値を-3-つ控えるメモ-4-6-7
[memo7]: #10-1-値を-3-つ控えるメモ-4-6-7
