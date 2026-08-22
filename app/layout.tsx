import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AppAuthProvider } from './auth-provider'
import './globals.css'
import './enhanced.css'

export const metadata: Metadata = {
  title: '新刊チェッカー',
  description: 'Amazon Nova と AgentCore で動く技術書エージェント',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <AppAuthProvider>{children}</AppAuthProvider>
      </body>
    </html>
  )
}
