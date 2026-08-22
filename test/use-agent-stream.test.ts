import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAgent, type AgentEvent } from '../app/hooks/use-agent-stream';

// These tests pin the two behaviours that are easy to get wrong:
// events split across network chunks, and retry-only-before-first-byte.

const ARN = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/agent_BookChecker-abc';

function bodyFrom(chunks: string[], failAfter?: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (failAfter !== undefined && i === failAfter) {
        controller.error(new Error('connection dropped'));
        return;
      }
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

function collect() {
  const events: AgentEvent[] = [];
  return { events, onEvent: (e: AgentEvent) => events.push(e) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('streamAgent', () => {
  it('parses events that arrive one per chunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: bodyFrom([
          'data: {"type":"text","data":"Hello"}\n',
          'data: {"type":"text","data":" world"}\n',
        ]),
      }),
    );
    const { events, onEvent } = collect();

    const result = await streamAgent({
      agentArn: ARN,
      token: 't',
      prompt: 'hi',
      sessionId: 's',
      onEvent,
    });

    expect(result.status).toBe('done');
    expect(events).toEqual([
      { type: 'text', data: 'Hello' },
      { type: 'text', data: ' world' },
    ]);
  });

  it('joins an event that is split across two chunks', async () => {
    // The naive reader loses this event entirely.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: bodyFrom(['data: {"type":"te', 'xt","data":"split"}\n']),
      }),
    );
    const { events, onEvent } = collect();

    await streamAgent({ agentArn: ARN, token: 't', prompt: 'hi', sessionId: 's', onEvent });

    expect(events).toEqual([{ type: 'text', data: 'split' }]);
  });

  it('handles several events inside one chunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: bodyFrom([
          'data: {"type":"tool_use","tool_name":"browser"}\ndata: {"type":"tool_result"}\n',
        ]),
      }),
    );
    const { events, onEvent } = collect();

    await streamAgent({ agentArn: ARN, token: 't', prompt: 'hi', sessionId: 's', onEvent });

    expect(events).toEqual([{ type: 'tool_use', tool_name: 'browser' }, { type: 'tool_result' }]);
  });

  it('skips malformed lines instead of aborting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: bodyFrom([
          'data: not json\n',
          ': keepalive\n',
          'data: {"type":"text","data":"ok"}\n',
        ]),
      }),
    );
    const { events, onEvent } = collect();

    const result = await streamAgent({
      agentArn: ARN,
      token: 't',
      prompt: 'hi',
      sessionId: 's',
      onEvent,
    });

    expect(result.status).toBe('done');
    expect(events).toEqual([{ type: 'text', data: 'ok' }]);
  });

  it('retries when the connection fails before any event', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('dns'))
      .mockResolvedValue({ ok: true, body: bodyFrom(['data: {"type":"text","data":"ok"}\n']) });
    vi.stubGlobal('fetch', fetchMock);
    const { events, onEvent } = collect();

    const promise = streamAgent({
      agentArn: ARN,
      token: 't',
      prompt: 'hi',
      sessionId: 's',
      onEvent,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('done');
    expect(events).toEqual([{ type: 'text', data: 'ok' }]);
  });

  it('does NOT retry once output has been emitted', async () => {
    // A blind retry here could run the calendar tool twice.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: bodyFrom(['data: {"type":"text","data":"partial"}\n'], 1),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { events, onEvent } = collect();

    const result = await streamAgent({
      agentArn: ARN,
      token: 't',
      prompt: 'hi',
      sessionId: 's',
      onEvent,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('interrupted');
    expect(events).toEqual([{ type: 'text', data: 'partial' }]);
  });

  it('gives up after the retry budget', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    const { onEvent } = collect();

    const promise = streamAgent({
      agentArn: ARN,
      token: 't',
      prompt: 'hi',
      sessionId: 's',
      onEvent,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe('interrupted');
    expect(fetchMock).toHaveBeenCalledTimes(3); // first try + 2 retries
  });

  it('builds the runtime URL from the ARN region', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: bodyFrom([]) });
    vi.stubGlobal('fetch', fetchMock);
    const { onEvent } = collect();

    await streamAgent({ agentArn: ARN, token: 'tok', prompt: 'hi', sessionId: 's1', onEvent });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/');
    expect(url).toContain(encodeURIComponent(ARN));
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ prompt: 'hi', session_id: 's1' });
  });

  it('fails clearly when no ARN and no local URL are configured', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { onEvent } = collect();

    await expect(
      streamAgent({ agentArn: undefined, token: 't', prompt: 'hi', sessionId: 's', onEvent }),
    ).rejects.toThrow('NEXT_PUBLIC_AGENT_ARN');
  });
});
