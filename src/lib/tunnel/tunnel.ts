/**
 * The tunnel endpoint — the same class both apps run.
 *
 * Vendored identically into wolffish-app and wolffish-mobile. It deliberately
 * touches no platform API beyond `WebSocket` and `crypto.getRandomValues`,
 * both of which exist in Electron's main process and on Hermes, so the file
 * needs no adapter on either side. Filesystem work (file transfer) lives
 * outside this class for the same reason.
 *
 * Responsibilities: connect to the relay, run the Noise handshake, keep the
 * socket alive, reconnect with backoff, and carry RPC + events. Everything
 * handed to the socket is ciphertext; the relay sees opaque records.
 */
import {
  CloseCode,
  FrameType,
  KEEPALIVE_MS,
  KEEPALIVE_REQUEST,
  KEEPALIVE_RESPONSE,
  PEER_GONE,
  PEER_PRESENT,
  PROTOCOL_VERSION,
  RecordType,
  type EventTopic,
  type RpcMethod
} from './protocol'
import {
  CipherState,
  InitiatorIK,
  InitiatorXX,
  ResponderIK,
  ResponderXX,
  type Keypair
} from './noise'
import { fingerprint, toHex } from './pairing'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type TunnelRole = 'host' | 'guest'
export type PairingMode = 'qr' | 'code'

export type TunnelStatus =
  | 'idle'
  | 'connecting'
  | 'waiting-for-peer'
  | 'handshaking'
  | 'connected'
  | 'reconnecting'
  | 'error'

/** What the Relay screen and the desktop Mobile panel render. */
export type TunnelState = {
  status: TunnelStatus
  /** Peer socket present on the relay (independent of a completed handshake). */
  peerPresent: boolean
  relayUrl: string
  /** Short forms only — never the full key material. */
  rendezvous: string | null
  ownKey: string | null
  peerKey: string | null
  /** Both sides show the same value when the session is genuinely shared. */
  session: string | null
  connectedAt: number | null
  lastError: string | null
  reconnects: number
  framesSent: number
  framesReceived: number
  bytesSent: number
  bytesReceived: number
}

export class TunnelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TunnelError'
  }
}

export class Disconnected extends TunnelError {
  constructor(reason: string) {
    super(`tunnel disconnected: ${reason}`)
    this.name = 'Disconnected'
  }
}

type RpcHandler = (params: any) => Promise<unknown> | unknown
type EventHandler = (payload: any) => void

export type TunnelOptions = {
  role: TunnelRole
  relayUrl: string
  rid: string
  staticKeypair: Keypair
  pairingSecret: Uint8Array
  /** Known for the QR route and for every reconnect; absent only while a typed
   * code pairs for the first time, which is what XXpsk3 is for. */
  peerStaticPublicKey?: Uint8Array | null
  /** Identity payload exchanged inside the handshake. */
  identity?: Record<string, unknown>
  /** Verbose channel logging, mirroring the desktop's other channels. */
  verbose?: boolean
  log?: (line: string) => void
  /** Reconnect automatically. The desktop parks and should; a phone reconnects
   * when it returns to the foreground. */
  autoReconnect?: boolean
}

export class Tunnel {
  private ws: WebSocket | null = null
  private sendCipher: CipherState | null = null
  private receiveCipher: CipherState | null = null
  private handshakeDone = false
  private handshakeInbox: ((message: Uint8Array) => void) | null = null
  private handshakeQueue: Uint8Array[] = []
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private rpcHandlers = new Map<string, RpcHandler>()
  private eventHandlers = new Map<string, EventHandler>()
  private stateListeners = new Set<(state: TunnelState) => void>()
  private nextRpcId = 1
  private stopped = false
  private attempt = 0

  /** Learned during a code pairing; the caller persists it for later IK runs. */
  peerStaticPublicKey: Uint8Array | null

  private state: TunnelState

  constructor(private readonly options: TunnelOptions) {
    this.peerStaticPublicKey = options.peerStaticPublicKey ?? null
    this.state = {
      status: 'idle',
      peerPresent: false,
      relayUrl: options.relayUrl,
      rendezvous: fingerprint(options.rid),
      ownKey: fingerprint(toHex(options.staticKeypair.publicKey)),
      peerKey: this.peerStaticPublicKey ? fingerprint(toHex(this.peerStaticPublicKey)) : null,
      session: null,
      connectedAt: null,
      lastError: null,
      reconnects: 0,
      framesSent: 0,
      framesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0
    }
  }

  // ------------------------------------------------------------------ state

  getState(): TunnelState {
    return { ...this.state }
  }

  onState(listener: (state: TunnelState) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.getState())
    return () => this.stateListeners.delete(listener)
  }

  private patch(next: Partial<TunnelState>): void {
    this.state = { ...this.state, ...next }
    const snapshot = this.getState()
    for (const listener of this.stateListeners) listener(snapshot)
  }

  private log(line: string): void {
    if (this.options.verbose) this.options.log?.(`[tunnel:${this.options.role}] ${line}`)
  }

  // -------------------------------------------------------------- lifecycle

  /** Connect and hand-shake, retrying until `stop()` when autoReconnect is on. */
  async start(mode: PairingMode = 'qr'): Promise<void> {
    this.stopped = false
    await this.cycle(mode)
  }

  private async cycle(mode: PairingMode): Promise<void> {
    if (this.stopped) return
    try {
      await this.openSocket()
      await this.waitForPeer()
      await this.performHandshake(mode)
      this.attempt = 0
      this.patch({ status: 'connected', connectedAt: Date.now(), lastError: null })
      this.log('connected')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.patch({ status: this.options.autoReconnect ? 'reconnecting' : 'error', lastError: message })
      this.log(`cycle failed: ${message}`)
      this.teardownSocket()
      if (this.options.autoReconnect && !this.stopped) this.scheduleReconnect(mode)
      else throw error
    }
  }

  /** Exponential backoff with jitter — a relay blip must not become a stampede. */
  private scheduleReconnect(mode: PairingMode): void {
    if (this.reconnectTimer) return
    this.attempt += 1
    const base = Math.min(30_000, 500 * 2 ** Math.min(this.attempt, 6))
    const delay = base / 2 + Math.random() * (base / 2)
    this.log(`reconnecting in ${Math.round(delay)}ms (attempt ${this.attempt})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.patch({ reconnects: this.state.reconnects + 1 })
      void this.cycle(mode)
    }, delay)
  }

  private openSocket(): Promise<void> {
    this.patch({ status: 'connecting' })
    const url = `${this.options.relayUrl}/t/${this.options.rid}?role=${this.options.role}`
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    this.ws = socket

    return new Promise((resolve, reject) => {
      const onOpen = (): void => {
        socket.removeEventListener('error', onError)
        this.attachSocket(socket)
        resolve()
      }
      const onError = (): void => {
        socket.removeEventListener('open', onOpen)
        reject(new TunnelError('could not reach the relay'))
      }
      socket.addEventListener('open', onOpen, { once: true })
      socket.addEventListener('error', onError, { once: true })
    })
  }

  private attachSocket(socket: WebSocket): void {
    socket.addEventListener('message', (event) => this.onMessage(event.data))
    socket.addEventListener('close', (event) => {
      this.log(`socket closed (${(event as CloseEvent).code})`)
      this.abortInFlight(`code ${(event as CloseEvent).code}`)
      this.handshakeDone = false
      this.sendCipher = null
      this.receiveCipher = null
      this.stopKeepalive()
      if (!this.stopped) {
        this.patch({ status: 'reconnecting', peerPresent: false, session: null })
        if (this.options.autoReconnect) this.scheduleReconnect('qr')
      }
    })
    this.keepaliveTimer = setInterval(() => {
      if (socket.readyState === 1) socket.send(KEEPALIVE_REQUEST)
    }, KEEPALIVE_MS)
  }

  private waitForPeer(timeoutMs = 60_000): Promise<void> {
    if (this.state.peerPresent) return Promise.resolve()
    this.patch({ status: 'waiting-for-peer' })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.peerWaiter = null
        reject(new TunnelError('the other device did not arrive'))
      }, timeoutMs)
      this.peerWaiter = () => {
        clearTimeout(timer)
        this.peerWaiter = null
        resolve()
      }
    })
  }

  private peerWaiter: (() => void) | null = null

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.teardownSocket()
    this.patch({ status: 'idle', peerPresent: false, session: null, connectedAt: null })
  }

  private teardownSocket(): void {
    this.stopKeepalive()
    try {
      this.ws?.close(1000, 'done')
    } catch {
      /* already gone */
    }
    this.ws = null
    this.handshakeDone = false
    this.sendCipher = null
    this.receiveCipher = null
    this.handshakeQueue = []
    this.handshakeInbox = null
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = null
  }

  // -------------------------------------------------------------- handshake

  private async performHandshake(mode: PairingMode): Promise<void> {
    this.patch({ status: 'handshaking' })
    const identity = encoder.encode(
      JSON.stringify({ ...(this.options.identity ?? {}), proto: PROTOCOL_VERSION })
    )
    const psk = this.options.pairingSecret
    const s = this.options.staticKeypair

    // A code pairing runs XX only until both keys are pinned; every run after
    // that is IK, exactly like a QR pairing.
    const useXX = mode === 'code' && !this.peerStaticPublicKey

    if (this.options.role === 'guest') {
      if (useXX) {
        const initiator = new InitiatorXX({ staticKeypair: s, psk })
        const reply = this.expectHandshake()
        this.sendRecord(initiator.writeMessage1(identity), RecordType.HANDSHAKE)
        const incoming = initiator.readMessage2(await reply)
        const out = initiator.writeMessage3(identity)
        this.sendRecord(out.message, RecordType.HANDSHAKE)
        this.adoptSession(out.send, out.receive, out.handshakeHash, incoming.remoteStaticPublicKey)
      } else {
        const rs = this.peerStaticPublicKey
        if (!rs) throw new TunnelError('no pinned desktop key — re-pair this device')
        const initiator = new InitiatorIK({ staticKeypair: s, remoteStaticPublicKey: rs, psk })
        const reply = this.expectHandshake()
        this.sendRecord(initiator.writeMessage1(identity), RecordType.HANDSHAKE)
        const result = initiator.readMessage2(await reply)
        this.adoptSession(result.send, result.receive, result.handshakeHash, rs)
      }
      return
    }

    if (useXX) {
      const responder = new ResponderXX({ staticKeypair: s, psk })
      responder.readMessage1(await this.expectHandshake())
      const third = this.expectHandshake()
      this.sendRecord(responder.writeMessage2(identity), RecordType.HANDSHAKE)
      const result = responder.readMessage3(await third)
      this.adoptSession(result.send, result.receive, result.handshakeHash, result.remoteStaticPublicKey)
      return
    }

    const responder = new ResponderIK({ staticKeypair: s, psk })
    const incoming = responder.readMessage1(await this.expectHandshake())
    if (
      this.peerStaticPublicKey &&
      toHex(incoming.remoteStaticPublicKey) !== toHex(this.peerStaticPublicKey)
    ) {
      throw new TunnelError('the phone presented a different key than the one paired')
    }
    const out = responder.writeMessage2(identity)
    this.sendRecord(out.message, RecordType.HANDSHAKE)
    this.adoptSession(out.send, out.receive, out.handshakeHash, incoming.remoteStaticPublicKey)
  }

  private adoptSession(
    send: CipherState,
    receive: CipherState,
    handshakeHash: Uint8Array,
    peerKey: Uint8Array
  ): void {
    this.sendCipher = send
    this.receiveCipher = receive
    this.handshakeDone = true
    this.peerStaticPublicKey = peerKey
    this.patch({
      peerKey: fingerprint(toHex(peerKey)),
      session: fingerprint(toHex(handshakeHash))
    })
  }

  private expectHandshake(timeoutMs = 30_000): Promise<Uint8Array> {
    const queued = this.handshakeQueue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handshakeInbox = null
        reject(new TunnelError('handshake timed out'))
      }, timeoutMs)
      this.handshakeInbox = (message) => {
        clearTimeout(timer)
        this.handshakeInbox = null
        resolve(message)
      }
    })
  }

  // ---------------------------------------------------------------- transport

  private onMessage(data: unknown): void {
    if (typeof data === 'string') {
      if (data === KEEPALIVE_RESPONSE) return
      if (data === PEER_PRESENT) {
        this.patch({ peerPresent: true })
        this.log('peer present')
        this.peerWaiter?.()
      } else if (data === PEER_GONE) {
        this.patch({ peerPresent: false })
        this.log('peer gone')
        // Our socket is fine, but anything in flight is going nowhere: the
        // relay drops frames with no peer to receive them.
        this.abortInFlight('peer gone')
      }
      return
    }

    const record = new Uint8Array(data as ArrayBuffer)
    this.patch({
      framesReceived: this.state.framesReceived + 1,
      bytesReceived: this.state.bytesReceived + record.length
    })
    const kind = record[0]
    const body = record.subarray(1)

    if (kind === RecordType.TRANSPORT) {
      if (!this.handshakeDone || !this.receiveCipher) return // straggler from a past session
      let plaintext: Uint8Array
      try {
        plaintext = this.receiveCipher.decrypt(body)
      } catch {
        this.log('frame failed authentication — dropped')
        return
      }
      void this.onFrame(plaintext)
      return
    }

    if (kind !== RecordType.HANDSHAKE) return
    if (this.handshakeDone) {
      // A handshake record on a live session means the peer restarted — which
      // is what a returning device sends, often before this side has finished
      // tearing the old session down. Drop the stale keys and take it.
      this.handshakeDone = false
      this.sendCipher = null
      this.receiveCipher = null
      this.log('peer restarted the session')
    }
    if (this.handshakeInbox) this.handshakeInbox(body)
    else this.handshakeQueue.push(body)
  }

  private sendRecord(payload: Uint8Array, kind: number): void {
    const socket = this.ws
    if (!socket || socket.readyState !== 1) throw new Disconnected('socket closed')
    const record = new Uint8Array(1 + payload.length)
    record[0] = kind
    record.set(payload, 1)
    socket.send(record)
    this.patch({
      framesSent: this.state.framesSent + 1,
      bytesSent: this.state.bytesSent + record.length
    })
  }

  private sendFrame(type: number, message: unknown): void {
    if (!this.sendCipher) throw new Disconnected('no session')
    const body = encoder.encode(JSON.stringify(message ?? {}))
    const frame = new Uint8Array(1 + body.length)
    frame[0] = type
    frame.set(body, 1)
    this.sendRecord(this.sendCipher.encrypt(frame), RecordType.TRANSPORT)
  }

  private async onFrame(frame: Uint8Array): Promise<void> {
    const type = frame[0]
    const body = frame.subarray(1)
    const message = body.length ? JSON.parse(decoder.decode(body)) : {}

    switch (type) {
      case FrameType.RPC_REQ: {
        const handler = this.rpcHandlers.get(message.method)
        if (!handler) {
          this.sendFrame(FrameType.RPC_RES, {
            id: message.id,
            ok: false,
            error: `no handler for ${message.method}`
          })
          return
        }
        try {
          const result = await handler(message.params)
          this.sendFrame(FrameType.RPC_RES, { id: message.id, ok: true, result })
        } catch (error) {
          this.sendFrame(FrameType.RPC_RES, {
            id: message.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
        return
      }
      case FrameType.RPC_RES: {
        const waiter = this.pending.get(message.id)
        if (!waiter) return
        this.pending.delete(message.id)
        if (message.ok) waiter.resolve(message.result)
        else waiter.reject(new TunnelError(message.error))
        return
      }
      case FrameType.EVENT: {
        this.eventHandlers.get(message.topic)?.(message.payload)
        this.eventHandlers.get('*')?.(message)
        return
      }
      default:
        this.log(`unhandled frame type 0x${type.toString(16)}`)
    }
  }

  private abortInFlight(reason: string): void {
    for (const { reject } of this.pending.values()) reject(new Disconnected(reason))
    this.pending.clear()
  }

  // ---------------------------------------------------------------- rpc/events

  onRpc(method: RpcMethod | string, handler: RpcHandler): void {
    this.rpcHandlers.set(method, handler)
  }

  onEvent(topic: EventTopic | '*', handler: EventHandler): void {
    this.eventHandlers.set(topic, handler)
  }

  rpc<T = unknown>(method: RpcMethod | string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.handshakeDone) return Promise.reject(new Disconnected('not connected'))
    const id = this.nextRpcId++
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new TunnelError(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value as T)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
    })
    this.sendFrame(FrameType.RPC_REQ, { id, method, params })
    return promise
  }

  emit(topic: EventTopic | string, payload: unknown): void {
    if (!this.handshakeDone) return // presence, not delivery: acks own that
    this.sendFrame(FrameType.EVENT, { topic, payload })
  }

  get connected(): boolean {
    return this.handshakeDone && this.state.peerPresent
  }
}

export { Event, Rpc } from './protocol'
export { CloseCode }
