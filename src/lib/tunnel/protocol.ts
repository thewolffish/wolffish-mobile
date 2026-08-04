/**
 * The tunnel wire contract, shared verbatim between desktop and mobile.
 *
 * This file is vendored identically into wolffish-app (`src/main/tunnel/`) and
 * wolffish-mobile (`src/lib/tunnel/`). Keep the two byte-identical — a drift
 * here is a protocol split, and the frame types below are the only thing the
 * two apps agree on. It has no imports for exactly that reason.
 *
 * The relay (wolffish-relay) never parses any of this: it forwards opaque
 * binary records between one `host` (desktop) and one `guest` (mobile) that
 * presented the same rendezvous ID. Everything below is end-to-end sealed
 * before it reaches the socket.
 */

export const PROTOCOL_VERSION = 1

export const DEFAULT_RELAY_URL = 'wss://relay.wolffi.sh'

/**
 * Outer record type — the first byte of every binary message.
 *
 * A reconnecting device can otherwise mistake a straggler from the previous
 * session for a handshake message: when a phone drops mid-transfer the
 * desktop's socket still holds queued chunks, and those flush to the *new*
 * connection. This marker lets each side ignore records belonging to a session
 * it has already left. It reveals only "handshake" versus "data" — the same
 * metadata a TLS record header exposes — never anything about content.
 */
export const RecordType = { HANDSHAKE: 0x01, TRANSPORT: 0x02 } as const

/** Frame types inside a decrypted record. */
export const FrameType = {
  PING: 0x00,
  HELLO: 0x01,
  RPC_REQ: 0x02,
  RPC_RES: 0x03,
  EVENT: 0x04,
  FILE_MANIFEST: 0x10,
  FILE_WANT: 0x11,
  FILE_CHUNK: 0x12,
  FILE_ACK: 0x13,
  FILE_DONE: 0x14
} as const

/** Ciphertext stays far under the relay's 1 MiB cap. */
export const CHUNK_SIZE = 256 * 1024
/** Chunks in flight before the sender waits for credit. */
export const WINDOW = 32
/** Receiver acknowledges (and checkpoints) this often. */
export const ACK_EVERY = 16
/** Relay-answered keepalive cadence; never wakes the Durable Object. */
export const KEEPALIVE_MS = 25_000

/** Application close codes the relay uses (4000–4999 is the app range). */
export const CloseCode = {
  Replaced: 4000,
  ProtocolViolation: 4400,
  MessageTooLarge: 4413
} as const

/** Relay → client presence notices. The only text the relay ever sends. */
export const PEER_PRESENT = '{"t":"peer-present"}'
export const PEER_GONE = '{"t":"peer-gone"}'
export const KEEPALIVE_REQUEST = 'ping'
export const KEEPALIVE_RESPONSE = 'pong'

/** Rendezvous IDs are exactly 256 bits, lowercase hex. */
export const RID_REGEX = /^[0-9a-f]{64}$/

/**
 * RPC methods. Desktop serves everything under `desktop.*`; the phone serves
 * `device.*` so the agent can reach capabilities only a phone has.
 *
 * Kept as a const map rather than free strings so both sides fail at compile
 * time when a method is renamed on one side only.
 */
export const Rpc = {
  /** Handshake sanity + versions. */
  hello: 'desktop.hello',
  /** The full ConfigSnapshot the mobile settings screens render. */
  configSnapshot: 'desktop.config.snapshot',
  /**
   * Replace the workspace's prompt variables with the given array — the one
   * setting the phone edits rather than mirrors. Whole-array replace, exactly
   * like the desktop's own save: the desktop applies writes in arrival order
   * and the last one wins, so both screens converge on whatever was written
   * last. Params: `{ variables: Array<{name, value, sensitive}> }`.
   */
  variablesSet: 'desktop.variables.set',
  /** Conversation index — metadata only, never message bodies. */
  conversationIndex: 'desktop.conversations.index',
  /** One conversation's messages, fetched when the user opens it. */
  conversationBody: 'desktop.conversations.body',
  /** Usage totals and per-provider breakdown. */
  usage: 'desktop.usage',
  /**
   * One month of the desktop's own release notes — the markdown of
   * src/changelog/<month>/<locale>.md verbatim, English when the requested
   * locale has no page. The snapshot's `changelog.months` says what exists;
   * bodies are fetched one at a time because the full set is hundreds of KB
   * and read far more rarely than the settings that ride the snapshot.
   * Params: `{ month: 'YYYY-MM', locale }` → `{ markdown }` (null when the
   * month is unknown).
   */
  changelogRead: 'desktop.changelog.read',
  /**
   * Flip one capability on or off from the phone. The desktop applies it
   * through the exact same path as its own settings toggle and answers
   * `{ ok, enabled }` with the state that actually holds — a locked core
   * capability refuses the off, an unknown name is an error.
   */
  capabilitySet: 'desktop.capabilities.set',
  /**
   * Apply a settings patch the phone edited. Params: `{ settings }` — a flat
   * partial of the phone's editable config surface. The desktop persists it
   * through the same setters its own panels use (whitelisted — an unknown key
   * is an error, and the phone reverts by refetching the snapshot). Answers
   * `{ ok: true }`; the config.changed push that follows is the confirmation.
   */
  configSet: 'desktop.config.set',
  /** Send a user turn; the reply streams back as events. */
  sendMessage: 'desktop.chat.send',
  /** Stop the running turn. */
  abortTurn: 'desktop.chat.abort',
  /**
   * Update the reflection schedule / turn-scoring config. The body is a
   * partial ReflectionConfig-shaped patch ({ hour?, quietHours?, scoring? });
   * the answer is the desktop's complete post-write config. Callers render
   * the answer, never their own optimism — both screens can only ever show
   * what the desktop actually persisted.
   */
  setReflectionConfig: 'desktop.config.setReflection',
  /**
   * Start a reflection job immediately: { kind: 'reflection' | 'deepClean' }.
   * Answers { result: 'running' | 'queued' | 'coalesced' } — the same states
   * the desktop's own Run-now button gets from brainstem.
   */
  runReflection: 'desktop.reflection.run',
  /** Everything the phone can do, advertised to the desktop agent. */
  deviceTools: 'device.tools',
  /** Live device state for the desktop's Mobile panel. */
  deviceStatus: 'device.status',
  /**
   * Workspace file transfer. Bytes ride ordinary RPC frames as base64url
   * strings so nothing new touches the transport: each read/chunk stays at or
   * under CHUNK_SIZE raw bytes, which lands well inside the relay's 1 MiB
   * record cap after base64 and encryption overhead.
   *
   * Download (desktop → phone): `fileStat` answers { exists, sizeBytes };
   * `fileRead` takes { path, offset, length } and answers { data, sizeBytes }
   * for the requested window. Paths are workspace-relative and validated on
   * the desktop — anything escaping the workspace root is an error.
   *
   * Upload (phone → desktop): `uploadBegin` takes { name, mimeType,
   * sizeBytes, conversationId? } and answers { uploadId, conversationId } —
   * creating the conversation when none is named, so a first message's file
   * has somewhere to land. `uploadChunk` appends { uploadId, offset, data };
   * `uploadCommit` finalizes and answers the stored attachment metadata
   * { type, filePath, originalName, mimeType, sizeBytes } with the path the
   * desktop actually chose (collisions rename, Finder-style).
   */
  fileStat: 'desktop.files.stat',
  fileRead: 'desktop.files.read',
  uploadBegin: 'desktop.files.uploadBegin',
  uploadChunk: 'desktop.files.uploadChunk',
  uploadCommit: 'desktop.files.uploadCommit'
} as const

/** Event topics pushed without a request. */
export const Event = {
  /** A conversation was created or its metadata changed. */
  conversationUpserted: 'conversation.upserted',
  /** A conversation was deleted on the desktop. */
  conversationDeleted: 'conversation.deleted',
  /** Streaming assistant output for an open conversation. */
  messageDelta: 'message.delta',
  /** A completed message (assistant, tool result, or user echo). */
  messageAppended: 'message.appended',
  /** Turn lifecycle: thinking / running a tool / done. */
  turnStatus: 'turn.status',
  /** A turn was scored — mobile mirrors the desktop's score UI. */
  turnScored: 'turn.scored',
  /** Any config section changed on the desktop. */
  configChanged: 'config.changed',
  /** Usage counters moved. */
  usageChanged: 'usage.changed'
} as const

export type RpcMethod = (typeof Rpc)[keyof typeof Rpc]
export type EventTopic = (typeof Event)[keyof typeof Event]

/** What the QR encodes. Base64url JSON behind a `wolffish-pair:v1:` prefix. */
export type PairingPayload = {
  v: number
  /** Relay URL, so a self-hosted relay travels with the pairing. */
  relay: string
  /** Desktop's static public key, hex. Absent for code pairing (XX learns it). */
  pk?: string
  /** Pairing secret, base64url. */
  ps: string
}

export const PAIRING_PREFIX = 'wolffish-pair:v1:'

/** Conversation metadata — the only conversation data synced up front. */
export type ConversationMeta = {
  id: string
  title: string
  model: string | null
  channel: string | null
  icon: string | null
  projectId: string | null
  sealed: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
  /** Serialized desktop stats blob; mobile renders it verbatim. */
  stats: unknown | null
  summary: string | null
}

/** One message as the phone stores it. */
export type SyncMessage = {
  id: string
  role: string
  content: string
  timestamp: number
  /** Attachments, tool payloads, segments — opaque to the transport. */
  payload?: unknown
}
