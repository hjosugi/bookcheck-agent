import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
} from '@aws-sdk/client-bedrock-agentcore'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from '../../../lib/verify-token'

const client = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
})

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return new NextResponse('session_idが未指定です', { status: 400 })
  }

  // Google redirects the browser here as a top-level navigation, so there is
  // no Authorization header to read. The cookie set by /api/set-token carries
  // the Cognito access token instead, and it is verified here rather than
  // trusted for being present: this handler calls AWS on the app's own IAM
  // role, so it must never run for a visitor who is not signed in.
  const cookieStore = await cookies()
  const token = cookieStore.get('agentcore_user_token')?.value ?? ''
  const user = await verifyAccessToken(token)
  if (!user) {
    return new NextResponse('ログインが必要です', { status: 401 })
  }

  try {
    await client.send(
      new CompleteResourceTokenAuthCommand({
        sessionUri: sessionId,
        userIdentifier: { userToken: token },
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return new NextResponse(`Google連携エラー: ${message}`, { status: 500 })
  }

  return new NextResponse(
    '<!doctype html><html lang="ja"><meta charset="utf-8"><body style="text-align:center;padding:60px;font-family:sans-serif"><p>Google連携が完了しました。タブを閉じてください。</p></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
