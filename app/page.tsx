'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAuthToken } from './lib/auth-token'
import { Sidebar, type SessionSummary } from './components/sidebar'
import { Chat } from './components/chat'

async function authedFetch(path: string, init?: RequestInit) {
  const token = await getAuthToken()
  return fetch(path, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  })
}

export default function Page() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [newChatNonce, setNewChatNonce] = useState(0)

  const fetchSessions = useCallback(async (): Promise<SessionSummary[]> => {
    try {
      const res = await authedFetch('/api/sessions')
      if (!res.ok) return []
      const data = (await res.json()) as { sessions: SessionSummary[] }
      return data.sessions
    } catch {
      return []
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    setSessions(await fetchSessions())
  }, [fetchSessions])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await fetchSessions()
      if (!cancelled) setSessions(list)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchSessions])

  const createSession = useCallback(async (): Promise<SessionSummary> => {
    const res = await authedFetch('/api/sessions', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { session: SessionSummary }
    setSessions(prev => [data.session, ...prev])
    setActiveId(data.session.sessionId)
    return data.session
  }, [])

  const handleNew = () => {
    setActiveId(null)
    setNewChatNonce(n => n + 1)
    setSidebarOpen(false)
  }

  const handleSelect = (id: string) => {
    setActiveId(id)
    setSidebarOpen(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このチャットを削除しますか?')) return
    setBusy(true)
    try {
      await authedFetch(`/api/sessions/${id}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.sessionId !== id))
      if (activeId === id) setActiveId(null)
    } finally {
      setBusy(false)
    }
  }

  const activeSession = sessions.find(s => s.sessionId === activeId) ?? null

  return (
    <div className="shell">
      <button
        className="sidebar-toggle"
        aria-label="チャット一覧を開閉"
        onClick={() => setSidebarOpen(v => !v)}
      >
        ☰
      </button>

      <div className={`sidebar-wrap ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          busy={busy}
          onNew={handleNew}
          onSelect={handleSelect}
          onDelete={handleDelete}
        />
      </div>

      <main className="main">
        <Chat
          key={activeId ?? `new-${newChatNonce}`}
          session={activeSession}
          ensureSession={createSession}
          onSessionTouched={refreshSessions}
        />
      </main>
    </div>
  )
}
