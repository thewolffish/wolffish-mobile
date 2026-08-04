import type { UsageDay } from '@/lib/usage/stats'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useEffect, useState } from 'react'
import {
  captureOutboxState,
  markOutboxEdited,
  outboxKeysToKeepLocal,
  pushVariables,
  settleOutboxKey
} from '@/lib/sync/outbox'
import { tunnelClient } from '@/lib/tunnel/client'
import { Rpc } from '@/lib/tunnel/protocol'
import { useAppStore } from '@/state/appStore'

/**
 * Demo-mode mirror of the desktop's config.json (workspace.ts
 * WorkspaceConfig). Fully offline: every edit persists locally — when the
 * live Durable Object sync lands, this store becomes the cached copy that
 * renders instantly and refreshes in the background.
 *
 * Performance contract: values are FLAT keys edited through one generic
 * `setValue`, and every row subscribes via `useConfigValue(key)` — a
 * single-field zustand selector. Flipping one switch re-renders exactly one
 * row, never a panel tree, and there is no JSON parse on the edit path.
 */

export type ChatMode = 'single' | 'workflow'
export type ThinkingLevel = 'off' | 'on' | 'high' | 'max'

export type DemoVariable = { name: string; value: string; sensitive: boolean }

/** A cloud provider's surface state — key presence, chosen model, catalog. */
export type DemoProvider = {
  id: string
  model: string | null
  hasKey: boolean
  /**
   * The key the Model panel renders. Always synthetic — the snapshot builder
   * throws the workspace's real key away and mints a same-shaped fake
   * (scripts/demo/provider-keys.mjs). Null when the provider has no key, and
   * absent in bundles published before keys shipped.
   */
  apiKey?: string | null
  models: string[]
}

export type ServiceConnection = { label: string; detail: string }

/**
 * A project — the desktop's Project (main/projects.ts) minus the file bytes:
 * a maintained set of instructions conversations are spawned from. Carried in
 * the config snapshot because it is workspace state, not conversation state;
 * conversations bind to one by the `projectId` stamped on their file.
 */
export type DemoProject = {
  id: string
  title: string
  /** Emoji icon, exactly as the desktop stores it. */
  icon: string
  instructions: string
  files: Array<{ path: string; name: string }>
  createdAt: number
  updatedAt: number
}

export type ServiceStatus = {
  /** i18n key suffix under settings.services.items */
  key: string
  connected: boolean
  connections: ServiceConnection[]
}

/**
 * Last completed run of a compaction job — the desktop's CompactionRunRecord
 * (main/runtime/brainstem.ts) verbatim. Skipped fires never overwrite it, so
 * the card always describes a run that actually produced output.
 */
export type CompactionRunRecord = {
  /** Epoch ms when the run finished. */
  at: number
  durationMs: number
  /** Null for the weekly digest — that pass makes no LLM call. */
  provider: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  /** The run's raw output: daily summary text / weekly digest line. */
  output: string
}

export type CompactionRuns = {
  daily: CompactionRunRecord | null
  weekly: CompactionRunRecord | null
  /** Nightly reflection pass — optional so persisted pre-feature stores parse. */
  reflection?: CompactionRunRecord | null
  /** Monthly deep reflection (internally `deepClean`). */
  deepClean?: CompactionRunRecord | null
}

/** Model catalog for the demo — the models actually seen in the imported data. */
export const DEMO_MODELS: Array<{ provider: string; model: string }> = [
  { provider: 'anthropic', model: 'claude-opus-4-8' },
  { provider: 'anthropic', model: 'claude-sonnet-5' },
  { provider: 'deepseek', model: 'deepseek-v4-pro' },
  { provider: 'kimi', model: 'kimi-k2.5' },
  { provider: 'zai', model: 'glm-5' },
  { provider: 'xai', model: 'grok-5' },
  { provider: 'qwen', model: 'qwen4-max' },
  { provider: 'openai', model: 'gpt-5.6' },
  { provider: 'local', model: 'qwen4:8b' }
]

export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'on', 'high', 'max']

/** Model-name prefixes → provider, for readings that predate provider stamps. */
const MODEL_PREFIXES: Array<[string, string]> = [
  ['claude', 'anthropic'],
  ['gpt', 'openai'],
  ['o1', 'openai'],
  ['deepseek', 'deepseek'],
  ['kimi', 'kimi'],
  ['glm', 'zai'],
  ['grok', 'xai'],
  ['qwen', 'qwen'],
  ['step', 'stepfun'],
  ['minimax', 'minimax'],
  ['mimo', 'mimo'],
  ['gemma', 'ollama'],
  ['llama', 'ollama'],
  ['mistral', 'ollama'],
  ['phi', 'ollama']
]

/**
 * Best-effort provider for a model name. The demo catalog answers first; the
 * imported dataset also carries models it never listed (kimi-k3, glm-5.2), so
 * the prefix table catches those rather than dropping the brand mark.
 */
export function providerForModel(model: string | null | undefined): string | null {
  if (!model) return null
  const known = DEMO_MODELS.find((entry) => entry.model === model)
  if (known) return known.provider === 'local' ? 'ollama' : known.provider
  const lower = model.toLowerCase()
  return MODEL_PREFIXES.find(([prefix]) => lower.startsWith(prefix))?.[1] ?? null
}

const READ_ONLY_SERVICES: ServiceStatus[] = [
  {
    key: 'google',
    connected: true,
    connections: [{ label: 'alturkeyy@gmail.com', detail: 'Gmail · Calendar · Drive' }]
  },
  {
    key: 'github',
    connected: true,
    connections: [{ label: 'younes-alturkey', detail: 'Younes Alturkey' }]
  },
  {
    key: 'notion',
    connected: true,
    connections: [{ label: 'Wolffish HQ', detail: 'younes@wolffi.sh' }]
  },
  {
    key: 'browserExtension',
    connected: false,
    connections: [{ label: 'Chrome extension', detail: 'port 23151' }]
  },
  {
    key: 'computerUse',
    connected: true,
    connections: [{ label: 'macOS', detail: 'screen + input' }]
  }
]

/** Cerebellum capabilities seen in the workspace — togglable like the desktop. */
const DEFAULT_CAPABILITIES: Record<string, boolean> = {
  'web-search': true,
  'browser-automation': true,
  'document-builder': true,
  'meme-forge': true,
  'voice-notes': true,
  'news-butler': true,
  'email-digest': true,
  'screen-watch': false
}

/** MCP servers from the desktop config — enable/disable only, no add/OAuth. */
const DEFAULT_MCP_SERVERS: Record<string, boolean> = {
  'notion-mcp': true,
  'github-mcp': true,
  'filesystem-mcp': false
}

/** The editable config surface — flat keys for single-field subscriptions. */
export type DemoConfigValues = {
  // --- llm / brain ---
  brainProvider: string
  brainModel: string
  chatMode: ChatMode
  localOnly: boolean
  localEnabled: boolean
  localModel: string
  /**
   * Every model pulled on the desktop, from its own /api/tags at snapshot
   * time — the options `localModel` may be set to. Pulling a new one is the
   * desktop's act (it holds the blobs), so this device picks from the list
   * and never adds to it.
   */
  localModels: string[]
  /**
   * Where Ollama keeps its blobs — the desktop's top-level field. Display
   * only: the folder is the desktop's to pick, so this device reports the
   * path it scans and never edits it.
   */
  ollamaModelsFolder: string
  providers: DemoProvider[]
  thinkingMode: ThinkingLevel
  // --- preferences ---
  launchAtStartup: boolean
  restrictPowerfulModels: boolean
  bypassPermissions: boolean
  blockCredentials: boolean
  weekStartsOn: 0 | 1
  updatesEnabled: boolean
  // --- channels ---
  /** inapp.verbose — what the DESKTOP feed displays, not this device's. */
  inappVerbose: boolean
  telegramEnabled: boolean
  telegramAllowedUserIds: string
  telegramVerbose: boolean
  telegramAutoRefresh: boolean
  telegramStaleHours: string
  telegramHideAutomations: boolean
  whatsappEnabled: boolean
  whatsappAllowedNumbers: string
  whatsappVerbose: boolean
  whatsappAutoRefresh: boolean
  whatsappStaleHours: string
  whatsappHideAutomations: boolean
  // --- services (remotely controllable values) ---
  braveEnabled: boolean
  /** The Brave Search key — editable here, saved to the desktop's config. */
  braveApiKey: string
  memesEnabled: boolean
  imgflipUsername: string
  imgflipPassword: string
  giphyApiKey: string
  sttModel: string
  ttsVoice: string
  ttsSpeed: string
  screenshotMaxWidth: string
  screenshotFormat: 'jpeg' | 'png'
  /** browserExtension.* — the pairing port and its own screenshot settings. */
  browserExtensionPort: string
  browserScreenshotMaxWidth: string
  browserScreenshotFormat: 'jpeg' | 'png'
  browserScreenshotQuality: string
  // --- knowledge ---
  compactionDailyHour: number
  compactionWeeklyDay: number
  compactionWeeklyHour: number
  reflectionHour: number
  reflectionQuietHours: number
  reflectionScoringInapp: boolean
  reflectionScoringTelegram: boolean
  reflectionScoringWhatsapp: boolean
  // --- collections ---
  capabilities: Record<string, boolean>
  mcpServers: Record<string, boolean>
  variables: DemoVariable[]
  projects: DemoProject[]
}

/**
 * Keys for the pre-snapshot fallback providers, minted by
 * scripts/demo/provider-keys.mjs so they match the bundle's own values byte
 * for byte. Fake keys for a fake workspace — they authenticate nothing.
 */
const FALLBACK_API_KEYS: Record<string, string> = {
  anthropic: 'sk-ant-api03-0oxuf8dlc1MWVMZUn1in',
  openai: 'sk-proj-eEQ9Qy-tUHqdly572C7wmxwbAq',
  deepseek: 'sk-qwir4ejiom8tcj0inl7rp88vi9xmb1ib',
  kimi: 'sk-oNFw9yjIg8hiBbrEjFvr0ODfLNCnCp',
  zai: '7e701db771ed41f7919b.qLDZdestBoEj',
  xai: 'xai-zyThW2ITW8goiJ8sQhDuCfdA0jXk1p',
  qwen: 'sk-53409f3702e74ff16b4cce5d2eba8bc3'
}

const DEFAULTS: DemoConfigValues = {
  brainProvider: 'anthropic',
  brainModel: 'claude-opus-4-8',
  chatMode: 'single',
  localOnly: false,
  localEnabled: true,
  localModel: 'gemma4:e2b',
  localModels: ['gemma4:e2b'],
  ollamaModelsFolder: '',
  providers: DEMO_MODELS.filter((entry) => entry.provider !== 'local').map((entry) => ({
    id: entry.provider,
    model: entry.model,
    hasKey: true,
    apiKey: FALLBACK_API_KEYS[entry.provider] ?? null,
    models: [entry.model]
  })),
  thinkingMode: 'high',
  launchAtStartup: false,
  restrictPowerfulModels: true,
  bypassPermissions: true,
  blockCredentials: false,
  weekStartsOn: 1,
  updatesEnabled: true,
  inappVerbose: false,
  telegramEnabled: true,
  telegramAllowedUserIds: '429753549',
  telegramVerbose: false,
  telegramAutoRefresh: true,
  telegramStaleHours: '12',
  telegramHideAutomations: true,
  whatsappEnabled: true,
  whatsappAllowedNumbers: '+966501234567',
  whatsappVerbose: false,
  whatsappAutoRefresh: true,
  whatsappStaleHours: '12',
  whatsappHideAutomations: true,
  braveEnabled: true,
  // Demo credentials: fake keys for a fake workspace, same posture as
  // FALLBACK_API_KEYS — they authenticate nothing, they populate fields.
  braveApiKey: 'BSAhxqNe83jP2nQvWwRt5KbAzYdMf',
  memesEnabled: true,
  imgflipUsername: 'youneswolf',
  imgflipPassword: 'imgflp-wlf-2861-pass',
  giphyApiKey: 'gYq8HxTkP2nWvR5bZmA7c3DfLj9S',
  sttModel: 'large-v3-turbo',
  ttsVoice: 'af_heart',
  ttsSpeed: '1.0',
  screenshotMaxWidth: '1280',
  screenshotFormat: 'jpeg',
  browserExtensionPort: '23151',
  browserScreenshotMaxWidth: '1280',
  browserScreenshotFormat: 'jpeg',
  browserScreenshotQuality: '80',
  compactionDailyHour: 23,
  compactionWeeklyDay: 0,
  compactionWeeklyHour: 23,
  // Desktop DEFAULT_REFLECTION: 3 AM, 12 h quiet, every surface scored.
  reflectionHour: 3,
  reflectionQuietHours: 12,
  reflectionScoringInapp: true,
  reflectionScoringTelegram: true,
  reflectionScoringWhatsapp: true,
  capabilities: DEFAULT_CAPABILITIES,
  mcpServers: DEFAULT_MCP_SERVERS,
  variables: [
    { name: 'HOME_CITY', value: 'Riyadh', sensitive: false },
    { name: 'WORK_HOURS', value: '9:00-18:00', sensitive: false },
    { name: 'NOTION_FINANCE_DB', value: 'a1b2c3d4e5f647899abcdef012345678', sensitive: true }
  ],
  // Filled by the config snapshot on demo entry; empty until then.
  projects: []
}

/**
 * The paired desktop app itself — what is running Wolffish on the other end.
 * Every field is null until a snapshot lands: this device knows nothing about
 * a desktop it has never synced with, and a plausible-looking placeholder
 * version would be worse than an em dash.
 */
export type DesktopInfo = {
  /** The desktop app's version, e.g. '1.0.232'. */
  version: string | null
  /** Where it runs — 'macOS', 'Windows', 'Linux'. */
  platform: string | null
  /**
   * IANA zone the desktop's schedules fire in (e.g. 'Asia/Riyadh'). Null
   * until a snapshot carries it — schedule cards then fall back to phone-
   * local time rather than claiming a zone nobody reported.
   */
  timezone: string | null
  /** ISO timestamp the snapshot was taken: how fresh this mirror is. */
  syncedAt: string | null
}

/**
 * The desktop Data panel's numbers as of the last snapshot — disk free/total,
 * the workspace region sizes, and the app process's RAM/CPU. All null until a
 * snapshot lands, and each field renders as an em dash until then: these are
 * that machine's real figures or nothing.
 */
export type DesktopData = {
  freeDiskBytes: number | null
  totalDiskBytes: number | null
  workspaceBytes: number | null
  hippocampusBytes: number | null
  corpusBytes: number | null
  prefrontalBytes: number | null
  ramBytes: number | null
  totalRamBytes: number | null
  /** Share of ONE core, as the desktop samples it — divide by cpuCount. */
  cpuPercent: number | null
  cpuCount: number | null
}

/** The real-workspace snapshot the demo pipeline emits (secrets excluded). */
export type ConfigSnapshot = {
  capabilities: Array<{
    name: string
    description: string
    enabled: boolean
    official: boolean
    /** Locked built-in (desktop's LOCKED_CAPABILITIES). Absent in bundles
     *  published before the capability badges shipped. */
    core?: boolean
    /** Ships a plugin/ runtime. Absent in bundles published before the
     *  tools/plugin chips shipped, as are the two fields below. */
    hasPlugin?: boolean
    /** How many tools the SKILL.md frontmatter declares. */
    toolCount?: number
    /** Capability names this one depends on (frontmatter `requires`). */
    requires?: string[]
  }>
  mcpServers: Array<{ name: string; enabled: boolean }>
  variables: DemoVariable[]
  /** Absent in bundles published before projects shipped. */
  projects?: DemoProject[]
  services: {
    google: { status: string; projectId: string }
    github: ServiceConnection[]
    notion: ServiceConnection[]
    braveEnabled: boolean
    /**
     * The Brave key itself, editable on the phone. Absent in bundles and
     * desktops from before credentials synced — those show the demo default.
     * Real values ride only the end-to-end sealed tunnel.
     */
    braveApiKey?: string
    memesEnabled: boolean
    /** Same contract as braveApiKey, for the Memes providers. */
    memes?: {
      imgflipUsername?: string
      imgflipPassword?: string
      giphyApiKey?: string
    }
    sttModel: string
    ttsVoice: string
    ttsSpeed: string
    screenshotMaxWidth: string
    screenshotFormat: string
    /**
     * Computer use on the desktop — present by construction while the app
     * runs there. Absent in bundles/desktops published before the service
     * card synced; those keep the previous always-connected rendering.
     */
    computerUse?: {
      connected?: boolean
      connections?: ServiceConnection[]
    }
    /** Absent in bundles published before the extension settings shipped. */
    browserExtension?: {
      port?: number
      screenshotMaxWidth?: number
      screenshotFormat?: string
      screenshotQuality?: number
      /** Absent in bundles published before multi-browser shipped. */
      connected?: boolean
      browsers?: Array<{
        browser?: string
        name?: string
        browserVersion?: string
        os?: string
        profileEmail?: string
        extensionVersion?: string
        /** Epoch ms; absent on desktops from before the connection card. */
        connectedAt?: number | null
      }>
    }
  }
  channels: {
    /** Absent in bundles published before the in-app feed setting shipped. */
    inapp?: { verbose?: boolean }
    telegram: {
      enabled: boolean
      allowedUserIds: string
      autoRefresh: boolean
      staleHours: string
      verbose: boolean
      hideAutomations: boolean
    }
    whatsapp: {
      enabled: boolean
      allowedNumbers: string
      autoRefresh: boolean
      staleHours: string
      verbose: boolean
      hideAutomations: boolean
    }
  }
  llm: {
    brainProvider: string
    brainModel: string
    chatMode: ChatMode
    localOnly: boolean
    restrictPowerfulModels: boolean
    /**
     * The Brain model's thinking level, when one has been chosen on the
     * desktop. Absent in bundles published before thinking synced — those
     * keep the device's last value rather than inventing a choice.
     */
    thinkingMode?: string
    local: {
      enabled: boolean
      model: string | null
      /**
       * Did Ollama answer when the desktop took this snapshot? Absent in
       * bundles published before the local card showed engine state — those
       * fall back to "not running" rather than claiming a link nobody probed.
       */
      running?: boolean
      /**
       * The engine's installed models. Absent in bundles published before the
       * local picker shipped — those fall back to the chosen model alone,
       * never to an empty sheet.
       */
      models?: string[]
    }
    providers: DemoProvider[]
  }
  preferences: {
    launchAtStartup: boolean
    bypassPermissions: boolean
    blockCredentials: boolean
    weekStartsOn: 0 | 1
    updatesEnabled: boolean
    /** Absent in bundles published before the advanced controls shipped. */
    ollamaModelsFolder?: string
  }
  /**
   * The desktop app on the other end. Absent in bundles published before the
   * Updates screen's desktop card shipped.
   */
  desktop?: {
    version?: string | null
    platform?: string | null
    /** Absent in bundles/desktops from before the timezone rode along. */
    timezone?: string | null
    syncedAt?: string | null
  }
  /**
   * The desktop Data panel's numbers at snapshot time. Absent in bundles
   * published before the Data screen's desktop card shipped — those render
   * em dashes rather than inventing a machine.
   */
  data?: {
    freeDiskBytes?: number | null
    totalDiskBytes?: number | null
    workspaceBytes?: number
    hippocampusBytes?: number
    corpusBytes?: number
    prefrontalBytes?: number
    ramBytes?: number
    totalRamBytes?: number
    cpuPercent?: number
    cpuCount?: number
  }
  /**
   * Compaction schedule + the brainstem's last-run records. Absent in bundles
   * published before the last-run cards shipped, so every field falls back.
   */
  compaction?: {
    dailyHour?: number
    weeklyDay?: number
    weeklyHour?: number
    runs?: {
      daily?: CompactionRunRecord | null
      weekly?: CompactionRunRecord | null
      /** The reflection jobs report through the same brainstem meta file.
       *  Absent in bundles/desktops from before reflection shipped. */
      reflection?: CompactionRunRecord | null
      deepClean?: CompactionRunRecord | null
    }
  }
  /**
   * Reflection schedule + per-surface turn scoring. Absent in bundles or
   * desktops from before reflection shipped — those render the desktop's own
   * defaults (3 AM, 12 h quiet, every surface scored), which is exactly what
   * an unset config means upstream.
   */
  reflection?: {
    hour?: number
    quietHours?: number
    scoring?: { inapp?: boolean; telegram?: boolean; whatsapp?: boolean }
  }
  /**
   * The workspace usage ledger folded per (day × provider × model) — what the
   * Usage screen aggregates on device (lib/usage/stats). Absent in bundles
   * published before the desktop-parity Usage screen shipped; those render
   * zeros and an empty activity grid rather than inventing spend.
   */
  usage?: { days?: UsageDay[] }
  /**
   * The desktop app's own release notes — which months exist, newest first.
   * Bodies deliberately do NOT ride the snapshot: the full set is hundreds of
   * KB, so the phone fetches one month at a time (Rpc.changelogRead) when the
   * reader actually opens it. Absent in bundles/desktops from before desktop
   * notes synced; those render the What's-new desktop tab's empty state.
   */
  changelog?: { months?: string[] }
}

/**
 * How a snapshot lands. `keepLocal` names keys whose local value must survive
 * this application — the phone holds edits for them that the desktop has not
 * acknowledged yet, or the fetch raced a write (lib/sync/outbox decides).
 * Desktop truth for those keys returns on the next quiet refresh.
 */
export type ApplySnapshotOptions = {
  keepLocal?: ReadonlyArray<keyof DemoConfigValues>
}

/** One connected browser, as the desktop's extension panel shows it. */
export type ExtensionBrowser = {
  /** Slug for the logo: chrome / brave / edge / chromium / firefox / safari. */
  browser: string
  name: string
  browserVersion: string | null
  os: string | null
  profileEmail: string | null
  extensionVersion: string | null
  connectedAt: number | null
}

export type DemoConfigState = DemoConfigValues & {
  /** Read-only service surface state (desktop-managed). */
  services: ServiceStatus[]
  /**
   * Live browser-extension connections — desktop-managed, display only, the
   * rows behind the Services screen's browser cards.
   */
  extensionBrowsers: ExtensionBrowser[]
  /** Capability descriptions from the real workspace's SKILL.md files. */
  capabilityInfo: Record<
    string,
    {
      description: string
      official: boolean
      core: boolean
      hasPlugin: boolean
      toolCount: number
      requires: string[]
    }
  >
  /**
   * Last completed daily/weekly compaction — desktop-managed, display only.
   * Not part of DemoConfigValues: nothing here is editable on this device.
   */
  compactionRuns: CompactionRuns
  /**
   * The usage ledger rows from the snapshot — desktop-managed, display only,
   * same contract as compactionRuns. Empty until a snapshot lands.
   */
  usage: UsageDay[]
  /** The paired desktop app's own version and platform — display only. */
  desktop: DesktopInfo
  /**
   * The desktop Data panel's numbers — desktop-managed, display only, same
   * contract as `desktop`: this device cannot measure that machine, so the
   * figures travel in the snapshot instead of being probed here.
   */
  desktopData: DesktopData
  /**
   * Was Ollama answering on the desktop at last sync? Desktop-managed like
   * `desktop`: this device cannot reach that machine's localhost, so the
   * engine's state travels in the snapshot instead of being probed here.
   */
  ollamaRunning: boolean
  /**
   * Months the desktop's own release notes cover, newest first — the What's
   * new screen's desktop tab. Display-only like `desktop`: the notes belong
   * to that app's build, so the list travels in the snapshot and the bodies
   * are fetched on demand (lib/changelog readDesktopChangelog).
   */
  desktopChangelogMonths: string[]
  /** The one write path — updates a single flat key. */
  setValue: <K extends keyof DemoConfigValues>(key: K, value: DemoConfigValues[K]) => void
  /** Toggle one entry inside a Record<string, boolean> collection. */
  setMapEntry: (key: 'capabilities' | 'mcpServers', name: string, enabled: boolean) => void
  /** Ingest the real-workspace snapshot — the demo's "sync" moment. */
  applySnapshot: (snapshot: ConfigSnapshot, opts?: ApplySnapshotOptions) => void
  /**
   * Back to factory defaults, including this device's own edits. Used when a
   * republished bundle replaces the dataset (lib/demo/reset): applySnapshot
   * only writes the keys a snapshot carries, so without this a value the new
   * bundle dropped — a capability, a project, a variable, a toggle flipped on
   * this phone — would survive the refresh and describe a workspace that no
   * longer exists.
   */
  reset: () => void
}

/**
 * Keep only well-formed ledger rows, sorted by date. The builder controls the
 * data, so this is belt-and-braces against a hand-edited or truncated bundle —
 * a malformed row must cost itself, not the whole Usage screen.
 */
function sanitizeUsageDays(days: unknown): UsageDay[] {
  if (!Array.isArray(days)) return []
  const clean: UsageDay[] = []
  for (const day of days as Array<Partial<UsageDay>>) {
    if (typeof day?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue
    const models = Array.isArray(day.models)
      ? day.models.filter(
          (row) =>
            typeof row?.provider === 'string' &&
            typeof row?.model === 'string' &&
            Number.isFinite(row?.inputTokens) &&
            Number.isFinite(row?.outputTokens) &&
            Number.isFinite(row?.cost) &&
            Number.isFinite(row?.entries)
        )
      : []
    const braveQueries = Number.isFinite(day.braveQueries) ? (day.braveQueries as number) : 0
    if (models.length === 0 && braveQueries === 0) continue
    clean.push({ date: day.date, models, braveQueries })
  }
  return clean.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Keep a DesktopData field only when it is a real, non-negative number. The
 * builder controls the data, so this is the same belt-and-braces as
 * sanitizeUsageDays: a hand-edited bundle must cost the one figure it
 * corrupted, not the whole desktop card.
 */
function sanitizeDesktopData(data: ConfigSnapshot['data']): DesktopData {
  const num = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  return {
    freeDiskBytes: num(data?.freeDiskBytes),
    totalDiskBytes: num(data?.totalDiskBytes),
    workspaceBytes: num(data?.workspaceBytes),
    hippocampusBytes: num(data?.hippocampusBytes),
    corpusBytes: num(data?.corpusBytes),
    prefrontalBytes: num(data?.prefrontalBytes),
    ramBytes: num(data?.ramBytes),
    totalRamBytes: num(data?.totalRamBytes),
    cpuPercent: num(data?.cpuPercent),
    cpuCount: num(data?.cpuCount)
  }
}

/**
 * Months the snapshot's changelog section names, cleaned to `YYYY-MM` keys,
 * deduped, newest first. Same belt-and-braces as the sanitizers above: a
 * malformed month must cost itself, not the whole What's-new tab.
 */
function sanitizeChangelogMonths(months: unknown): string[] {
  if (!Array.isArray(months)) return []
  const clean = months.filter(
    (month): month is string => typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)
  )
  return [...new Set(clean)].sort().reverse()
}

/** The store's initial, pre-snapshot shape — DEFAULTS plus what a snapshot fills. */
const INITIAL_STATE = {
  ...DEFAULTS,
  services: READ_ONLY_SERVICES,
  extensionBrowsers: [] as ExtensionBrowser[],
  capabilityInfo: {} as DemoConfigState['capabilityInfo'],
  compactionRuns: { daily: null, weekly: null } as CompactionRuns,
  usage: [] as UsageDay[],
  desktop: { version: null, platform: null, timezone: null, syncedAt: null } as DesktopInfo,
  desktopData: sanitizeDesktopData(undefined),
  desktopChangelogMonths: [] as string[],
  ollamaRunning: false
}

export const useDemoConfig = create<DemoConfigState>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,
      reset: () => set(() => INITIAL_STATE),
      setValue: (key, value) => set({ [key]: value } as Partial<DemoConfigState>),
      setMapEntry: (key, name, enabled) =>
        set((state) => ({ [key]: { ...state[key], [name]: enabled } }) as Partial<DemoConfigState>),
      applySnapshot: (snapshot, opts) =>
        set((state) => {
          const capabilities: Record<string, boolean> = {}
          const capabilityInfo: DemoConfigState['capabilityInfo'] = {}
          for (const capability of snapshot.capabilities) {
            const core = capability.core === true
            // A locked capability is on by definition upstream — never let a
            // stale snapshot entry render one as inactive with no way back.
            capabilities[capability.name] = core || capability.enabled
            capabilityInfo[capability.name] = {
              description: capability.description,
              official: capability.official,
              core,
              hasPlugin: capability.hasPlugin === true,
              toolCount: capability.toolCount ?? 0,
              requires: capability.requires ?? []
            }
          }
          const mcpServers: Record<string, boolean> = {}
          for (const server of snapshot.mcpServers) mcpServers[server.name] = server.enabled
          const { services } = snapshot
          const compaction = snapshot.compaction
          // The picker's options. A bundle from before the tag list shipped
          // has only the chosen model to offer, and one option beats a sheet
          // that opens on nothing.
          const localModel = snapshot.llm.local?.model ?? ''
          const localModels = snapshot.llm.local?.models?.length
            ? snapshot.llm.local.models
            : localModel
              ? [localModel]
              : []
          const applied: Partial<DemoConfigState> = {
            capabilities,
            capabilityInfo,
            mcpServers,
            compactionDailyHour: compaction?.dailyHour ?? DEFAULTS.compactionDailyHour,
            compactionWeeklyDay: compaction?.weeklyDay ?? DEFAULTS.compactionWeeklyDay,
            compactionWeeklyHour: compaction?.weeklyHour ?? DEFAULTS.compactionWeeklyHour,
            reflectionHour: snapshot.reflection?.hour ?? DEFAULTS.reflectionHour,
            reflectionQuietHours: snapshot.reflection?.quietHours ?? DEFAULTS.reflectionQuietHours,
            reflectionScoringInapp:
              snapshot.reflection?.scoring?.inapp ?? DEFAULTS.reflectionScoringInapp,
            reflectionScoringTelegram:
              snapshot.reflection?.scoring?.telegram ?? DEFAULTS.reflectionScoringTelegram,
            reflectionScoringWhatsapp:
              snapshot.reflection?.scoring?.whatsapp ?? DEFAULTS.reflectionScoringWhatsapp,
            compactionRuns: {
              daily: compaction?.runs?.daily ?? null,
              weekly: compaction?.runs?.weekly ?? null,
              reflection: compaction?.runs?.reflection ?? null,
              deepClean: compaction?.runs?.deepClean ?? null
            },
            usage: sanitizeUsageDays(snapshot.usage?.days),
            desktop: {
              version: snapshot.desktop?.version ?? null,
              platform: snapshot.desktop?.platform ?? null,
              timezone: snapshot.desktop?.timezone ?? null,
              syncedAt: snapshot.desktop?.syncedAt ?? null
            },
            desktopData: sanitizeDesktopData(snapshot.data),
            desktopChangelogMonths: sanitizeChangelogMonths(snapshot.changelog?.months),
            // Tolerate one protocol generation of drift: a desktop from
            // before the shape fix sent `{key, value}` rows. The phone
            // renders whichever field exists rather than a blank list.
            // Nameless rows are this phone's drafts — added here but not yet
            // named, so the desktop cannot hold them (its own panel refuses a
            // nameless save, and the outbox never sends one). They ride along
            // at the end instead of vanishing mid-compose.
            variables: [
              ...(snapshot.variables ?? [])
                .map((variable) => ({
                  name: variable.name ?? (variable as { key?: string }).key ?? '',
                  value: variable.value ?? '',
                  sensitive: variable.sensitive === true
                }))
                .filter((variable) => variable.name),
              ...state.variables.filter((variable) => !variable.name.trim())
            ],
            projects: snapshot.projects ?? [],
            brainProvider: snapshot.llm.brainProvider,
            brainModel: snapshot.llm.brainModel,
            chatMode: snapshot.llm.chatMode,
            localOnly: snapshot.llm.localOnly,
            ...(THINKING_LEVELS.includes(snapshot.llm.thinkingMode as ThinkingLevel)
              ? { thinkingMode: snapshot.llm.thinkingMode as ThinkingLevel }
              : {}),
            localEnabled: snapshot.llm.local?.enabled ?? false,
            localModel,
            localModels,
            ollamaRunning: snapshot.llm.local?.running === true,
            ollamaModelsFolder:
              snapshot.preferences.ollamaModelsFolder ?? DEFAULTS.ollamaModelsFolder,
            // Same tolerance for providers: an older desktop sent
            // `{id, model, connected}` — surface it as key presence with the
            // chosen model as the whole catalog, never a broken card.
            providers: (snapshot.llm.providers ?? []).map((provider) => ({
              id: provider.id,
              model: provider.model ?? null,
              hasKey: provider.hasKey ?? (provider as { connected?: boolean }).connected === true,
              apiKey: provider.apiKey ?? null,
              models: provider.models?.length
                ? provider.models
                : provider.model
                  ? [provider.model]
                  : []
            })),
            restrictPowerfulModels: snapshot.llm.restrictPowerfulModels,
            inappVerbose: snapshot.channels.inapp?.verbose ?? DEFAULTS.inappVerbose,
            launchAtStartup: snapshot.preferences.launchAtStartup,
            bypassPermissions: snapshot.preferences.bypassPermissions,
            blockCredentials: snapshot.preferences.blockCredentials,
            weekStartsOn: snapshot.preferences.weekStartsOn,
            updatesEnabled: snapshot.preferences.updatesEnabled,
            telegramEnabled: snapshot.channels.telegram.enabled,
            telegramAllowedUserIds: snapshot.channels.telegram.allowedUserIds,
            telegramAutoRefresh: snapshot.channels.telegram.autoRefresh,
            telegramStaleHours: snapshot.channels.telegram.staleHours,
            telegramVerbose: snapshot.channels.telegram.verbose,
            telegramHideAutomations: snapshot.channels.telegram.hideAutomations,
            whatsappEnabled: snapshot.channels.whatsapp.enabled,
            whatsappAllowedNumbers: snapshot.channels.whatsapp.allowedNumbers,
            whatsappAutoRefresh: snapshot.channels.whatsapp.autoRefresh,
            whatsappStaleHours: snapshot.channels.whatsapp.staleHours,
            whatsappVerbose: snapshot.channels.whatsapp.verbose,
            whatsappHideAutomations: snapshot.channels.whatsapp.hideAutomations,
            braveEnabled: services.braveEnabled,
            // `?? DEFAULTS`: a desktop that HAS no key sends '' (kept); only a
            // source from before credentials synced omits the field entirely,
            // and those get the demo fakes exactly as before.
            braveApiKey: services.braveApiKey ?? DEFAULTS.braveApiKey,
            memesEnabled: services.memesEnabled,
            imgflipUsername: services.memes?.imgflipUsername ?? DEFAULTS.imgflipUsername,
            imgflipPassword: services.memes?.imgflipPassword ?? DEFAULTS.imgflipPassword,
            giphyApiKey: services.memes?.giphyApiKey ?? DEFAULTS.giphyApiKey,
            sttModel: services.sttModel,
            ttsVoice: services.ttsVoice,
            ttsSpeed: services.ttsSpeed,
            screenshotMaxWidth: services.screenshotMaxWidth,
            screenshotFormat: services.screenshotFormat === 'png' ? 'png' : 'jpeg',
            browserExtensionPort: `${services.browserExtension?.port ?? DEFAULTS.browserExtensionPort}`,
            browserScreenshotMaxWidth: `${services.browserExtension?.screenshotMaxWidth ?? DEFAULTS.browserScreenshotMaxWidth}`,
            browserScreenshotFormat:
              services.browserExtension?.screenshotFormat === 'png' ? 'png' : 'jpeg',
            browserScreenshotQuality: `${services.browserExtension?.screenshotQuality ?? DEFAULTS.browserScreenshotQuality}`,
            // Raw connection entries for the desktop-style browser cards —
            // slug for the logo, the identity lines, and when it connected.
            extensionBrowsers: (services.browserExtension?.browsers ?? []).map((browser) => ({
              browser: browser.browser ?? '',
              name: browser.name ?? 'Browser',
              browserVersion: browser.browserVersion ?? null,
              os: browser.os ?? null,
              profileEmail: browser.profileEmail ?? null,
              extensionVersion: browser.extensionVersion ?? null,
              connectedAt: typeof browser.connectedAt === 'number' ? browser.connectedAt : null
            })),
            services: [
              {
                key: 'google',
                connected: services.google.status === 'active',
                connections: services.google.projectId
                  ? [{ label: services.google.projectId, detail: 'Gmail · Calendar · Drive' }]
                  : []
              },
              {
                key: 'github',
                connected: services.github.length > 0,
                connections: services.github
              },
              {
                key: 'notion',
                connected: services.notion.length > 0,
                connections: services.notion
              },
              {
                key: 'browserExtension',
                connected:
                  services.browserExtension?.connected ??
                  (services.browserExtension?.browsers?.length ?? 0) > 0,
                connections: services.browserExtension?.browsers?.length
                  ? services.browserExtension.browsers.map((browser) => ({
                      label: browser.name ?? 'Browser',
                      detail:
                        [
                          browser.profileEmail ?? null,
                          browser.browserVersion
                            ? `v${browser.browserVersion.split('.')[0]}`
                            : null,
                          browser.os ?? null
                        ]
                          .filter(Boolean)
                          .join(' · ') ||
                        `port ${services.browserExtension?.port ?? DEFAULTS.browserExtensionPort}`
                    }))
                  : [
                      {
                        label: 'Chrome extension',
                        detail: `port ${services.browserExtension?.port ?? DEFAULTS.browserExtensionPort}`
                      }
                    ]
              },
              {
                key: 'computerUse',
                // Synced when the desktop sends it; the historical constant
                // otherwise, so old demo bundles render exactly as before.
                connected: services.computerUse?.connected ?? true,
                connections: services.computerUse?.connections ?? []
              }
            ]
          }
          // Keys mid-edit on this phone keep their local value — a snapshot
          // that raced a write must not undo it under the user's thumb. The
          // outbox names them (see refreshConfigSnapshot); desktop truth for
          // those keys returns on the next quiet refresh.
          for (const key of opts?.keepLocal ?? []) {
            ;(applied as Record<string, unknown>)[key] = state[key]
          }
          return applied
        })
    }),
    {
      name: 'wolffish.demo-config',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persisted) => persisted as DemoConfigState,
      // Editable values + snapshot-derived metadata persist; functions and
      // the rebuilt-on-apply services array do not.
      partialize: (state) => {
        const persisted: Record<string, unknown> = {
          capabilityInfo: state.capabilityInfo,
          extensionBrowsers: state.extensionBrowsers,
          compactionRuns: state.compactionRuns,
          usage: state.usage,
          desktop: state.desktop,
          desktopData: state.desktopData,
          desktopChangelogMonths: state.desktopChangelogMonths,
          ollamaRunning: state.ollamaRunning
        }
        for (const key of Object.keys(DEFAULTS) as Array<keyof DemoConfigValues>) {
          persisted[key] = state[key]
        }
        return persisted as Partial<DemoConfigState>
      }
    }
  )
)

/** Single-field subscription — a row re-renders only when ITS value changes. */
export function useConfigValue<K extends keyof DemoConfigValues>(key: K): DemoConfigValues[K] {
  return useDemoConfig((state) => state[key])
}

export function setConfigValue<K extends keyof DemoConfigValues>(
  key: K,
  value: DemoConfigValues[K]
): void {
  // Paired settings belong to the desktop: this store is a copy of its
  // snapshot, and the next refresh overwrites whatever was set here. Offline
  // that refresh cannot happen, so an edit would sit on screen looking
  // applied until the connection returned and silently undid it. Refusing is
  // the honest answer — see useSettingsReadOnly, which says so in the UI.
  if (settingsAreReadOnly()) return
  useDemoConfig.getState().setValue(key, value)
  // Variables burst per keystroke and need coalescing plus echo protection —
  // they travel through the outbox (whole array, debounced, one in flight),
  // not the per-toggle path below. Demo mode has no tunnel; the outbox
  // no-ops and the edit stays local, exactly as before.
  if (key === 'variables') {
    pushVariables(value as DemoVariable[])
    return
  }
  void pushToDesktop(key, value)
}

/**
 * The settings the desktop accepts from this device — the Rpc.configSet
 * whitelist, mirrored. Every key here is written through the same desktop
 * setters its own panel uses, so a flip on this screen and a flip there are
 * the same change. Keys outside this set stay purely local (demo mode), or
 * are desktop-owned mirrors a snapshot refresh will overwrite.
 */
const DESKTOP_EDITABLE: ReadonlySet<keyof DemoConfigValues> = new Set<keyof DemoConfigValues>([
  'restrictPowerfulModels',
  'bypassPermissions',
  'blockCredentials',
  'updatesEnabled',
  // Services — the whole editable surface of that screen, credentials
  // included. The extension PORT is deliberately absent on both sides:
  // moving it restarts the desktop's local pairing server.
  'braveEnabled',
  'braveApiKey',
  'memesEnabled',
  'imgflipUsername',
  'imgflipPassword',
  'giphyApiKey',
  'sttModel',
  'ttsVoice',
  'ttsSpeed',
  'screenshotMaxWidth',
  'screenshotFormat',
  'browserScreenshotMaxWidth',
  'browserScreenshotFormat',
  'browserScreenshotQuality'
])

/**
 * Write one edited setting through to the paired desktop.
 *
 * The local set has already happened (the row must move under the finger);
 * this makes it true on the machine that owns it. Confirmation is the
 * desktop's own config.changed push — it announces the write exactly as it
 * announces an edit made in its panel, and the phone refetches the snapshot
 * on that signal, so both screens converge on what the desktop persisted.
 *
 * On error the optimistic value is a lie this mirror must not keep telling:
 * re-pull the snapshot so the row snaps back to the desktop's truth. If even
 * that fails the link is gone, and the reconcile that runs on every reconnect
 * settles it the same way.
 */
async function pushToDesktop<K extends keyof DemoConfigValues>(
  key: K,
  value: DemoConfigValues[K]
): Promise<void> {
  if (!DESKTOP_EDITABLE.has(key)) return
  const tunnel = tunnelClient.active
  if (!tunnel) return
  // Dirty from this very tick: a snapshot request already in the air was
  // answered before the desktop saw this write, and without the epoch moving
  // it would put the old value back under the user's thumb — the flip would
  // snap back for the second it takes the desktop's own confirmation push to
  // arrive. Settled in both outcomes; the failure path's refresh IS desktop
  // truth, so the key must be free to accept it.
  markOutboxEdited(key)
  try {
    await tunnel.rpc(Rpc.configSet, { settings: { [key]: value } })
    settleOutboxKey(key)
  } catch {
    settleOutboxKey(key)
    try {
      // Guarded, not raw: the revert must not also clobber some OTHER key
      // the outbox still has in flight (a variables edit mid-typing, say).
      await refreshConfigSnapshot()
    } catch {
      // Disconnected mid-revert — the on-reconnect reconcile pulls a fresh
      // snapshot and corrects this row along with everything else.
    }
  }
}

/**
 * Save one setting and wait for the desktop to accept it — the explicit path
 * for credential fields, where the row shows the same saved/failed
 * confirmation the desktop's own panels show. The fire-and-forget
 * setConfigValue path is for switches and selects, whose confirmation is the
 * value simply holding; a typed secret deserves an answer.
 *
 * Resolves true when the value is safely on the machine that owns it (or in
 * demo mode, where local IS the whole truth); false reverts the row to
 * desktop truth via the snapshot re-pull.
 */
export async function saveDesktopSetting<K extends keyof DemoConfigValues>(
  key: K,
  value: DemoConfigValues[K]
): Promise<boolean> {
  if (settingsAreReadOnly()) return false
  useDemoConfig.getState().setValue(key, value)
  const { paired } = useAppStore.getState()
  if (!paired) return true
  if (!DESKTOP_EDITABLE.has(key)) return false
  const tunnel = tunnelClient.active
  if (!tunnel || !tunnelClient.connected) return false
  // Same in-flight guard as pushToDesktop: dirty for the round trip, so a
  // racing snapshot cannot undo the row while the desktop's answer is due.
  markOutboxEdited(key)
  try {
    await tunnel.rpc(Rpc.configSet, { settings: { [key]: value } })
    settleOutboxKey(key)
    return true
  } catch {
    settleOutboxKey(key)
    try {
      await refreshConfigSnapshot()
    } catch {
      // Disconnected mid-revert — the on-reconnect reconcile settles it.
    }
    return false
  }
}

/**
 * Fetch the desktop's snapshot and apply it with the outbox consulted: the
 * epochs are captured before the fetch, and any key edited, acknowledged, or
 * abandoned while the fetch was in the air — plus any key still dirty — keeps
 * its local value this round. Every paired-mode snapshot application belongs
 * here (lib/sync wraps this; the raw applySnapshot is for the demo pipeline,
 * which has no outbox to race).
 *
 * Lives beside the store rather than in lib/sync because both need it and
 * only this module sits below the two of them in the import graph.
 */
export async function refreshConfigSnapshot(): Promise<void> {
  const tunnel = tunnelClient.active
  if (!tunnel) return
  const before = captureOutboxState()
  const snapshot = (await tunnel.rpc(Rpc.configSnapshot)) as ConfigSnapshot
  const keepLocal = outboxKeysToKeepLocal(before) as Array<keyof DemoConfigValues>
  useDemoConfig.getState().applySnapshot(snapshot, keepLocal.length ? { keepLocal } : undefined)
}

/**
 * Settings are the desktop's to change, and only reachable while connected.
 * Demo mode owns its own config outright, so it is always writable.
 */
export function settingsAreReadOnly(): boolean {
  const { paired } = useAppStore.getState()
  return paired && !tunnelClient.connected
}

/** Reactive form of the above, for screens that need to disable their controls. */
export function useSettingsReadOnly(): boolean {
  const paired = useAppStore((state) => state.paired)
  const [connected, setConnected] = useState(tunnelClient.connected)
  useEffect(() => tunnelClient.subscribe((state) => setConnected(state.status === 'connected')), [])
  return paired && !connected
}

/** The last daily/weekly compaction runs — null until one has actually run. */
export function useCompactionRuns(): CompactionRuns {
  return useDemoConfig((state) => state.compactionRuns)
}

/** The snapshot's usage ledger rows — empty until a snapshot has landed. */
export function useUsageDays(): UsageDay[] {
  return useDemoConfig((state) => state.usage)
}

/** The paired desktop app — all-null until a config snapshot has landed. */
export function useDesktopInfo(): DesktopInfo {
  return useDemoConfig((state) => state.desktop)
}

/** The desktop's Data-panel numbers — all-null until a snapshot has landed. */
export function useDesktopData(): DesktopData {
  return useDemoConfig((state) => state.desktopData)
}

/** Desktop release-note months, newest first — empty until a snapshot lands. */
export function useDesktopChangelogMonths(): string[] {
  return useDemoConfig((state) => state.desktopChangelogMonths)
}

/**
 * Resolve a conversation's `projectId` to the project it belongs to. Returns
 * null for an unbound conversation, and for an id whose project the snapshot
 * no longer carries (deleted upstream) — callers fall back to the raw id.
 */
export function useProject(projectId: string | null | undefined): DemoProject | null {
  return useDemoConfig((state) =>
    projectId ? (state.projects.find((project) => project.id === projectId) ?? null) : null
  )
}
