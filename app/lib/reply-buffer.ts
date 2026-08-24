// Mutable state of one streaming reply.
//
// A turn is not one bubble: a tool call ends the current bubble and the
// text after it starts another. This tracks which bubble is being written
// to and collects the finished ones for persistence.

export interface ReplyBuffer {
  /** Bubble the next text event updates. */
  readonly currentMessageId: string
  /** True when the next text event must open a new bubble. */
  readonly needsNewMessage: boolean
  /** Add streamed text; returns the full text of the current bubble. */
  append(text: string): string
  /** Point at `id` without clearing the pending-new-message flag. */
  adoptMessage(id: string): void
  /** Point at `id` and treat it as open for writing. */
  startMessage(id: string): void
  /** Close the current bubble; the next text opens a new one. */
  endMessage(): void
  /** Close the current segment, keeping the bubble. */
  flush(): void
  /** Segments finished in this turn, oldest first. */
  finishedSegments(): string[]
}

export function createReplyBuffer(initialMessageId: string): ReplyBuffer {
  let accumulator = ''
  let messageId = initialMessageId
  let pendingNewMessage = false
  const segments: string[] = []

  const flush = () => {
    if (accumulator.trim()) segments.push(accumulator)
    accumulator = ''
  }

  return {
    get currentMessageId() {
      return messageId
    },
    get needsNewMessage() {
      return pendingNewMessage
    },
    append(text) {
      accumulator += text
      return accumulator
    },
    adoptMessage(id) {
      messageId = id
    },
    startMessage(id) {
      messageId = id
      pendingNewMessage = false
    },
    endMessage() {
      flush()
      pendingNewMessage = true
    },
    flush,
    finishedSegments() {
      return [...segments]
    },
  }
}
