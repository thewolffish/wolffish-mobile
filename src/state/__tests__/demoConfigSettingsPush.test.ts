jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

const mockRpc = jest.fn()
const mockConnection = { connected: true }

jest.mock('@/lib/tunnel/client', () => ({
  tunnelClient: {
    get connected() {
      return mockConnection.connected
    },
    get active() {
      return mockConnection.connected ? { rpc: mockRpc, connected: true } : null
    },
    reportRpcFailure: jest.fn(),
    subscribe: jest.fn(() => () => undefined)
  }
}))

import { resetOutboxForTests } from '@/lib/sync/outbox'
import { Rpc } from '@/lib/tunnel/protocol'
import { useAppStore } from '@/state/appStore'
import {
  refreshConfigSnapshot,
  saveDesktopSetting,
  setConfigValue,
  useDemoConfig,
  type ConfigSnapshot
} from '@/state/demoConfig'

/**
 * The preference toggles' write-through path: a flip leaves the phone as a
 * configSet patch, holds its ground against a snapshot that was already in
 * the air when the user tapped, and reverts to desktop truth when the desktop
 * refuses. The race case is the load-bearing one — without the outbox mark a
 * racing refresh puts the old value back under the user's thumb for the
 * second it takes the desktop's confirmation push to arrive, and the switch
 * visibly snaps back and forth.
 */

/** Smallest snapshot the applier accepts, with knobs where the tests look. */
function snapshotWith(overrides: {
  bypassPermissions?: boolean
  blockCredentials?: boolean
}): ConfigSnapshot {
  return {
    capabilities: [],
    mcpServers: [],
    variables: [],
    services: {
      google: { status: 'active', projectId: 'proj' },
      github: [],
      notion: [],
      braveEnabled: true,
      memesEnabled: true,
      sttModel: 'stt',
      ttsVoice: 'voice',
      ttsSpeed: '1.0',
      screenshotMaxWidth: '1280',
      screenshotFormat: 'jpeg'
    },
    channels: {
      telegram: {
        enabled: false,
        allowedUserIds: '',
        autoRefresh: true,
        staleHours: '12',
        verbose: false,
        hideAutomations: false
      },
      whatsapp: {
        enabled: false,
        allowedNumbers: '',
        autoRefresh: true,
        staleHours: '12',
        verbose: false,
        hideAutomations: false
      }
    },
    llm: {
      brainProvider: 'anthropic',
      brainModel: 'claude-opus-4-8',
      chatMode: 'single',
      localOnly: false,
      restrictPowerfulModels: true,
      local: { enabled: false, model: null },
      providers: []
    },
    preferences: {
      launchAtStartup: false,
      bypassPermissions: overrides.bypassPermissions ?? false,
      blockCredentials: overrides.blockCredentials ?? false,
      weekStartsOn: 1,
      updatesEnabled: true
    }
  }
}

const configSetCalls = (): unknown[][] =>
  mockRpc.mock.calls.filter(([method]) => method === Rpc.configSet)

describe('preference toggles write-through', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetOutboxForTests()
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ ok: true })
    mockConnection.connected = true
    useAppStore.setState({ paired: true })
    useDemoConfig.setState({ bypassPermissions: false, blockCredentials: false })
  })

  afterEach(() => {
    jest.useRealTimers()
    useAppStore.setState({ paired: false })
  })

  it('a flip lands locally and leaves as exactly one configSet patch', async () => {
    setConfigValue('bypassPermissions', true)
    expect(useDemoConfig.getState().bypassPermissions).toBe(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(configSetCalls()).toEqual([[Rpc.configSet, { settings: { bypassPermissions: true } }]])
  })

  it('a snapshot fetched across a flip keeps the flip; the next quiet one applies', async () => {
    // The refresh is already in the air when the user taps the switch.
    let resolveFetch!: (value: unknown) => void
    mockRpc.mockImplementationOnce(() => new Promise((resolve) => (resolveFetch = resolve)))
    const raced = refreshConfigSnapshot()
    setConfigValue('bypassPermissions', true)
    resolveFetch(snapshotWith({ bypassPermissions: false }))
    await raced
    expect(useDemoConfig.getState().bypassPermissions).toBe(true)

    // The push settles; afterwards a quiet fetch is desktop truth and applies.
    await jest.advanceTimersByTimeAsync(0)
    mockRpc.mockResolvedValueOnce(snapshotWith({ bypassPermissions: false }))
    await refreshConfigSnapshot()
    expect(useDemoConfig.getState().bypassPermissions).toBe(false)
  })

  it('a refused write reverts the row to the snapshot the desktop answers with', async () => {
    mockRpc.mockImplementation(async (method: string) => {
      if (method === Rpc.configSet) throw new Error('not editable')
      return snapshotWith({ bypassPermissions: false })
    })
    setConfigValue('bypassPermissions', true)
    expect(useDemoConfig.getState().bypassPermissions).toBe(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(useDemoConfig.getState().bypassPermissions).toBe(false)
    const methods = mockRpc.mock.calls.map(([method]) => method)
    expect(methods).toEqual([Rpc.configSet, Rpc.configSnapshot])
  })

  it('keys the desktop does not accept stay local and off the wire', async () => {
    setConfigValue('telegramEnabled', false)
    await jest.advanceTimersByTimeAsync(0)
    expect(configSetCalls()).toEqual([])
    expect(useDemoConfig.getState().telegramEnabled).toBe(false)
  })

  it('saveDesktopSetting answers true only when the desktop accepted', async () => {
    await expect(saveDesktopSetting('blockCredentials', true)).resolves.toBe(true)
    expect(configSetCalls()).toEqual([[Rpc.configSet, { settings: { blockCredentials: true } }]])

    mockRpc.mockImplementation(async (method: string) => {
      if (method === Rpc.configSet) throw new Error('refused')
      return snapshotWith({ blockCredentials: true })
    })
    await expect(saveDesktopSetting('blockCredentials', false)).resolves.toBe(false)
    // Reverted to the snapshot's value, not left on the refused edit — the
    // optimistic false must not survive a desktop that says true.
    expect(useDemoConfig.getState().blockCredentials).toBe(true)
  })
})
