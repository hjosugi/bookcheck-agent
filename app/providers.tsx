'use client'

import type { ReactNode } from 'react'
import { Amplify } from 'aws-amplify'
import { Authenticator, translations } from '@aws-amplify/ui-react'
import { I18n } from 'aws-amplify/utils'
import amplifyOutputs from '../amplify_outputs.json'
import '@aws-amplify/ui-react/styles.css'

Amplify.configure(amplifyOutputs)
I18n.putVocabularies(translations)
I18n.setLanguage('ja')

export function AuthProvider({ children }: { children: ReactNode }) {
  // hideSignUp は amplify/backend.ts の AllowAdminCreateUserOnly と対になっている。
  // ユーザープール側でセルフサインアップを閉じているので、タブを出しても
  // 「アカウントを作成」は必ず失敗する。出さないほうが親切。
  return <Authenticator hideSignUp>{children}</Authenticator>
}
