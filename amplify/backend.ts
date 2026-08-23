import { defineBackend } from '@aws-amplify/backend'
import { auth } from './auth/resource'

const backend = defineBackend({ auth })

// セルフサインアップを閉じる。
//
// このリポジトリは public で、Cognito のユーザープール ID とアプリクライアント ID は
// agentcore.json（README 11-2）と Amplify のビルド成果物の両方から見える。どちらも
// 元々ブラウザに配られる公開識別子なので秘密ではないが、サインアップが開いたままだと
// 見つけた人が誰でもアカウントを作り、エージェント経由で Bedrock とブラウザツールを
// 使えてしまう。課金はこちら持ちになる。
//
// 利用者は管理者が admin-create-user で作る。手順は README「12. 動作確認」を参照。
const { cfnUserPool } = backend.auth.resources.cfnResources
cfnUserPool.addPropertyOverride('AdminCreateUserConfig.AllowAdminCreateUserOnly', true)
