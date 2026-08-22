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
  return <Authenticator>{children}</Authenticator>
}
