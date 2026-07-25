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
  models: string[]
}

export type ServiceConnection = { label: string; detail: string }

export type ServiceStatus = {
  /** i18n key suffix under settings.services.items */
  key: string
  connected: boolean
  connections: ServiceConnection[]
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
    connections: [{ label: 'Chrome extension', detail: 'port 8477' }]
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
  providers: DemoProvider[]
  thinkingMode: ThinkingLevel
  restrictPowerfulModels: boolean
  contextOptimization: boolean
  // --- preferences ---
  launchAtStartup: boolean
  bypassPermissions: boolean
  blockCredentials: boolean
  weekStartsOn: 0 | 1
  updatesEnabled: boolean
  // --- channels ---
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
  // --- hippocampus ---
  compactionDailyHour: number
  compactionWeeklyDay: number
  compactionWeeklyHour: number
  // --- collections ---
  capabilities: Record<string, boolean>
  mcpServers: Record<string, boolean>
  variables: DemoVariable[]
}

const DEFAULTS: DemoConfigValues = {
  brainProvider: 'anthropic',
  brainModel: 'claude-opus-4-8',
  chatMode: 'single',
  localOnly: false,
  localEnabled: true,
  localModel: 'gemma4:e2b',
  providers: DEMO_MODELS.filter((entry) => entry.provider !== 'local').map((entry) => ({
    id: entry.provider,
    model: entry.model,
    hasKey: true,
    models: [entry.model]
  })),
  thinkingMode: 'high',
  restrictPowerfulModels: true,
  contextOptimization: true,
  launchAtStartup: false,
  bypassPermissions: true,
  blockCredentials: false,
  weekStartsOn: 1,
  updatesEnabled: true,
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
  compactionDailyHour: 23,
  compactionWeeklyDay: 0,
  compactionWeeklyHour: 23,
  capabilities: DEFAULT_CAPABILITIES,
  mcpServers: DEFAULT_MCP_SERVERS,
  variables: [
    { name: 'HOME_CITY', value: 'Riyadh', sensitive: false },
    { name: 'WORK_HOURS', value: '9:00-18:00', sensitive: false },
    { name: 'NOTION_FINANCE_DB', value: 'a1b2c3d4-…', sensitive: true }
  ]
}

/** The real-workspace snapshot the demo pipeline emits (secrets excluded). */
export type ConfigSnapshot = {
  capabilities: Array<{ name: string; description: string; enabled: boolean; official: boolean }>
  mcpServers: Array<{ name: string; enabled: boolean }>
  variables: DemoVariable[]
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
  }
  channels: {
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
    local: { enabled: boolean; model: string | null }
    providers: DemoProvider[]
  }
  preferences: {
    launchAtStartup: boolean
    bypassPermissions: boolean
    blockCredentials: boolean
    weekStartsOn: 0 | 1
    updatesEnabled: boolean
  }
}

export type DemoConfigState = DemoConfigValues & {
  /** Read-only service surface state (desktop-managed). */
  services: ServiceStatus[]
  /** Capability descriptions from the real workspace's SKILL.md files. */
  capabilityInfo: Record<string, { description: string; official: boolean }>
  /** The one write path — updates a single flat key. */
  setValue: <K extends keyof DemoConfigValues>(key: K, value: DemoConfigValues[K]) => void
  /** Toggle one entry inside a Record<string, boolean> collection. */
  setMapEntry: (key: 'capabilities' | 'mcpServers', name: string, enabled: boolean) => void
  /** Ingest the real-workspace snapshot — the demo's "sync" moment. */
  applySnapshot: (snapshot: ConfigSnapshot) => void
}

export const useDemoConfig = create<DemoConfigState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      services: READ_ONLY_SERVICES,
      capabilityInfo: {},
      setValue: (key, value) => set({ [key]: value } as Partial<DemoConfigState>),
      setMapEntry: (key, name, enabled) =>
        set((state) => ({ [key]: { ...state[key], [name]: enabled } }) as Partial<DemoConfigState>),
      applySnapshot: (snapshot) =>
        set(() => {
          const capabilities: Record<string, boolean> = {}
          const capabilityInfo: Record<string, { description: string; official: boolean }> = {}
          for (const capability of snapshot.capabilities) {
            capabilities[capability.name] = capability.enabled
            capabilityInfo[capability.name] = {
              description: capability.description,
              official: capability.official
            }
          }
          const mcpServers: Record<string, boolean> = {}
          for (const server of snapshot.mcpServers) mcpServers[server.name] = server.enabled
          const { services } = snapshot
          return {
            capabilities,
            capabilityInfo,
            mcpServers,
            variables: snapshot.variables,
            brainProvider: snapshot.llm.brainProvider,
            brainModel: snapshot.llm.brainModel,
            chatMode: snapshot.llm.chatMode,
            localOnly: snapshot.llm.localOnly,
            localEnabled: snapshot.llm.local?.enabled ?? false,
            localModel: snapshot.llm.local?.model ?? '',
            providers: snapshot.llm.providers ?? [],
            restrictPowerfulModels: snapshot.llm.restrictPowerfulModels,
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
                connected: false,
                connections: [{ label: 'Chrome extension', detail: '' }]
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
        const persisted: Record<string, unknown> = { capabilityInfo: state.capabilityInfo }
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
