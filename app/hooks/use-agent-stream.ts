// SSE client for AgentCore Runtime.
//
// Improvements over a naive reader loop:
// 1) Line buffering. A JSON event can be split across two
//    network chunks. We keep the tail and join it with the
//    next chunk, so no event is lost.
// 2) Retry before first byte. When the connection fails
//    before any event arrives, we retry with backoff.
//    After the first byte we never retry. A silent retry
//    there could run a tool twice.

export type AgentEvent =
  | { type: 'text'; data: string }
  | { type: 'tool_use'; tool_name?: string }
  | { type: 'tool_result' }
  | { type: 'auth_url'; url: string }
  | { type: 'error'; data?: string }

// Local mode talks to the agent running on your machine
// (BedrockAgentCoreApp serves /invocations on port 8080).
const LOCAL_AGENT_URL = process.env.NEXT_PUBLIC_AGENT_LOCAL_URL

export interface StreamParams {
  agentArn: string | undefined
  token: string
  prompt: string
  sessionId: string
  actorId?: string
  onEvent: (event: AgentEvent) => void
}

export interface StreamResult {
  // 'done': the stream ended normally.
  // 'interrupted': the network dropped after some output.
  status: 'done' | 'interrupted'
}

const MAX_CONNECT_RETRY = 2

/**
 * Split a buffer into complete events plus the trailing partial line.
 * The caller carries `rest` into the next chunk, so an event cut in half
 * by a chunk boundary is not lost.
 */
export function parseEventLines(buffer: string): { events: AgentEvent[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events: AgentEvent[] = []
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    try {
      events.push(JSON.parse(line.slice(6)) as AgentEvent)
    } catch {
      continue
    }
  }
  return { events, rest }
}

function invocationUrl(agentArn: string | undefined): string {
  // Local mode talks to the agent running on your machine.
  if (LOCAL_AGENT_URL) return LOCAL_AGENT_URL
  if (!agentArn) throw new Error('NEXT_PUBLIC_AGENT_ARN is not set')
  const region = agentArn.split(':')[3]
  return (
    `https://bedrock-agentcore.${region}.amazonaws.com` +
    `/runtimes/${encodeURIComponent(agentArn)}/invocations?qualifier=DEFAULT`
  )
}

async function openStream(url: string, params: StreamParams): Promise<ReadableStream<Uint8Array>> {
  const { token, prompt, sessionId, actorId } = params
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      session_id: sessionId,
      ...(actorId ? { actor_id: actorId } : {}),
    }),
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  return res.body
}

async function pumpEvents(
  stream: ReadableStream<Uint8Array>,
  deliver: (event: AgentEvent) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = parseEventLines(buffer)
    buffer = rest
    for (const event of events) deliver(event)
  }
}

export async function streamAgent(params: StreamParams): Promise<StreamResult> {
  const url = invocationUrl(params.agentArn)

  let receivedAny = false
  const deliver = (event: AgentEvent) => {
    receivedAny = true
    params.onEvent(event)
  }

  for (let attempt = 0; attempt <= MAX_CONNECT_RETRY; attempt++) {
    try {
      await pumpEvents(await openStream(url, params), deliver)
      return { status: 'done' }
    } catch {
      // Output already shown: stop here and let the UI offer a resume.
      if (receivedAny) return { status: 'interrupted' }
      // Nothing shown yet: safe to retry the connection.
      if (attempt < MAX_CONNECT_RETRY) {
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
        continue
      }
      return { status: 'interrupted' }
    }
  }
  return { status: 'interrupted' }
}
