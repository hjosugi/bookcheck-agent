// Pure transforms over the chat message list.
//
// The streaming turn rewrites this list on every event, and those rewrites
// are the fiddly part of the chat: completing a spinner, reusing the last
// status row, dropping placeholder bubbles. Keeping them here as pure
// functions makes each one small and testable without a DOM.

// One chat bubble or one status badge.
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStatus?: boolean
  statusText?: string
  statusCompleted?: boolean
  authUrl?: string
  interrupted?: boolean
}

const TOOL_LABELS: Record<string, string> = {
  browser: 'Webブラウザ',
  add_calendar_event: 'カレンダー登録',
}

export function toolDisplayName(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName
}

/** Turn every still-spinning status row into a finished one. */
export function completeActiveStatus(messages: Message[]): Message[] {
  return messages.map(m =>
    m.isStatus && !m.statusCompleted
      ? { ...m, statusCompleted: true, statusText: 'ツール実行完了' }
      : m,
  )
}

/** Relabel spinning status rows, leaving them spinning. */
function relabelActiveStatus(messages: Message[], statusText: string): Message[] {
  return messages.map(m => (m.isStatus && !m.statusCompleted ? { ...m, statusText } : m))
}

export function setContent(messages: Message[], id: string, content: string): Message[] {
  return messages.map(m => (m.id === id ? { ...m, content } : m))
}

export function markInterrupted(messages: Message[], id: string): Message[] {
  return messages.map(m => (m.id === id ? { ...m, interrupted: true } : m))
}

export function removeMessages(messages: Message[], ids: string[]): Message[] {
  return messages.filter(m => !ids.includes(m.id))
}

/** Drop assistant bubbles that never received any text. */
export function dropEmptyAssistant(messages: Message[]): Message[] {
  return messages.filter(m => !(m.role === 'assistant' && !m.isStatus && !m.content.trim()))
}

/** Close open statuses, then start a fresh assistant bubble. */
export function startAssistantMessage(messages: Message[], id: string, content: string): Message[] {
  return [...completeActiveStatus(messages), { id, role: 'assistant', content }]
}

export function appendAuthPrompt(messages: Message[], id: string, authUrl: string): Message[] {
  return [
    ...relabelActiveStatus(messages, 'Google連携を待機中…'),
    {
      id,
      role: 'assistant',
      content: 'Googleアカウントの接続が必要です。下のボタンをクリックしてください。',
      authUrl,
    },
  ]
}

/**
 * Show "<tool> を実行中…".
 *
 * Consecutive tool calls with no text between them reuse the last status row
 * instead of stacking spinners. `placeholderId` is the assistant bubble that
 * was opened for text that never arrived; it is dropped.
 */
export function upsertToolStatus(
  messages: Message[],
  options: { displayName: string; placeholderId: string; newStatusId: string },
): Message[] {
  const { displayName, placeholderId, newStatusId } = options
  const statusText = `${displayName} を実行中…`

  const kept = messages.filter(m => !(m.id === placeholderId && !m.content && !m.isStatus))
  const lastStatusIdx = kept.findLastIndex(m => m.isStatus)
  const hasTextAfterStatus =
    lastStatusIdx !== -1 && kept.slice(lastStatusIdx + 1).some(m => !m.isStatus && m.content)

  if (lastStatusIdx !== -1 && !hasTextAfterStatus) {
    return kept.map((m, i) =>
      i === lastStatusIdx ? { ...m, statusText, statusCompleted: false } : m,
    )
  }
  return [
    ...kept,
    {
      id: newStatusId,
      role: 'assistant',
      content: '',
      isStatus: true,
      statusText,
      statusCompleted: false,
    },
  ]
}
