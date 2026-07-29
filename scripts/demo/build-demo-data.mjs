#!/usr/bin/env node
/**
 * Build the demo dataset from a real desktop workspace.
 *
 * Selects every unique conversation from ~/.wolffish/workspace (all real
 * user conversations deduped by (title, first prompt), plus one exemplar per
 * distinct automation prompt) and shrinks them for mobile: coalesced text
 * deltas, capped tool outputs, desktop-only observability dropped.
 *
 * Two things are added rather than copied, because the source workspace has
 * neither: conversations are bound to demo projects (DEMO_PROJECTS, carried in
 * the config snapshot), and conversations with no stats block get one derived
 * from their own content so the context meter has a reading. Both are no-ops
 * the day the workspace keeps real projects and every conversation is folded
 * with stats. Output:
 *
 *   demo-data/conversations/<id>.json
 *   demo-data/manifest.json
 *   demo-data/config-snapshot.json
 *
 *   node scripts/demo/build-demo-data.mjs [--config-only]
 *
 * --config-only rewrites config-snapshot.json alone and leaves the built
 * conversations untouched — for when only the workspace's settings moved
 * (keys, engine state, the desktop's version), which is most rebuilds.
 *
 * No media is copied. Conversations keep their workspace-relative file paths,
 * and the app downloads the published sample for each path's file type on
 * first view (src/lib/files/sampleFiles.ts) — so the dataset stays a few MB of
 * JSON, no personal media leaves the workspace, and every user sees the same
 * files. The manifest lists any referenced extension with no published sample.
 *
 * Pack for publishing with scripts/demo/build-demo-bundle.mjs, then upload the
 * result to cdn.wolffi.sh/demo — that is where demo mode downloads it from, on
 * every device, including a fresh App Store install.
 * Never commit demo-data/ — it derives from personal usage data.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SAMPLE_BASE_URL, sampleExtFor } from './sample-exts.mjs'
import { demoApiKey } from './provider-keys.mjs'

const WORKSPACE =
  process.env.WOLFFISH_WORKSPACE ?? path.join(os.homedir(), '.wolffish', 'workspace')
const OUT_DIR = process.env.DEMO_OUT ?? path.join(process.cwd(), 'demo-data')
/**
 * The desktop app's own checkout — read for one thing, its version, which the
 * mobile Updates screen shows on its desktop card. The workspace cannot
 * supply it: config.json's `version` is that file's schema version, not the
 * app's.
 */
const APP_DIR = process.env.WOLFFISH_APP_DIR ?? path.resolve(process.cwd(), '..', 'wolffish-app')
const TOOL_OUTPUT_CAP = 16 * 1024
/** Cap on a compaction run's stored summary — the card scrolls, not the file. */
const RUN_OUTPUT_CAP = 8 * 1024

/**
 * Demo projects.
 *
 * The workspace this dataset is built from keeps its projects list empty, so
 * the demo would ship the one part of the desktop it cannot show: a
 * conversation that belongs somewhere. These five are synthetic, but they are
 * not arbitrary — each is the standing brief behind a cluster of conversations
 * that really is in the data, and `match` is what binds those conversations to
 * it. Shape is the desktop's Project (main/projects.ts) verbatim, so the same
 * snapshot can carry real projects the day the workspace has them.
 *
 * Ids are fixed rather than minted: conversations reference them, and a
 * rebuild that re-rolled them would orphan every binding in an already
 * published bundle.
 */
/**
 * Variables the demo ships when the workspace defines none — the same set the
 * app falls back to (state/demoConfig DEFAULTS), so a bundle and an un-synced
 * install describe the same workspace instead of disagreeing.
 *
 * Same contract as DEMO_PROJECTS: real `config.variables` win the moment the
 * workspace has any, so this is a floor, not an override. The sensitive one
 * carries the mask rather than a plausible-looking fake — the panel renders it
 * behind an eye toggle either way, and a secret that never existed cannot leak.
 */
const DEMO_VARIABLES = [
  { name: 'HOME_CITY', value: 'Riyadh', sensitive: false },
  { name: 'WORK_HOURS', value: '9:00-18:00', sensitive: false },
  { name: 'NOTION_FINANCE_DB', value: '••••••', sensitive: true }
]

const DEMO_PROJECTS = [
  {
    id: 'a3f1c07e-5b42-4d19-9c8e-2d7a6f0b1e54',
    title: 'Younes AI Daily',
    icon: '📰',
    instructions:
      'The daily AI briefing. Sweep the last 24 hours of AI news, keep what actually ships or changes a decision, and cut the funding-round noise. Deliver a magazine-style PDF plus a short Telegram summary, in that order, every day.',
    files: [
      { path: 'uploads/project-a3f1c07e/daily-brief-template.md', name: 'daily-brief-template.md' },
      { path: 'uploads/project-a3f1c07e/sources.csv', name: 'sources.csv' }
    ],
    match: [
      'ai daily',
      'daily digest',
      'ai news',
      'news butler',
      'daily freshness',
      'ai daily digest',
      'daily brief',
      'magazine-style'
    ]
  },
  {
    id: 'c8b25d61-9e07-4a3f-8b14-6f9c2e5a7d03',
    title: 'World Cup 2026 Desk',
    icon: '🏆',
    instructions:
      'Tournament analyst. Track fixtures, form and injuries for the 2026 World Cup; answer with the table first and the reasoning under it. Always name the kickoff time in the local timezone as well as UTC.',
    files: [{ path: 'uploads/project-c8b25d61/fixtures.csv', name: 'fixtures.csv' }],
    match: ['world cup', 'kickoff', 'fixture']
  },
  {
    id: 'e04a7b93-1c58-4e6d-a2f7-3b8d5c1e9407',
    title: 'Mac Hardening',
    icon: '🛡️',
    instructions:
      'Read-only security work on this machine. Audit, report, and propose — never change system state without asking first. Every finding needs the command that produced it so it can be re-run.',
    files: [
      { path: 'uploads/project-e04a7b93/audit-checklist.md', name: 'audit-checklist.md' },
      { path: 'uploads/project-e04a7b93/baseline-ports.log', name: 'baseline-ports.log' }
    ],
    match: [
      'security audit',
      'listening ports',
      'launchd',
      'system state',
      'macos security',
      'hardening',
      'orphaned'
    ]
  },
  {
    id: 'f76e3a28-4d90-4b51-8c37-1e5a9d2c6b80',
    title: 'X Growth Lab',
    icon: '🚀',
    instructions:
      'Audience growth for a solo founder. Everything is a testable claim: pick the angle, name the metric it moves, and give the smallest experiment that proves or kills it within a week.',
    files: [
      { path: 'uploads/project-f76e3a28/growth-experiments.csv', name: 'growth-experiments.csv' }
    ],
    match: [
      'growing my x',
      'following in x',
      'solo founder',
      'product hunter',
      'market research',
      'b2b ai',
      'bootstrapped',
      'loyal following'
    ]
  },
  {
    id: 'b52d9f14-7a63-4c08-9e1b-8f4c3a7d5e26',
    title: 'Meme Studio',
    icon: '🎨',
    instructions:
      'The meme pipeline. One image per run, caption in the voice of the person it is going to, and never reuse a template two days running.',
    files: [{ path: 'uploads/project-b52d9f14/voice-notes.md', name: 'voice-notes.md' }],
    match: ['meme', 'romantic meme', 'frog founder']
  }
]

/**
 * Context windows and the output reserve held back from them, per model, read
 * off the meters the desktop already wrote into this dataset. Backfilled
 * readings land on the same scale as the real ones instead of a made-up one.
 */
const MODEL_WINDOWS = {
  'deepseek-v4-pro': { window: 1_000_000, reserve: 32_768 },
  'kimi-k3': { window: 1_048_576, reserve: 131_072 },
  'kimi-k2.5': { window: 262_144, reserve: 32_768 },
  'glm-5.2': { window: 1_000_000, reserve: 65_536 },
  'glm-5': { window: 200_000, reserve: 32_768 },
  'claude-opus-4-8': { window: 200_000, reserve: 32_768 },
  'claude-sonnet-5': { window: 1_000_000, reserve: 65_536 },
  'gpt-5.6': { window: 400_000, reserve: 32_768 },
  'grok-5': { window: 256_000, reserve: 32_768 },
  'qwen4-max': { window: 262_144, reserve: 32_768 },
  'qwen4:8b': { window: 131_072, reserve: 32_768 },
  'gemma4:e2b': { window: 131_072, reserve: 32_768 }
}
const DEFAULT_WINDOW = { window: 1_000_000, reserve: 32_768 }

/** Desktop compactor.ts COMPACTION_THRESHOLD. */
const COMPACTION_THRESHOLD = 0.75

/** Per-million-token prices, blended from the turns that do carry costs. */
const RATES = { input: 0.3, cacheRead: 0.03, cacheWrite: 0.375, output: 1.1 }

/** The system prompt every conversation opens with — identity, tools, skills. */
const SYSTEM_PROMPT_TOKENS = 12_400

const OUTPUT_MARKER_RE =
  /\[wolffish-output:\s*([^\]]+?)\s*\((?:image|document|audio|video|file)\)\]/g
const MEDIA_URI_RE = /wolffish-media:\/\/([^)\s"']+)/g

function workspaceRelative(p) {
  return p.replace(/^.*?\/\.wolffish\/workspace\//, '')
}

function normalizePrompt(text) {
  return (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200)
}

function firstUserText(conv) {
  const msg = (conv.messages ?? []).find((m) => m.role === 'user')
  return msg?.content ?? ''
}

function segmentCount(conv) {
  return (conv.messages ?? []).reduce((sum, m) => sum + (m.segments?.length ?? 0), 0)
}

function coalesceText(segments) {
  const out = []
  for (const segment of segments) {
    const last = out[out.length - 1]
    if (
      segment.kind === 'text' &&
      last &&
      last.kind === 'text' &&
      Boolean(last.worker) === Boolean(segment.worker) &&
      (last.worker?.id ?? null) === (segment.worker?.id ?? null)
    ) {
      last.delta += segment.delta
    } else {
      out.push({ ...segment })
    }
  }
  return out
}

function capToolOutput(output) {
  if (typeof output !== 'string' || output.length <= TOOL_OUTPUT_CAP) return output
  const truncated = output.slice(0, TOOL_OUTPUT_CAP)
  // Markers must survive truncation — file cards render from them.
  const lostMarkers = []
  for (const match of output.matchAll(OUTPUT_MARKER_RE)) {
    if (match.index >= TOOL_OUTPUT_CAP) lostMarkers.push(match[0])
  }
  const suffix = `\n… [truncated for demo: ${output.length.toLocaleString('en-US')} chars total]`
  return truncated + suffix + (lostMarkers.length ? `\n${lostMarkers.join('\n')}` : '')
}

function adaptConversation(conv) {
  const adapted = {
    id: conv.id,
    title: conv.title,
    model: conv.model ?? null,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: []
  }
  if (conv.channel) adapted.channel = conv.channel
  if (conv.projectId) adapted.projectId = conv.projectId
  if (conv.icon) adapted.icon = conv.icon
  if (conv.sealed) adapted.sealed = true
  if (conv.stats) adapted.stats = conv.stats
  if (conv.summary) adapted.summary = conv.summary

  adapted.messages = (conv.messages ?? []).map((message) => {
    const out = { ...message }
    delete out.approvals
    // The recorded size describes bytes that no longer ship, and the cards
    // prefer it over the file they actually hold — so a 166 KB sample would
    // render "8 KB". Zeroing it makes every card read the real size.
    if (out.attachments) {
      out.attachments = out.attachments.map((attachment) => ({ ...attachment, sizeBytes: 0 }))
    }
    if (out.segments) {
      out.segments = coalesceText(out.segments).map((segment) =>
        segment.kind === 'tool_result'
          ? { ...segment, output: capToolOutput(segment.output ?? '') }
          : segment
      )
    }
    return out
  })
  return adapted
}

/**
 * Bind conversations to the project whose brief they were plainly working
 * under, matched on title + opening prompt. First match wins, and anything
 * that matches nothing stays unbound — most conversations should, or the
 * Project row stops meaning anything.
 *
 * `icon` is deliberately not stamped: on the desktop that field is the
 * automation/procedure source emoji for the rail badge, not the project's.
 */
function assignProjects(conversations) {
  for (const conv of conversations) {
    const haystack = `${conv.title ?? ''} ${firstUserText(conv)}`.toLowerCase()
    const project = DEMO_PROJECTS.find((candidate) =>
      candidate.match.some((needle) => haystack.includes(needle))
    )
    if (!project) continue
    conv.projectId = project.id
  }
}

/** The projects as they ship — the desktop's Project shape, matchers dropped. */
function projectsForSnapshot(conversations) {
  return DEMO_PROJECTS.map((project) => {
    const bound = conversations.filter((conv) => conv.projectId === project.id)
    // A project predates the conversations spawned from it and is touched by
    // the most recent one; derived from the data so rebuilds stay byte-stable.
    const created = bound.length
      ? Math.min(...bound.map((conv) => conv.createdAt ?? 0)) - 86_400_000
      : 1_767_225_600_000
    const updated = bound.length
      ? Math.max(...bound.map((conv) => conv.updatedAt ?? 0))
      : created + 86_400_000
    return {
      id: project.id,
      title: project.title,
      icon: project.icon,
      instructions: project.instructions,
      files: project.files,
      createdAt: created,
      updatedAt: updated
    }
  })
}

function estimateTokens(text) {
  return Math.max(1, Math.round((text ?? '').length / 4))
}

/** Everything the model saw or produced for one message, in characters. */
function messageChars(message) {
  let chars = (message.content ?? '').length
  for (const segment of message.segments ?? []) {
    if (segment.kind === 'text') chars += (segment.delta ?? '').length
    if (segment.kind === 'tool_result') chars += (segment.output ?? '').length
    if (segment.kind === 'tool_call') chars += JSON.stringify(segment.args ?? {}).length
  }
  return chars
}

function priceTurn(turn) {
  return (
    (turn.inputTokens * RATES.input +
      turn.outputTokens * RATES.output +
      turn.cacheReadTokens * RATES.cacheRead +
      turn.cacheCreationTokens * RATES.cacheWrite) /
    1_000_000
  )
}

/**
 * Give a conversation the stats block the desktop would have written.
 *
 * Two thirds of the dataset predates the stats work (or was folded by a
 * channel that never wrote a meter), so their context meter reads 0 / 0 — the
 * one card in the app with nothing to show. The numbers here are measured off
 * the conversation itself wherever the conversation knows them (turn count,
 * tool calls, per-turn wall time from message timestamps, prompt and output
 * sizes) and priced with the same rate table for the rest. Conversations that
 * already carry real stats are never touched.
 */
function backfillStats(conv) {
  if (conv.stats?.meter && conv.stats?.allTime) return false
  const messages = conv.messages ?? []
  if (messages.length === 0) return false

  const model = conv.model ?? 'deepseek-v4-pro'
  const { window, reserve } = MODEL_WINDOWS[model] ?? DEFAULT_WINDOW
  const provider = model.includes(':') ? 'local' : (model.split(/[-.]/)[0] ?? 'deepseek')

  let context = SYSTEM_PROMPT_TOKENS
  let turns = 0
  let toolCalls = 0
  let apiCalls = 0
  let processingMs = 0
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  let lastTurn = null

  let promptTokens = 0
  let turnStartedAt = null
  for (const message of messages) {
    if (message.role === 'user') {
      promptTokens = estimateTokens(message.content) + (message.attachments?.length ?? 0) * 820
      turnStartedAt = message.timestamp ?? null
      continue
    }
    if (message.role !== 'assistant') continue

    const outputTokens = Math.max(1, Math.round(messageChars(message) / 4))
    const iterations = (message.segments ?? []).filter(
      (segment) => segment.kind === 'turn_end'
    ).length
    const turnToolCalls = (message.segments ?? []).filter(
      (segment) => segment.kind === 'tool_call'
    ).length
    // One API call per iteration; a turn with no turn_end still made one.
    const turnApiCalls = Math.max(1, iterations)
    // Every iteration re-sends the window: cache read scales with them.
    const cacheReadTokens = turns === 0 ? 0 : context * turnApiCalls
    const cacheCreationTokens = turns === 0 ? context : 0
    const inputTokens = Math.max(1, promptTokens) * turnApiCalls
    const elapsedMs =
      turnStartedAt && message.timestamp
        ? Math.max(1000, message.timestamp - turnStartedAt)
        : turnApiCalls * 21_000

    const turn = {
      endedAt: message.timestamp ?? conv.updatedAt,
      elapsedMs,
      apiMs: Math.round(elapsedMs * 0.82),
      apiCalls: turnApiCalls,
      toolCalls: turnToolCalls,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      provider,
      model
    }
    turn.cost = priceTurn(turn)

    context = Math.min(context + promptTokens + outputTokens, Math.floor(window * 0.94))
    turns += 1
    toolCalls += turnToolCalls
    apiCalls += turnApiCalls
    processingMs += elapsedMs
    totals.input += inputTokens
    totals.output += outputTokens
    totals.cacheRead += cacheReadTokens
    totals.cacheWrite += cacheCreationTokens
    totals.cost += turn.cost
    lastTurn = turn
    promptTokens = 0
    turnStartedAt = null
  }

  if (!lastTurn) return false

  conv.stats = {
    allTime: {
      turns,
      apiCalls,
      toolCalls,
      inputTokens: totals.input,
      outputTokens: totals.output,
      cacheReadTokens: totals.cacheRead,
      cacheCreationTokens: totals.cacheWrite,
      cost: totals.cost,
      processingMs,
      elapsedMs: processingMs,
      apiMs: Math.round(processingMs * 0.82),
      endedAt: lastTurn.endedAt,
      provider,
      model
    },
    lastTurn,
    meter: {
      contextTokens: context,
      contextBudget: window,
      compactionAt: Math.floor((window - reserve) * COMPACTION_THRESHOLD),
      model
    }
  }
  return true
}

function cleanRef(rel) {
  let out = rel
  try {
    out = decodeURIComponent(out)
  } catch {
    /* keep raw */
  }
  out = out.replace(/[)\]}>.,'"`…]+$/, '')
  // Regex over-captures from truncated/templated tool text — not real files.
  if (!out || out.includes('${') || out.includes('`') || out.includes('…')) return null
  if (out === 'path' || out.length < 3) return null
  return out
}

function referencedFiles(conv) {
  const refs = new Set()
  const add = (rel) => {
    const cleaned = cleanRef(workspaceRelative(rel))
    if (cleaned) refs.add(cleaned)
  }
  for (const message of conv.messages ?? []) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.filePath) add(attachment.filePath)
    }
    // Rendered prose (user/assistant markdown): both marker kinds render.
    const proseTexts = [message.content ?? '']
    for (const segment of message.segments ?? []) {
      if (segment.kind === 'text') proseTexts.push(segment.delta ?? '')
      if (segment.kind === 'tool_result') {
        const output = segment.output ?? ''
        // Tool output renders as plain text — only delivered-file markers and
        // voice-reply JSON become viewers, so only those files must ship.
        // (Media URIs inside e.g. gif_search listings never render: pulling
        // them dragged in 796 MB of meme cache for nothing.)
        for (const match of output.matchAll(OUTPUT_MARKER_RE)) add(match[1])
        const trimmed = output.trim()
        if (trimmed.startsWith('{') && trimmed.includes('filePath')) {
          try {
            const parsed = JSON.parse(trimmed)
            if (typeof parsed.filePath === 'string') add(parsed.filePath)
          } catch {
            /* not JSON */
          }
        }
      }
    }
    for (const text of proseTexts) {
      for (const match of text.matchAll(OUTPUT_MARKER_RE)) add(match[1])
      for (const match of text.matchAll(MEDIA_URI_RE)) add(match[1])
    }
  }
  return [...refs]
}

/**
 * The workspace's own projects, if it keeps any. File bytes never travel —
 * only the refs, which resolve to published samples by type like every other
 * path in the dataset.
 */
async function workspaceProjects() {
  try {
    const raw = await fs.readFile(path.join(WORKSPACE, 'brain', 'projects.json'), 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((project) => ({
      id: project.id,
      title: project.title ?? '',
      icon: project.icon ?? '📁',
      instructions: project.instructions ?? '',
      files: (project.files ?? []).map((file) => ({
        path: workspaceRelative(file.path ?? ''),
        name: file.name ?? ''
      })),
      createdAt: project.createdAt ?? 0,
      updatedAt: project.updatedAt ?? 0
    }))
  } catch {
    return []
  }
}

/**
 * The brainstem's last-run records for the two compaction jobs, read from
 * brain/brainstem/compaction-meta.json — the same file the desktop panel
 * renders its cards from. The demo has no brainstem, so the records travel in
 * the config snapshot; a missing or malformed file yields nulls and the cards
 * simply never render, exactly as on a desktop that has not compacted yet.
 */
async function compactionRuns() {
  const runs = { daily: null, weekly: null }
  let parsed
  try {
    const raw = await fs.readFile(
      path.join(WORKSPACE, 'brain', 'brainstem', 'compaction-meta.json'),
      'utf8'
    )
    parsed = JSON.parse(raw)
  } catch {
    return runs
  }
  if (!parsed || typeof parsed !== 'object') return runs
  for (const kind of ['daily', 'weekly']) {
    const record = parsed[kind]
    if (!record || typeof record !== 'object') continue
    if (!Number.isFinite(record.at) || !Number.isFinite(record.durationMs)) continue
    if (typeof record.output !== 'string') continue
    runs[kind] = {
      at: record.at,
      durationMs: record.durationMs,
      provider: typeof record.provider === 'string' ? record.provider : null,
      model: typeof record.model === 'string' ? record.model : null,
      inputTokens: Number.isFinite(record.inputTokens) ? record.inputTokens : null,
      outputTokens: Number.isFinite(record.outputTokens) ? record.outputTokens : null,
      output: record.output.slice(0, RUN_OUTPUT_CAP)
    }
  }
  return runs
}

/** Ollama's endpoint and probe budget — the desktop's own (main/ollama.ts). */
const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:11434'
const DETECT_TIMEOUT_MS = 1500

/**
 * Ollama's blob store — the desktop's defaultModelsFolder() verbatim, env
 * override included. The workspace only stores this when the user has picked
 * a folder, so an unset value means "the default", not "unknown".
 */
function defaultModelsFolder() {
  return process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models')
}

/**
 * What the desktop's engine is and has. /api/tags — the desktop's own model
 * listing (main/ollama.ts listTags) — answers only when Ollama is up and its
 * body IS the installed list, so one request settles both the running dot and
 * the model picker. A timeout means not running; a reachable engine whose
 * body won't parse is still running, just with nothing to offer. The phone
 * cannot reach this machine's localhost, so both travel in the snapshot the
 * same way the desktop's version does.
 */
async function probeOllama(endpoint) {
  try {
    const response = await fetch(new URL('/api/tags', endpoint || DEFAULT_LOCAL_ENDPOINT), {
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS)
    })
    if (response.status >= 500) return { running: false, models: [] }
    const body = await response.json().catch(() => null)
    const models = (Array.isArray(body?.models) ? body.models : [])
      .map((entry) => entry?.name)
      .filter((name) => typeof name === 'string' && name.length > 0)
      .sort()
    return { running: true, models }
  } catch {
    return { running: false, models: [] }
  }
}

/** Parse the YAML frontmatter name/description out of a SKILL.md. */
async function skillMeta(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')
    const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim()
    const description = raw.match(/^description:\s*(.+)$/m)?.[1]?.trim()
    return name ? { name, description: description ?? '' } : null
  } catch {
    return null
  }
}

/**
 * The desktop's LOCKED_CAPABILITIES (main/runtime/cerebellum.ts) — the
 * load-bearing built-ins it badges "Core" and never lets you disable. Mirrored
 * here rather than read from the workspace because it is app code, not
 * workspace state: the folder on disk looks identical to any other capability.
 * Keep in sync with the desktop set.
 */
const CORE_CAPABILITIES = new Set([
  'automations',
  'introspect',
  'operating-manual',
  'procedures',
  'projects',
  'secrets',
  'skills',
  'utilities',
  'workflow'
])

/** process.platform under the name a person would recognise it by. */
const PLATFORM_NAMES = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

/**
 * The desktop app itself, for the mobile Updates screen's desktop card: which
 * version is running, on what, and when this snapshot was taken. A checkout
 * that isn't where we guessed leaves the version null — the card shows an em
 * dash rather than inventing a number the user might act on.
 */
async function desktopInfo() {
  let version = null
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(APP_DIR, 'package.json'), 'utf8'))
    if (typeof pkg.version === 'string') version = pkg.version
  } catch {
    console.warn(`desktop version: unknown (no package.json under ${APP_DIR})`)
  }
  return {
    version,
    platform: PLATFORM_NAMES[process.platform] ?? process.platform,
    syncedAt: new Date().toISOString()
  }
}

/**
 * Snapshot the real, non-secret config surface: every cerebellum capability
 * (name + description + enabled + core), MCP servers (names only), service
 * connection state, channel settings, and the llm/preferences knobs. No
 * tokens, keys, or credential values ever leave the workspace: sensitive
 * variables carry their mask, and each provider key is replaced by a
 * same-shaped fake from provider-keys.mjs.
 */
async function buildConfigSnapshot(conversations) {
  const cfg = JSON.parse(await fs.readFile(path.join(WORKSPACE, 'config.json'), 'utf8'))
  const disabled = new Set(cfg.disabledCapabilities ?? [])

  const cerebellumDir = path.join(WORKSPACE, 'brain', 'cerebellum')
  const capabilities = []
  for (const entry of await fs.readdir(cerebellumDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = await skillMeta(path.join(cerebellumDir, entry.name))
    if (!meta) continue
    capabilities.push({
      name: meta.name,
      description: meta.description,
      // Core capabilities can't be disabled upstream, whatever config says.
      enabled: CORE_CAPABILITIES.has(meta.name) || !disabled.has(meta.name),
      official: entry.name.startsWith('.'),
      core: CORE_CAPABILITIES.has(meta.name)
    })
  }
  capabilities.sort((a, b) => a.name.localeCompare(b.name))

  const ollama = await probeOllama(cfg.llm?.local?.endpoint)
  const list = (value) => (Array.isArray(value) ? value : [])
  return {
    capabilities,
    mcpServers: list(cfg.mcp?.servers).map((server) => ({
      name: server.name ?? server.target ?? 'server',
      enabled: server.enabled !== false
    })),
    // Real workspace variables when it has any, the demo set otherwise — the
    // app reads one list either way, exactly as it does for projects below.
    variables: list(cfg.variables).length
      ? list(cfg.variables).map((variable) => ({
          name: variable.name ?? '',
          value: variable.sensitive ? '••••••' : String(variable.value ?? ''),
          sensitive: Boolean(variable.sensitive)
        }))
      : DEMO_VARIABLES,
    // Real projects from the workspace when it has any (brain/projects.json),
    // the demo set otherwise — the app reads one list either way.
    projects: await workspaceProjects(cfg).then((real) =>
      real.length ? real : projectsForSnapshot(conversations)
    ),
    services: {
      google: { status: cfg.google?.status ?? 'inactive', projectId: cfg.google?.projectId ?? '' },
      github: list(cfg.github?.connections).map((c) => ({
        label: c.label ?? '',
        detail: [c.login, c.name].filter(Boolean).join(' · ')
      })),
      notion: list(cfg.notion?.connections).map((c) => ({
        label: c.label ?? '',
        detail: [c.name, c.email].filter(Boolean).join(' · ')
      })),
      braveEnabled: Boolean(cfg.brave?.enabled),
      memesEnabled: Boolean(cfg.memes?.imgflip || cfg.memes?.giphy),
      sttModel: cfg.stt?.defaultModel ?? 'base',
      ttsVoice: cfg.tts?.defaultVoice ?? 'af_bella',
      ttsSpeed: String(cfg.tts?.defaultSpeed ?? '1.0'),
      screenshotMaxWidth: String(cfg.computerUse?.screenshotMaxWidth ?? '1280'),
      screenshotFormat: cfg.computerUse?.screenshotFormat ?? 'jpeg'
    },
    channels: {
      // The one feed-display flag both ends render with. Absent from
      // config.json means the desktop never turned it on, and the clean feed
      // is the default on mobile exactly as it is there.
      inapp: { verbose: Boolean(cfg.inapp?.verbose) },
      telegram: {
        enabled: Boolean(cfg.telegram?.enabled),
        allowedUserIds: list(cfg.telegram?.allowedUserIds).join(', '),
        autoRefresh: cfg.telegram?.autoRefresh !== false,
        staleHours: String(cfg.telegram?.staleHours ?? 3),
        verbose: Boolean(cfg.telegram?.verbose),
        hideAutomations: cfg.telegram?.hideAutomationsFromResume !== false
      },
      whatsapp: {
        enabled: Boolean(cfg.whatsapp?.enabled),
        allowedNumbers: list(cfg.whatsapp?.allowedPhoneNumbers).join(', '),
        autoRefresh: cfg.whatsapp?.autoRefresh !== false,
        staleHours: String(cfg.whatsapp?.staleHours ?? 3),
        verbose: Boolean(cfg.whatsapp?.verbose),
        hideAutomations: cfg.whatsapp?.hideAutomationsFromResume !== false
      }
    },
    llm: {
      brainProvider: cfg.llm?.brain?.providerId ?? 'anthropic',
      brainModel: cfg.llm?.brain?.model ?? 'claude-opus-4-8',
      chatMode: cfg.llm?.mode === 'workflow' ? 'workflow' : 'single',
      localOnly: Boolean(cfg.llm?.localOnly),
      restrictPowerfulModels: cfg.llm?.restrictPowerfulModels !== false,
      local: {
        enabled: Boolean(cfg.llm?.local?.enabled),
        model: cfg.llm?.local?.model ?? null,
        running: ollama.running,
        // Every model pulled on the desktop, so the phone's local picker
        // offers the same list that machine would — not just the one in use.
        models: ollama.models
      },
      providers: list(cfg.llm?.providers).map((provider) => ({
        id: provider.id,
        model: provider.model ?? null,
        hasKey: Boolean(provider.apiKey),
        // The real key never ships. A configured provider gets a synthetic
        // one in the vendor's own format, so the Model panel reads like a
        // real workspace instead of a row of bullets.
        apiKey: provider.apiKey ? demoApiKey(provider.id) : null,
        models: list(provider.models)
      }))
    },
    preferences: {
      launchAtStartup: Boolean(cfg.launchAtStartup),
      bypassPermissions: Boolean(cfg.safety?.bypassPermissions),
      blockCredentials: Boolean(cfg.safety?.blockCredentials),
      weekStartsOn: cfg.weekStartsOn === 0 ? 0 : 1,
      updatesEnabled: cfg.updates?.enabled !== false,
      ollamaModelsFolder: cfg.ollamaModelsFolder || defaultModelsFolder()
    },
    desktop: await desktopInfo(),
    // Schedule from config.json, last runs from the brainstem's meta store —
    // the two halves the desktop's compaction panel reads separately.
    compaction: {
      dailyHour: Number(cfg.compaction?.dailyHour ?? 23),
      weeklyDay: Number(cfg.compaction?.weeklyDay ?? 0),
      weeklyHour: Number(cfg.compaction?.weeklyHour ?? 23),
      runs: await compactionRuns()
    }
  }
}

/**
 * `--config-only`: rewrite demo-data/config-snapshot.json and nothing else.
 *
 * The snapshot is the volatile half of the dataset — engine state, provider
 * keys, the desktop's version — and refreshing it should not mean rebuilding
 * conversations that were already selected, vetted and published. Projects
 * come out identical because they are derived from the same adapted
 * conversations the full build wrote, read back from disk here.
 */
async function rebuildConfigOnly() {
  const convDir = path.join(OUT_DIR, 'conversations')
  let names
  try {
    names = (await fs.readdir(convDir)).filter((name) => name.endsWith('.json'))
  } catch {
    throw new Error(`no built dataset at ${convDir} — run without --config-only first`)
  }
  const adapted = []
  for (const name of names) {
    adapted.push(JSON.parse(await fs.readFile(path.join(convDir, name), 'utf8')))
  }
  const snapshot = await buildConfigSnapshot(adapted)
  await fs.writeFile(path.join(OUT_DIR, 'config-snapshot.json'), JSON.stringify(snapshot, null, 2))
  logSnapshot(snapshot, adapted)
  console.log(`output: ${path.join(OUT_DIR, 'config-snapshot.json')} (conversations untouched)`)
}

/** What the snapshot ended up carrying — both build paths report the same. */
function logSnapshot(snapshot, conversations) {
  console.log(
    `config snapshot: ${snapshot.capabilities.length} capabilities, ${snapshot.mcpServers.length} MCP servers`
  )
  console.log(
    `desktop: v${snapshot.desktop.version ?? '?'} on ${snapshot.desktop.platform}, ` +
      `synced ${snapshot.desktop.syncedAt.slice(0, 16).replace('T', ' ')}`
  )
  console.log(
    `local: ollama ${snapshot.llm.local.running ? 'running' : 'NOT running'}, ` +
      `models folder ${snapshot.preferences.ollamaModelsFolder}`
  )
  console.log(
    `compaction: daily ${snapshot.compaction.dailyHour}:00, weekly day ${snapshot.compaction.weeklyDay} ` +
      `at ${snapshot.compaction.weeklyHour}:00 — last runs: ` +
      ['daily', 'weekly']
        .map((kind) => {
          const run = snapshot.compaction.runs[kind]
          return `${kind} ${run ? new Date(run.at).toISOString().slice(0, 16).replace('T', ' ') : 'none'}`
        })
        .join(', ')
  )
  const counts = new Map()
  for (const conv of conversations) {
    if (conv.projectId) counts.set(conv.projectId, (counts.get(conv.projectId) ?? 0) + 1)
  }
  console.log(
    `projects: ${snapshot.projects.length} — ` +
      snapshot.projects
        .map((project) => `${project.icon} ${project.title} (${counts.get(project.id) ?? 0})`)
        .join(', ')
  )
}

async function main() {
  if (process.argv.includes('--config-only')) return rebuildConfigOnly()

  const convDir = path.join(WORKSPACE, 'brain', 'conversations')
  const names = (await fs.readdir(convDir)).filter((name) => name.endsWith('.json'))
  const all = []
  for (const name of names) {
    try {
      const raw = await fs.readFile(path.join(convDir, name), 'utf8')
      all.push(JSON.parse(raw))
    } catch (error) {
      console.warn(`skip unreadable ${name}: ${error.message}`)
    }
  }

  // ---- Selection ------------------------------------------------------
  const real = all.filter(
    (conv) => conv.channel !== 'heartbeat' && (conv.messages?.length ?? 0) > 0
  )
  const automated = all.filter(
    (conv) => conv.channel === 'heartbeat' && (conv.messages?.length ?? 0) > 0
  )

  const pickRicher = (a, b) => (segmentCount(b) > segmentCount(a) ? b : a)

  const realByKey = new Map()
  for (const conv of real) {
    const key = `${conv.title} ${normalizePrompt(firstUserText(conv))}`
    realByKey.set(key, realByKey.has(key) ? pickRicher(realByKey.get(key), conv) : conv)
  }

  // Automations re-run the same prompt on a schedule — the prompt is the
  // identity, one exemplar each (richest run wins).
  const autoByPrompt = new Map()
  for (const conv of automated) {
    const key = normalizePrompt(firstUserText(conv)) || conv.title
    autoByPrompt.set(key, autoByPrompt.has(key) ? pickRicher(autoByPrompt.get(key), conv) : conv)
  }

  const selected = [...realByKey.values(), ...autoByPrompt.values()]

  // ---- Emit ------------------------------------------------------------
  await fs.rm(OUT_DIR, { recursive: true, force: true })
  await fs.mkdir(path.join(OUT_DIR, 'conversations'), { recursive: true })

  let jsonBytes = 0
  let backfilled = 0
  const referenced = new Set()
  const adaptedAll = []

  for (const conv of selected) {
    const adapted = adaptConversation(conv)
    if (backfillStats(adapted)) backfilled += 1
    adaptedAll.push(adapted)
  }

  // Binding runs over the adapted set so the snapshot's projects and the
  // conversations that reference them are derived from the same objects.
  assignProjects(adaptedAll)

  for (const adapted of adaptedAll) {
    const json = JSON.stringify(adapted)
    jsonBytes += json.length
    await fs.writeFile(path.join(OUT_DIR, 'conversations', `conv-${adapted.id}.json`), json)
    for (const rel of referencedFiles(adapted)) referenced.add(rel)
  }

  // No bytes are copied — the app downloads the published sample for each
  // path's type. A referenced type with no sample renders as unavailable, so
  // it is worth naming here rather than discovering it on a device.
  const unpublished = new Map()
  for (const rel of referenced) {
    if (sampleExtFor(rel)) continue
    const ext = path.extname(rel).slice(1).toLowerCase() || '(none)'
    unpublished.set(ext, (unpublished.get(ext) ?? 0) + 1)
  }

  const snapshot = await buildConfigSnapshot(adaptedAll)
  await fs.writeFile(path.join(OUT_DIR, 'config-snapshot.json'), JSON.stringify(snapshot, null, 2))
  logSnapshot(snapshot, adaptedAll)
  const withMeter = adaptedAll.filter((conv) => conv.stats?.meter).length
  console.log(
    `stats: ${withMeter}/${adaptedAll.length} conversations carry a meter (${backfilled} backfilled)`
  )

  const manifest = {
    builtAt: new Date().toISOString(),
    source: WORKSPACE,
    conversations: selected.length,
    realConversations: realByKey.size,
    automationExemplars: autoByPrompt.size,
    referencedFiles: referenced.size,
    jsonBytes,
    unpublishedTypes: Object.fromEntries([...unpublished].sort())
  }
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log(
    `conversations: ${selected.length} (${realByKey.size} real + ${autoByPrompt.size} automation exemplars)`
  )
  console.log(`json: ${(jsonBytes / 1e6).toFixed(1)} MB, no media copied`)
  console.log(
    `referenced files: ${referenced.size}, served from ${SAMPLE_BASE_URL}` +
      (unpublished.size
        ? `\nno published sample for: ${[...unpublished].map(([e, n]) => `.${e} (${n})`).join(', ')}`
        : '')
  )
  console.log(`output: ${OUT_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
