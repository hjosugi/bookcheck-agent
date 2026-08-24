'use client'

import type { RefObject } from 'react'
import { Markdown } from './markdown'
import type { Message } from '../lib/chat-messages'

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-icon">📖</div>
      <p>気になる技術書のジャンルや、</p>
      <p>登録したい予定を教えてください</p>
    </div>
  )
}

function StatusRow({ message }: { message: Message }) {
  return (
    <div className="message-row assistant">
      <div className={`status-badge ${message.statusCompleted ? 'completed' : 'active'}`}>
        {message.statusCompleted ? (
          <span className="check-icon">&#10003;</span>
        ) : (
          <span className="spinner" />
        )}
        <span>{message.statusText}</span>
      </div>
    </div>
  )
}

function AssistantBubble({ message }: { message: Message }) {
  if (!message.content) return <span className="shimmer-text">考え中…</span>
  return (
    <>
      <Markdown content={message.content} />
      {message.interrupted && <span className="interrupted-tag">中断</span>}
      {message.authUrl && (
        <a href={message.authUrl} target="_blank" rel="noopener noreferrer" className="auth-button">
          Google連携を開始 →
        </a>
      )}
    </>
  )
}

function MessageRow({ message }: { message: Message }) {
  if (message.isStatus) return <StatusRow message={message} />
  return (
    <div className={`message-row ${message.role}`}>
      <div className={`bubble ${message.role} ${message.interrupted ? 'interrupted' : ''}`}>
        {message.role === 'assistant' ? <AssistantBubble message={message} /> : message.content}
      </div>
    </div>
  )
}

interface Props {
  messages: Message[]
  endRef: RefObject<HTMLDivElement | null>
}

export function MessageList({ messages, endRef }: Props) {
  return (
    <div className="messages">
      {messages.length === 0 && <EmptyState />}
      {messages.map(m => (
        <MessageRow key={m.id} message={m} />
      ))}
      <div ref={endRef} />
    </div>
  )
}
