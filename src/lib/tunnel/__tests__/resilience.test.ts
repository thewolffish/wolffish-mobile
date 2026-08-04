import { Tunnel } from '@/lib/tunnel/tunnel'
import { generateKeypair } from '@/lib/tunnel/noise'

/**
 * Staying connected, which is a different problem from getting connected.
 *
 * Every case here is one where the link is gone but nothing says so: a dial
 * that never resolves, a socket the OS still calls OPEN with nothing behind
 * it, a tunnel object that stopped trying. They share a symptom — the app
 * looks connected, or looks like it is about to be, forever — and none of
 * them recover on their own. What is asserted is not that a connection
 * succeeds, but that failure always leaves something scheduled to try again.
 */

type Listener = (event: unknown) => void

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  binaryType = ''
  sent: unknown[] = []
  closed = false
  private listeners = new Map<string, Listener[]>()

  constructor(public url: string) {
    FakeSocket.last = this
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== fn)
    )
  }

  send(data: unknown): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = 3
  }

  emit(type: string, event: unknown = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event)
  }

  /** Complete the connection the way a real relay would. */
  open(): void {
    this.readyState = 1
    this.emit('open')
  }
}

const globals = globalThis as unknown as { WebSocket: unknown }
const realWebSocket = globals.WebSocket

function makeTunnel(): Tunnel {
  return new Tunnel({
    role: 'guest',
    relayUrl: 'wss://relay.test',
    rid: 'a'.repeat(64),
    staticKeypair: generateKeypair(),
    pairingSecret: new Uint8Array(32),
    peerStaticPublicKey: null,
    autoReconnect: true,
    peerWaitMs: null
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  FakeSocket.last = null
  globals.WebSocket = FakeSocket
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  globals.WebSocket = realWebSocket
})

describe('a dial that never answers', () => {
  it('gives up and schedules another attempt instead of hanging forever', () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const first = FakeSocket.last
    expect(first).not.toBeNull()

    // Neither 'open' nor 'error' ever fires — a captive portal, or a network
    // that disappeared mid-connect. Before the deadline existed this promise
    // never settled and nothing was left running to retry.
    jest.advanceTimersByTime(20_000)

    expect(first?.closed).toBe(true)
    expect(tunnel.alive).toBe(true)
  })
})

describe('a socket that stops answering', () => {
  it('tears down and retries rather than trusting readyState', () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const socket = FakeSocket.last
    socket?.open()

    // The OS still reports OPEN — the usual half-open socket after a network
    // change — so the keepalive keeps writing into nothing.
    jest.advanceTimersByTime(30_000)
    expect(socket?.sent.length).toBeGreaterThan(0)

    // Past the liveness window with nothing inbound, the link is declared
    // dead and replaced. Without this the app sits "connected" indefinitely.
    jest.advanceTimersByTime(60_000)
    expect(socket?.closed).toBe(true)
    expect(tunnel.alive).toBe(true)
  })

  it('keeps a working link alive when answers keep arriving', () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const socket = FakeSocket.last
    socket?.open()

    // A reply on every interval: the watchdog must never fire on a healthy
    // connection, or it would sever exactly the links it exists to protect.
    for (let i = 0; i < 10; i += 1) {
      jest.advanceTimersByTime(25_000)
      socket?.emit('message', { data: 'pong' })
    }

    expect(socket?.closed).toBe(false)
  })
})

describe('alive', () => {
  it('is false once stopped, so a caller knows to build a new one', () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    FakeSocket.last?.open()
    expect(tunnel.alive).toBe(true)

    tunnel.stop()
    expect(tunnel.alive).toBe(false)
  })
})

describe('retryNow', () => {
  it('does nothing when no retry is queued, so it cannot start a second cycle', () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const socket = FakeSocket.last
    socket?.open()

    tunnel.retryNow()

    // Same socket, no second dial.
    expect(FakeSocket.last).toBe(socket)
  })

  it('skips the remaining backoff when one is queued', async () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const first = FakeSocket.last
    first?.emit('error', {})
    // The rejection reaches the cycle's catch — and so schedules the retry —
    // a few microtasks later; without this the assertion races it.
    for (let i = 0; i < 6; i += 1) await Promise.resolve()

    // A retry is now pending behind a delay. Foregrounding should not wait
    // it out — the user is here and the network probably just came back.
    tunnel.retryNow()

    expect(FakeSocket.last).not.toBe(first)
  })
})

describe('a socket that was replaced', () => {
  /**
   * The loop with no fixed point. Close events arrive asynchronously, so a
   * socket torn down a moment ago delivers its close *after* the replacement
   * is already live. Unguarded, that stale handler forced the tunnel back to
   * reconnecting and queued a cycle that dropped the healthy socket — which
   * is a phone stuck reconnecting while the desktop sits there waiting.
   */
  it('cannot knock the live connection back into reconnecting', async () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const first = FakeSocket.last
    first?.emit('error', {})
    for (let i = 0; i < 6; i += 1) await Promise.resolve()

    tunnel.retryNow()
    const second = FakeSocket.last
    expect(second).not.toBe(first)
    second?.open()
    for (let i = 0; i < 4; i += 1) await Promise.resolve()

    // The replaced socket finally reports its close, late.
    first?.emit('close', { code: 1006 })

    // The live socket is untouched and no replacement was dialled.
    expect(second?.closed).toBe(false)
    expect(FakeSocket.last).toBe(second)
  })

  it('ignores late frames from a replaced socket', async () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const first = FakeSocket.last
    first?.emit('error', {})
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
    tunnel.retryNow()
    const second = FakeSocket.last
    second?.open()

    // A frame from the dead socket must not be mistaken for proof that the
    // live one is healthy, nor mutate the session it does not belong to.
    expect(() => first?.emit('message', { data: 'peer-present' })).not.toThrow()
    expect(FakeSocket.last).toBe(second)
  })

  it('runs one keepalive at a time, however many sockets came before', async () => {
    const tunnel = makeTunnel()
    void tunnel.start()
    const first = FakeSocket.last
    first?.open()
    first?.emit('close', { code: 1006 })
    for (let i = 0; i < 6; i += 1) await Promise.resolve()

    jest.advanceTimersByTime(1_000)
    const second = FakeSocket.last
    expect(second).not.toBe(first)
    second?.open()

    // Only the live socket may be pinged. A leaked interval from the first
    // one shares lastInboundAt and would eventually declare this one dead.
    const before = first?.sent.length ?? 0
    jest.advanceTimersByTime(26_000)
    expect(first?.sent.length).toBe(before)
    expect(second!.sent.length).toBeGreaterThan(0)
  })
})

describe('a peer that reconnects without a peer-gone notice', () => {
  /**
   * The relay replaces a same-role socket without announcing a departure, so
   * a returning phone gives this side nothing but a handshake record on what
   * it still believes is a live session. Left unhandled that produced the
   * worst pairing of states available: a status reading "connected" while
   * every request was rejected for having no session, and a session loop
   * parked waiting for a departure that had already happened in silence.
   */
  it('never advertises a link it would refuse to use', async () => {
    const tunnel = makeTunnel()
    let status: string | null = null
    tunnel.onState((state) => {
      status = state.status
      // The invariant, checked on every single transition rather than once at
      // the end: a tunnel may not read "connected" while rejecting requests
      // for having no session. That pairing is what the user saw as
      // "connected, but sync says it cannot reach your desktop".
      if (state.status === 'connected') expect(tunnel.connected).toBe(true)
    })

    void tunnel.start()
    const socket = FakeSocket.last
    socket?.open()
    for (let i = 0; i < 4; i += 1) await Promise.resolve()
    socket?.emit('message', { data: 'peer-present' })
    for (let i = 0; i < 6; i += 1) await Promise.resolve()

    expect(status).not.toBeNull()
    // And it is still working on it, rather than wedged.
    expect(tunnel.alive).toBe(true)
  })
})

describe('start()', () => {
  /**
   * The session loop keeps cycle() running for as long as the link is up, so
   * awaiting it outright resolves only when the connection dies. Every caller
   * that awaits start() — pairing, the reconnect button — held its busy flag
   * for exactly as long as everything worked: buttons disabled, status
   * connected, nothing pressable. start() must resolve at the first settle.
   */
  it('resolves on the first scheduled retry rather than blocking', async () => {
    const tunnel = makeTunnel()
    let resolved = false
    const started = tunnel.start().then(() => {
      resolved = true
    })

    FakeSocket.last?.emit('error', {})
    for (let i = 0; i < 8; i += 1) await Promise.resolve()

    expect(resolved).toBe(true)
    await started
    // And the retry it settled on is still queued — early resolution must
    // not have cost the reconnect.
    expect(tunnel.alive).toBe(true)
  })

  it('resolves when stopped mid-dial, so no caller hangs on a cancel', async () => {
    const tunnel = makeTunnel()
    const started = tunnel.start()
    tunnel.stop()
    await expect(started).resolves.toBeUndefined()
  })
})
