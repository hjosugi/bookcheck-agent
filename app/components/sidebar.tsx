'use client'

// Session list. New chat, select, delete, sign out.
// On small screens the parent toggles visibility.

import { SignOutButton } from './sign-out'

export interface SessionSummary {
  sessionId: string
  title: string
  updatedAt: string
}

interface Props {
  sessions: SessionSummary[]
  activeId: string | null
  busy: boolean
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

export function Sidebar({ sessions, activeId, busy, onNew, onSelect, onDelete }: Props) {
  return (
    <aside className="sidebar">
      <button className="new-chat" onClick={onNew} disabled={busy}>
        + 新しいチャット
      </button>

      <nav className="session-list">
        {sessions.length === 0 && <p className="session-empty">まだチャットはありません</p>}
        {sessions.map(s => (
          <div
            key={s.sessionId}
            className={`session-item ${s.sessionId === activeId ? 'active' : ''}`}
          >
            <button
              className="session-title"
              onClick={() => onSelect(s.sessionId)}
              disabled={busy}
              title={s.title}
            >
              {s.title}
            </button>
            <button
              className="session-delete"
              aria-label="このチャットを削除"
              onClick={() => onDelete(s.sessionId)}
              disabled={busy}
            >
              ×
            </button>
          </div>
        ))}
      </nav>

      <SignOutButton />
    </aside>
  )
}
