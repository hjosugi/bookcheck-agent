import { describe, expect, it } from 'vitest'
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
} from '../app/lib/chat-messages'
import { createReplyBuffer } from '../app/lib/reply-buffer'

// These pin the list rewrites the streaming turn performs. They used to live
// inside a 166-line sendPrompt where nothing could reach them.

const text = (id: string, content: string): Message => ({ id, role: 'assistant', content })
const status = (id: string, completed: boolean): Message => ({
  id,
  role: 'assistant',
  content: '',
  isStatus: true,
  statusText: completed ? 'ツール実行完了' : '実行中…',
  statusCompleted: completed,
})

describe('toolDisplayName', () => {
  it('translates known tools and passes others through', () => {
    expect(toolDisplayName('browser')).toBe('Webブラウザ')
    expect(toolDisplayName('add_calendar_event')).toBe('カレンダー登録')
    expect(toolDisplayName('mystery_tool')).toBe('mystery_tool')
  })
})

describe('completeActiveStatus', () => {
  it('finishes spinning rows and leaves the rest alone', () => {
    const out = completeActiveStatus([status('s1', false), text('t1', 'hi')])
    expect(out[0].statusCompleted).toBe(true)
    expect(out[0].statusText).toBe('ツール実行完了')
    expect(out[1]).toEqual(text('t1', 'hi'))
  })
})

describe('upsertToolStatus', () => {
  const options = { displayName: 'Webブラウザ', placeholderId: 'p1', newStatusId: 's2' }

  it('drops the empty bubble that was opened for text that never came', () => {
    const out = upsertToolStatus([text('p1', '')], options)
    expect(out.map(m => m.id)).toEqual(['s2'])
    expect(out[0].statusText).toBe('Webブラウザ を実行中…')
  })

  it('reuses the last status row for back-to-back tool calls', () => {
    const out = upsertToolStatus([status('s1', true)], options)
    expect(out.map(m => m.id)).toEqual(['s1'])
    expect(out[0].statusCompleted).toBe(false)
  })

  it('starts a new row when text arrived after the last status', () => {
    const out = upsertToolStatus([status('s1', true), text('t1', 'result')], options)
    expect(out.map(m => m.id)).toEqual(['s1', 't1', 's2'])
  })

  it('keeps a non-empty bubble that shares the placeholder id', () => {
    const out = upsertToolStatus([text('p1', 'partial')], options)
    expect(out.map(m => m.id)).toEqual(['p1', 's2'])
  })
})

describe('appendAuthPrompt', () => {
  it('relabels the spinner without stopping it', () => {
    const out = appendAuthPrompt([status('s1', false)], 'a1', 'https://accounts.google.com/x')
    expect(out[0].statusCompleted).toBe(false)
    expect(out[0].statusText).toBe('Google連携を待機中…')
    expect(out[1].authUrl).toBe('https://accounts.google.com/x')
  })
})

describe('list edits', () => {
  it('starts an assistant message after closing open statuses', () => {
    const out = startAssistantMessage([status('s1', false)], 'm1', 'hello')
    expect(out[0].statusCompleted).toBe(true)
    expect(out[1]).toEqual({ id: 'm1', role: 'assistant', content: 'hello' })
  })

  it('sets content, marks interrupted, and removes by id', () => {
    expect(setContent([text('m1', 'a')], 'm1', 'ab')[0].content).toBe('ab')
    expect(markInterrupted([text('m1', 'a')], 'm1')[0].interrupted).toBe(true)
    expect(removeMessages([text('m1', 'a'), text('m2', 'b')], ['m1'])).toHaveLength(1)
  })

  it('drops blank assistant bubbles but keeps status rows and user text', () => {
    const out = dropEmptyAssistant([
      { id: 'u1', role: 'user', content: 'hi' },
      text('m1', '   '),
      status('s1', true),
      text('m2', 'kept'),
    ])
    expect(out.map(m => m.id)).toEqual(['u1', 's1', 'm2'])
  })
})

describe('createReplyBuffer', () => {
  it('collects one segment per bubble across a tool call', () => {
    const buffer = createReplyBuffer('m1')
    buffer.append('before')
    buffer.endMessage()

    expect(buffer.needsNewMessage).toBe(true)
    expect(buffer.currentMessageId).toBe('m1')

    buffer.append('after')
    buffer.startMessage('m2')
    buffer.flush()

    expect(buffer.currentMessageId).toBe('m2')
    expect(buffer.needsNewMessage).toBe(false)
    expect(buffer.finishedSegments()).toEqual(['before', 'after'])
  })

  it('accumulates text within one bubble', () => {
    const buffer = createReplyBuffer('m1')
    buffer.append('he')
    expect(buffer.append('llo')).toBe('hello')
  })

  it('keeps the pending flag when adopting the auth bubble', () => {
    const buffer = createReplyBuffer('m1')
    buffer.append('text')
    buffer.endMessage()
    buffer.adoptMessage('auth1')

    expect(buffer.currentMessageId).toBe('auth1')
    expect(buffer.needsNewMessage).toBe(true)
  })

  it('ignores whitespace-only segments', () => {
    const buffer = createReplyBuffer('m1')
    buffer.append('   ')
    buffer.endMessage()
    expect(buffer.finishedSegments()).toEqual([])
  })
})
