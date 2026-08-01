import type { UsageDay } from '@/lib/usage/stats'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

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
  memesEnabled: boolean
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
  memesEnabled: true,
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
    memesEnabled: boolean
    sttModel: string
    ttsVoice: string
    ttsSpeed: string
    screenshotMaxWidth: string
    screenshotFormat: string
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
    runs?: { daily?: CompactionRunRecord | null; weekly?: CompactionRunRecord | null }
  }
  /**
   * The workspace usage ledger folded per (day × provider × model) — what the
   * Usage screen aggregates on device (lib/usage/stats). Absent in bundles
   * published before the desktop-parity Usage screen shipped; those render
   * zeros and an empty activity grid rather than inventing spend.
   */
  usage?: { days?: UsageDay[] }
}

export type DemoConfigState = DemoConfigValues & {
  /** Read-only service surface state (desktop-managed). */
  services: ServiceStatus[]
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
  /** The one write path — updates a single flat key. */
  setValue: <K extends keyof DemoConfigValues>(key: K, value: DemoConfigValues[K]) => void
  /** Toggle one entry inside a Record<string, boolean> collection. */
  setMapEntry: (key: 'capabilities' | 'mcpServers', name: string, enabled: boolean) => void
  /** Ingest the real-workspace snapshot — the demo's "sync" moment. */
  applySnapshot: (snapshot: ConfigSnapshot) => void
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

/** The store's initial, pre-snapshot shape — DEFAULTS plus what a snapshot fills. */
const INITIAL_STATE = {
  ...DEFAULTS,
  services: READ_ONLY_SERVICES,
  capabilityInfo: {} as DemoConfigState['capabilityInfo'],
  compactionRuns: { daily: null, weekly: null } as CompactionRuns,
  usage: [] as UsageDay[],
  desktop: { version: null, platform: null, syncedAt: null } as DesktopInfo,
  desktopData: sanitizeDesktopData(undefined),
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
      applySnapshot: (snapshot) =>
        set(() => {
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
          return {
            capabilities,
            capabilityInfo,
            mcpServers,
            compactionDailyHour: compaction?.dailyHour ?? DEFAULTS.compactionDailyHour,
            compactionWeeklyDay: compaction?.weeklyDay ?? DEFAULTS.compactionWeeklyDay,
            compactionWeeklyHour: compaction?.weeklyHour ?? DEFAULTS.compactionWeeklyHour,
            compactionRuns: {
              daily: compaction?.runs?.daily ?? null,
              weekly: compaction?.runs?.weekly ?? null
            },
            usage: sanitizeUsageDays(snapshot.usage?.days),
            desktop: {
              version: snapshot.desktop?.version ?? null,
              platform: snapshot.desktop?.platform ?? null,
              syncedAt: snapshot.desktop?.syncedAt ?? null
            },
            desktopData: sanitizeDesktopData(snapshot.data),
            variables: snapshot.variables,
            projects: snapshot.projects ?? [],
            brainProvider: snapshot.llm.brainProvider,
            brainModel: snapshot.llm.brainModel,
            chatMode: snapshot.llm.chatMode,
            localOnly: snapshot.llm.localOnly,
            localEnabled: snapshot.llm.local?.enabled ?? false,
            localModel,
            localModels,
            ollamaRunning: snapshot.llm.local?.running === true,
            ollamaModelsFolder:
              snapshot.preferences.ollamaModelsFolder ?? DEFAULTS.ollamaModelsFolder,
            providers: snapshot.llm.providers ?? [],
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
            memesEnabled: services.memesEnabled,
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
                          browser.browserVersion ? `v${browser.browserVersion.split('.')[0]}` : null,
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
              { key: 'computerUse', connected: true, connections: [] }
            ]
          }
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
          compactionRuns: state.compactionRuns,
          usage: state.usage,
          desktop: state.desktop,
          desktopData: state.desktopData,
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
  useDemoConfig.getState().setValue(key, value)
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
