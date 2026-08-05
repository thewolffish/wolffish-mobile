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
 *
 * CONTROL is the one deliberate exception to "the relay never parses": a
 * CONTROL record's body is plaintext JSON addressed to the RELAY (the push
 * control plane below), terminated there and never forwarded. Old relays
 * forward it like any binary frame and old peers drop unknown record types,
 * so version skew degrades to "no push", never to a broken tunnel.
 */
export const RecordType = { HANDSHAKE: 0x01, TRANSPORT: 0x02, CONTROL: 0x03 } as const

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
   * The user answered an ask-the-user card. Params: `{ id, response }` where
   * `response` is the desktop's AskUserResponse — `{ kind: 'answered',
   * answers }` (one answer per question, in order) or `{ kind: 'canceled' }`.
   * Answers `{ ok }`: false when the id names no pending request, which is
   * how the phone learns a card it still shows was already resolved (turn
   * ended, or the tunnel dropped and the desktop failed it closed).
   */
  askRespond: 'desktop.chat.askRespond',
  /**
   * The user approved or denied a flagged tool call. Params:
   * `{ id, decision: 'approved' | 'denied' }`, answering `{ ok }` on the same
   * contract as askRespond. Fails closed everywhere: an unanswered request is
   * denied when its turn ends or the phone goes away.
   */
  approvalRespond: 'desktop.chat.approvalRespond',
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
  /**
   * The agent is asking the user multiple-choice question(s) and the turn is
   * parked until they answer. Payload mirrors the desktop's own chat:askRequest
   * IPC — `{ conversationId, turnId, id, toolCallId, questions }` — so the
   * phone renders the same card from the same data, and answers with
   * `Rpc.askRespond`.
   */
  askRequest: 'ask.request',
  /**
   * A tool call the desktop flagged for approval, parked the same way.
   * Payload mirrors chat:approvalRequest — `{ conversationId, turnId, id,
   * toolCallId, tool, args, level, reason, description }` — and the phone
   * answers with `Rpc.approvalRespond`.
   */
  approvalRequest: 'approval.request',
  /** A turn was scored — mobile mirrors the desktop's score UI. */
  turnScored: 'turn.scored',
  /** Any config section changed on the desktop. */
  configChanged: 'config.changed',
  /**
   * The variables array changed, whoever wrote it — payload carries the whole
   * array (`{ variables }`), so the phone renders it straight into its store
   * with no snapshot round trip. A debounced config.changed still follows for
   * everything that rebuilds from the full snapshot, and a phone that predates
   * this topic converges through that path alone.
   */
  variablesChanged: 'variables.changed',
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

// ---------------------------------------------------------------------------
// Push-notification control plane (relay-terminated; mirrored in the relay's
// own protocol.ts)
// ---------------------------------------------------------------------------
//
// These frames ride CONTROL records and are the one part of the wire the
// relay reads on purpose: the phone registers its Expo push token by a stable
// phoneId, the desktop asks for a notification to reach the phone, and the
// relay decides the route — the live tunnel first, Expo push as the fallback.
// Notifications are 100% model-initiated on the desktop; the desktop stamps
// notificationId and phoneId itself (never the model), and the phone dedupes
// by notificationId because both routes can legitimately fire.

export const PUSH_WIRE_VERSION = 1

export const NOTIFY_PHASES = ['started', 'needs_input', 'failed', 'completed', 'info'] as const
export type NotifyPhase = (typeof NOTIFY_PHASES)[number]

export const NOTIFY_URGENCIES = ['normal', 'high'] as const
export type NotifyUrgency = (typeof NOTIFY_URGENCIES)[number]

export type PushPlatform = 'ios' | 'android'

export const NOTIFY_TITLE_MAX = 60
export const NOTIFY_BODY_MAX = 180
export const NOTIFY_TTL_MIN = 60
export const NOTIFY_TTL_MAX = 86_400

/** Android notification channel; the phone creates it, the relay names it. */
export const ANDROID_CHANNEL_ID = 'agent-runs'

/** Deep links must stay inside the app's own scheme. */
export const DEEPLINK_SCHEME = 'wolffish://'

export function isAllowedDeeplink(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 512 &&
    value.startsWith(DEEPLINK_SCHEME) &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f\s]/.test(value)
  )
}

/** Phone → relay, on pairing and on every app foreground. */
export type RegisterPushFrame = {
  v: 1
  type: 'register_push'
  /** Stable per-device id minted by the phone — never the rendezvous or
   *  session id (both ephemeral), and never derived from the identity key. */
  phoneId: string
  /** Null when notification permission was denied — in-band only then. */
  expoPushToken: string | null
  platform: PushPlatform
  appVersion?: string | null
}

/** Desktop → relay, when the model calls the notify tool. */
export type NotifyFrame = {
  v: 1
  type: 'notify'
  /** ULID, generated by the desktop — never by the model. */
  notificationId: string
  /** From the desktop's pairing record — never from the model. */
  phoneId: string
  runId: string
  phase: NotifyPhase
  title: string
  body: string
  urgency: NotifyUrgency
  deeplink: string | null
  /** Seconds. */
  ttl: number
  /** Unix ms at the desktop. */
  ts: number
}

/** Relay → phone, in-band delivery: the notify frame under another type. */
export type NotificationFrame = Omit<NotifyFrame, 'type'> & { type: 'notification' }

/** Phone → relay: the in-band delivery arrived and was rendered. */
export type NotificationAckFrame = { v: 1; type: 'notification_ack'; notificationId: string }

/** Relay → desktop: how the notify was routed, answered immediately. */
export type NotifyResultFrame = {
  v: 1
  type: 'notify_result'
  /** Null only when the frame was too malformed to carry an id. */
  notificationId: string | null
  route: 'inband' | 'push' | 'dropped'
  /** Present when dropped (and on validation rejects). */
  reason?: string
}

/**
 * An incoming in-band notification, reduced to the fields this build
 * understands — tolerant reads, because a newer desktop/relay may add fields
 * (or phases) this app version predates. Unknown fields are ignored, an
 * unknown phase or urgency degrades to its default, and only a frame with no
 * usable id/title/body is rejected outright (null).
 */
export function parseNotification(raw: Record<string, unknown>): NotificationFrame | null {
  if (raw.v !== PUSH_WIRE_VERSION || raw.type !== 'notification') return null
  const notificationId = raw.notificationId
  if (typeof notificationId !== 'string' || !notificationId || notificationId.length > 64) {
    return null
  }
  const title = raw.title
  const body = raw.body
  if (typeof title !== 'string' || !title || title.length > NOTIFY_TITLE_MAX) return null
  if (typeof body !== 'string' || !body || body.length > NOTIFY_BODY_MAX) return null
  const ttlRaw = typeof raw.ttl === 'number' && Number.isFinite(raw.ttl) ? raw.ttl : NOTIFY_TTL_MIN
  return {
    v: 1,
    type: 'notification',
    notificationId,
    phoneId: typeof raw.phoneId === 'string' ? raw.phoneId : '',
    runId: typeof raw.runId === 'string' ? raw.runId : '',
    phase: NOTIFY_PHASES.includes(raw.phase as NotifyPhase) ? (raw.phase as NotifyPhase) : 'info',
    title,
    body,
    urgency: NOTIFY_URGENCIES.includes(raw.urgency as NotifyUrgency)
      ? (raw.urgency as NotifyUrgency)
      : 'normal',
    deeplink: isAllowedDeeplink(raw.deeplink) ? raw.deeplink : null,
    ttl: Math.min(NOTIFY_TTL_MAX, Math.max(NOTIFY_TTL_MIN, Math.round(ttlRaw))),
    ts: typeof raw.ts === 'number' && Number.isFinite(raw.ts) ? raw.ts : Date.now()
  }
}
