'use client'

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type SubmitEvent,
} from 'react'
import { actorIdFromToken, getAuthToken } from '../lib/auth-token'
import {
  consumeRateToken,
  loadHistory,
  registerAuthToken,
  saveMessage,
  type MessageKind,
} from '../lib/chat-api'
import {
  appendAuthPrompt,
  completeActiveStatus,
  dropEmptyAssistant,
  markInterrupted,
  removeMessages,
  setContent,
  startAssistantMessage,
  toolDisplayName,
  upsertToolStatus,
  type Message,
} from '../lib/chat-messages'
import { createReplyBuffer, type ReplyBuffer } from '../lib/reply-buffer'
import { streamAgent, type AgentEvent } from '../hooks/use-agent-stream'
import { MessageList } from './message-list'
import type { SessionSummary } from './sidebar'

const AGENT_ARN = process.env.NEXT_PUBLIC_AGENT_ARN

type Emit = Dispatch<SetStateAction<Message[]>>

function onText(event: Extract<AgentEvent, { type: 'text' }>, buffer: ReplyBuffer, emit: Emit) {
  if (!event.data) return
  const content = buffer.append(event.data)

  if (!buffer.needsNewMessage) {
    emit(prev => setContent(prev, buffer.currentMessageId, content))
    return
  }
  const id = crypto.randomUUID()
  buffer.startMessage(id)
  emit(prev => startAssistantMessage(prev, id, content))
}

function onToolUse(
  event: Extract<AgentEvent, { type: 'tool_use' }>,
  buffer: ReplyBuffer,
  emit: Emit,
) {
  const placeholderId = buffer.currentMessageId
  buffer.endMessage()
  emit(prev =>
    upsertToolStatus(prev, {
      displayName: toolDisplayName(event.tool_name || 'ツール'),
      placeholderId,
      newStatusId: crypto.randomUUID(),
    }),
  )
}

function onAuthUrl(
  event: Extract<AgentEvent, { type: 'auth_url' }>,
  buffer: ReplyBuffer,
  emit: Emit,
) {
  if (!event.url) return
  buffer.endMessage()
  const id = crypto.randomUUID()
  buffer.adoptMessage(id)
  emit(prev => appendAuthPrompt(prev, id, event.url))
}

/** Route one stream event to its handler. */
function createEventHandler(buffer: ReplyBuffer, emit: Emit) {
  return (event: AgentEvent) => {
    switch (event.type) {
      case 'text':
        return onText(event, buffer, emit)
      case 'tool_use':
        return onToolUse(event, buffer, emit)
      case 'tool_result':
        return emit(completeActiveStatus)
      case 'auth_url':
        return onAuthUrl(event, buffer, emit)
      case 'error':
        return
      default:
        return unhandled(event)
    }
  }
}

function unhandled(event: never): void {
  console.warn('unknown agent event', event)
}

interface Props {
  // Null until the first message creates a session.
  session: SessionSummary | null
  ensureSession: () => Promise<SessionSummary>
  // Tells the parent to refresh the sidebar order and title.
  onSessionTouched: () => void
}

export function Chat({ session, ensureSession, onSessionTouched }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [canResume, setCanResume] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load history for the selected session.
  // The parent remounts this component when the user switches sessions,
  // so history only needs loading once, for the session present at mount.
  // Reading session?.sessionId on every render instead would re-enter here
  // when the first message creates a session, wiping the streaming reply.
  const [mountedSessionId] = useState(() => session?.sessionId ?? null)
  useEffect(() => {
    if (!mountedSessionId) return
    let cancelled = false
    void (async () => {
      try {
        const stored = await loadHistory(mountedSessionId)
        if (cancelled) return
        setMessages(
          stored.map(m => ({
            id: crypto.randomUUID(),
            role: m.role,
            content: m.content,
            interrupted: m.kind === 'partial',
          })),
        )
      } catch {
        if (!cancelled) setNotice('履歴の読み込みに失敗しました。')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mountedSessionId])

  // Persistence failure must not break the chat. Show a notice only.
  const persist = useCallback(
    async (
      token: string,
      sessionId: string,
      role: 'user' | 'assistant',
      content: string,
      kind: MessageKind = 'normal',
    ) => {
      try {
        await saveMessage(token, sessionId, role, content, kind)
        onSessionTouched()
      } catch {
        setNotice('メッセージの保存に失敗しました。表示は継続します。')
      }
    },
    [onSessionTouched],
  )

  // An interrupted turn stores its last segment as partial so the history
  // can mark it on reload.
  const persistReply = useCallback(
    async (token: string, sessionId: string, segments: string[], interrupted: boolean) => {
      const pending = [...segments]
      const partial = interrupted ? pending.pop() : undefined
      for (const segment of pending) {
        await persist(token, sessionId, 'assistant', segment)
      }
      if (partial !== undefined) {
        await persist(token, sessionId, 'assistant', partial, 'partial')
      }
    },
    [persist],
  )

  async function sendPrompt(text: string) {
    setNotice(null)
    setCanResume(false)
    setLoading(true)

    // Optimistic bubbles. They show before any network call.
    const userMsgId = crypto.randomUUID()
    const replyMsgId = crypto.randomUUID()
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: text },
      { id: replyMsgId, role: 'assistant', content: '' },
    ])
    const buffer = createReplyBuffer(replyMsgId)

    try {
      const token = await getAuthToken()
      const active = session ?? (await ensureSession())

      const rate = await consumeRateToken(token)
      if (!rate.allowed) {
        setNotice(`送信が多すぎます。約${rate.retryAfterSec}秒後にもう一度お試しください。`)
        setMessages(prev => removeMessages(prev, [userMsgId, replyMsgId]))
        setInput(text)
        return
      }

      void persist(token, active.sessionId, 'user', text)
      await registerAuthToken(token)

      const result = await streamAgent({
        agentArn: AGENT_ARN,
        token,
        prompt: text,
        sessionId: active.sessionId,
        actorId: actorIdFromToken(token),
        onEvent: createEventHandler(buffer, setMessages),
      })
      buffer.flush()

      const interrupted = result.status === 'interrupted'
      if (interrupted) {
        setNotice('接続が中断されました。')
        setCanResume(true)
        setMessages(prev => markInterrupted(prev, buffer.currentMessageId))
      }
      await persistReply(token, active.sessionId, buffer.finishedSegments(), interrupted)
    } catch {
      setNotice('エラーが発生しました。もう一度お試しください。')
    } finally {
      setLoading(false)
      setMessages(dropEmptyAssistant)
    }
  }

  const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    await sendPrompt(text)
  }

  // Ask the agent to continue after an interruption.
  // The AgentCore session id is stable, so short-term memory
  // still holds the context on the backend.
  const handleResume = async () => {
    if (loading) return
    setCanResume(false)
    await sendPrompt('先ほどの応答が途中で切れました。続きから簡潔に再開してください。')
  }

  return (
    <div className="app">
      <header className="header">
        <h1>新刊チェッカー</h1>
        <p>技術書の新刊を調べて、Googleカレンダーに登録します</p>
      </header>

      {notice && (
        <div className="notice-bar">
          <span>{notice}</span>
          {canResume && (
            <button className="resume-button" onClick={handleResume}>
              続きを再開
            </button>
          )}
        </div>
      )}

      <MessageList messages={messages} endRef={endRef} />

      <form className="input-area" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="メッセージを入力…"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? '⏳' : '送信'}
        </button>
      </form>
    </div>
  )
}
