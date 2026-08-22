'use client'

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { actorIdFromToken, getAuthToken } from '../lib/auth-token'
import { Markdown } from './markdown'
import { streamAgent, type AgentEvent } from '../hooks/use-agent-stream'
import type { SessionSummary } from './sidebar'

const AGENT_ARN = process.env.NEXT_PUBLIC_AGENT_ARN

// One chat bubble or one status badge.
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStatus?: boolean
  statusText?: string
  statusCompleted?: boolean
  authUrl?: string
  interrupted?: boolean
}

function toolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    browser: 'Webブラウザ',
    add_calendar_event: 'カレンダー登録',
  }
  return names[toolName] || toolName
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
  // The parent remounts this component when the session changes
  // (key={activeId}), so there is no state to reset here.
  const sessionId = session?.sessionId
  useEffect(() => {
    if (!sessionId) return

    let cancelled = false
    ;(async () => {
      try {
        const token = await getAuthToken()
        const res = await fetch(`/api/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as {
          messages: { role: 'user' | 'assistant'; content: string; kind?: string }[]
        }
        if (cancelled) return
        setMessages(
          data.messages.map(m => ({
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
  }, [sessionId])

  async function saveMessage(
    token: string,
    targetSessionId: string,
    role: 'user' | 'assistant',
    content: string,
    kind: 'normal' | 'partial' = 'normal',
  ) {
    // Persistence failure must not break the chat. Show a notice only.
    try {
      await fetch(`/api/sessions/${targetSessionId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role, content, kind }),
      })
      onSessionTouched()
    } catch {
      setNotice('メッセージの保存に失敗しました。表示は継続します。')
    }
  }

  const handleSubmit = async (e: FormEvent) => {
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

  async function sendPrompt(text: string) {
    setNotice(null)
    setCanResume(false)
    setLoading(true)

    // Optimistic user bubble. It shows before any network call.
    const userMsgId = crypto.randomUUID()
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: text }])

    // Segments of assistant text finished in this turn.
    const finishedSegments: string[] = []

    let textAccumulator = ''
    let currentTextMsgId = crypto.randomUUID()
    let needNewTextMsg = false

    setMessages(prev => [...prev, { id: currentTextMsgId, role: 'assistant', content: '' }])

    try {
      const token = await getAuthToken()
      const active = session ?? (await ensureSession())

      // Rate limit gate. One prompt costs one token.
      const rate = await fetch('/api/rate-check', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (rate.status === 429) {
        const body = (await rate.json()) as { retryAfterSec?: number }
        setNotice(`送信が多すぎます。約${body.retryAfterSec ?? 5}秒後にもう一度お試しください。`)
        // Roll back the optimistic bubbles.
        setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== currentTextMsgId))
        setInput(text)
        return
      }

      // Persist the user message. Fire and forget.
      void saveMessage(token, active.sessionId, 'user', text)

      // Register the Cognito JWT for the 3LO callback (book 13.4.4).
      await fetch('/api/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {})

      const flushSegment = () => {
        if (textAccumulator.trim()) finishedSegments.push(textAccumulator)
        textAccumulator = ''
      }

      const onEvent = (event: AgentEvent) => {
        if (event.type === 'text' && event.data) {
          textAccumulator += event.data
          if (needNewTextMsg) {
            currentTextMsgId = crypto.randomUUID()
            needNewTextMsg = false
            setMessages(prev => [
              ...prev.map(m =>
                m.isStatus && !m.statusCompleted
                  ? { ...m, statusCompleted: true, statusText: 'ツール実行完了' }
                  : m,
              ),
              { id: currentTextMsgId, role: 'assistant', content: textAccumulator },
            ])
          } else {
            setMessages(prev =>
              prev.map(m => (m.id === currentTextMsgId ? { ...m, content: textAccumulator } : m)),
            )
          }
        } else if (event.type === 'tool_use') {
          flushSegment()
          needNewTextMsg = true
          const displayName = toolDisplayName(event.tool_name || 'ツール')
          setMessages(prev => {
            const filtered = prev.filter(
              m => !(m.id === currentTextMsgId && !m.content && !m.isStatus),
            )
            const lastStatusIdx = filtered.findLastIndex(m => m.isStatus)
            const hasTextAfterStatus =
              lastStatusIdx !== -1 &&
              filtered.slice(lastStatusIdx + 1).some(m => !m.isStatus && m.content)
            if (lastStatusIdx !== -1 && !hasTextAfterStatus) {
              return filtered.map((m, i) =>
                i === lastStatusIdx
                  ? { ...m, statusText: `${displayName} を実行中…`, statusCompleted: false }
                  : m,
              )
            }
            return [
              ...filtered,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                isStatus: true,
                statusText: `${displayName} を実行中…`,
                statusCompleted: false,
              },
            ]
          })
        } else if (event.type === 'tool_result') {
          setMessages(prev =>
            prev.map(m =>
              m.isStatus && !m.statusCompleted
                ? { ...m, statusCompleted: true, statusText: 'ツール実行完了' }
                : m,
            ),
          )
        } else if (event.type === 'auth_url' && event.url) {
          flushSegment()
          currentTextMsgId = crypto.randomUUID()
          needNewTextMsg = true
          setMessages(prev => [
            ...prev.map(m =>
              m.isStatus && !m.statusCompleted ? { ...m, statusText: 'Google連携を待機中…' } : m,
            ),
            {
              id: currentTextMsgId,
              role: 'assistant',
              content: 'Googleアカウントの接続が必要です。下のボタンをクリックしてください。',
              authUrl: event.url,
            },
          ])
        }
      }

      const result = await streamAgent({
        agentArn: AGENT_ARN,
        token,
        prompt: text,
        sessionId: active.sessionId,
        actorId: actorIdFromToken(token),
        onEvent,
      })

      flushSegment()

      if (result.status === 'interrupted') {
        // Save what arrived, mark it, and offer a resume.
        setNotice('接続が中断されました。')
        setCanResume(true)
        setMessages(prev =>
          prev.map(m => (m.id === currentTextMsgId ? { ...m, interrupted: true } : m)),
        )
        if (finishedSegments.length > 0) {
          const partial = finishedSegments.pop()!
          for (const seg of finishedSegments) {
            await saveMessage(token, active.sessionId, 'assistant', seg)
          }
          await saveMessage(token, active.sessionId, 'assistant', partial, 'partial')
        }
      } else {
        for (const seg of finishedSegments) {
          await saveMessage(token, active.sessionId, 'assistant', seg)
        }
      }
    } catch {
      setNotice('エラーが発生しました。もう一度お試しください。')
    } finally {
      setLoading(false)
      setMessages(prev =>
        prev.filter(m => !(m.role === 'assistant' && !m.isStatus && !m.content.trim())),
      )
    }
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

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📖</div>
            <p>気になる技術書のジャンルや、</p>
            <p>登録したい予定を教えてください</p>
          </div>
        )}
        {messages.map(m => {
          if (m.isStatus) {
            return (
              <div key={m.id} className="message-row assistant">
                <div className={`status-badge ${m.statusCompleted ? 'completed' : 'active'}`}>
                  {m.statusCompleted ? (
                    <span className="check-icon">&#10003;</span>
                  ) : (
                    <span className="spinner" />
                  )}
                  <span>{m.statusText}</span>
                </div>
              </div>
            )
          }
          return (
            <div key={m.id} className={`message-row ${m.role}`}>
              <div className={`bubble ${m.role} ${m.interrupted ? 'interrupted' : ''}`}>
                {m.role === 'assistant' ? (
                  m.content ? (
                    <>
                      <Markdown content={m.content} />
                      {m.interrupted && <span className="interrupted-tag">中断</span>}
                      {m.authUrl && (
                        <a
                          href={m.authUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="auth-button"
                        >
                          Google連携を開始 →
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="shimmer-text">考え中…</span>
                  )
                ) : (
                  m.content
                )}
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

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
