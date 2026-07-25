#!/usr/bin/env node
/**
 * Build the demo dataset from a real desktop workspace.
 *
 * Selects every unique conversation from ~/.wolffish/workspace (all real
 * user conversations deduped by (title, first prompt), plus one exemplar per
 * distinct automation prompt) and shrinks them for mobile: coalesced text
 * deltas, capped tool outputs, desktop-only observability dropped. Output:
 *
 *   demo-data/conversations/<id>.json
 *   demo-data/manifest.json
 *   demo-data/config-snapshot.json
 *
 * No media is copied. Conversations keep their workspace-relative file paths,
 * and the app downloads the published sample for each path's file type on
 * first view (src/lib/files/sampleFiles.ts) — so the dataset stays a few MB of
 * JSON, no personal media leaves the workspace, and every user sees the same
 * files. The manifest lists any referenced extension with no published sample.
 *
 * Push to a booted simulator with scripts/demo/push-demo-data.sh.
 * Never commit demo-data/ — it derives from personal usage data.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SAMPLE_BASE_URL, sampleExtFor } from './sample-exts.mjs'

const WORKSPACE =
  process.env.WOLFFISH_WORKSPACE ?? path.join(os.homedir(), '.wolffish', 'workspace')
const OUT_DIR = process.env.DEMO_OUT ?? path.join(process.cwd(), 'demo-data')
const TOOL_OUTPUT_CAP = 16 * 1024

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
 * Snapshot the real, non-secret config surface: every cerebellum capability
 * (name + description + enabled), MCP servers (names only), service
 * connection state, channel settings, and the llm/preferences knobs. No
 * tokens, keys, or credential values ever leave the workspace.
 */
async function buildConfigSnapshot() {
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
      enabled: !disabled.has(meta.name),
      official: entry.name.startsWith('.')
    })
  }
  capabilities.sort((a, b) => a.name.localeCompare(b.name))

  const list = (value) => (Array.isArray(value) ? value : [])
  return {
    capabilities,
    mcpServers: list(cfg.mcp?.servers).map((server) => ({
      name: server.name ?? server.target ?? 'server',
      enabled: server.enabled !== false
    })),
    variables: list(cfg.variables).map((variable) => ({
      name: variable.name ?? '',
      value: variable.sensitive ? '••••••' : String(variable.value ?? ''),
      sensitive: Boolean(variable.sensitive)
    })),
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
        model: cfg.llm?.local?.model ?? null
      },
      providers: list(cfg.llm?.providers).map((provider) => ({
        id: provider.id,
        model: provider.model ?? null,
        hasKey: Boolean(provider.apiKey),
        models: list(provider.models)
      }))
    },
    preferences: {
      launchAtStartup: Boolean(cfg.launchAtStartup),
      bypassPermissions: Boolean(cfg.safety?.bypassPermissions),
      blockCredentials: Boolean(cfg.safety?.blockCredentials),
      weekStartsOn: cfg.weekStartsOn === 0 ? 0 : 1,
      updatesEnabled: cfg.updates?.enabled !== false
    }
  }
}

async function main() {
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
  const referenced = new Set()

  for (const conv of selected) {
    const adapted = adaptConversation(conv)
    const json = JSON.stringify(adapted)
    jsonBytes += json.length
    await fs.writeFile(path.join(OUT_DIR, 'conversations', `conv-${conv.id}.json`), json)
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

  const snapshot = await buildConfigSnapshot()
  await fs.writeFile(path.join(OUT_DIR, 'config-snapshot.json'), JSON.stringify(snapshot, null, 2))
  console.log(
    `config snapshot: ${snapshot.capabilities.length} capabilities, ${snapshot.mcpServers.length} MCP servers`
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
