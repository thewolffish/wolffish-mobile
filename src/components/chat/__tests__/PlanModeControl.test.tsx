jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

/**
 * Plan mode's row has three states, and the demo one is why it is a row that
 * can disappear rather than one that merely greys out:
 *
 * - unpaired (demo): GONE. Nothing there holds the stance and the replies are
 *   recorded, so a switch could only ever lie about what the next turn does —
 *   and the composer hides its chip without a desktop, so a live switch here
 *   would strand the stance ON with nothing on screen saying so;
 * - paired but out of reach: present, DISABLED, with the reason under it —
 *   the stance is a real thing on that desktop, just not changeable now;
 * - paired and reachable: present and live.
 */

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }))

let mockReachable = true
jest.mock('@/lib/tunnel/useTunnelStatus', () => ({ useDesktopReachable: () => mockReachable }))

import { PlanModeControl } from '@/components/chat/ChatControls'
import { useAppStore } from '@/state/appStore'
import { planModeFor, useChatRuntime } from '@/state/chatRuntime'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native'
import '@/lib/i18n'

/** The one line a disabled switch owes the user. */
const OFFLINE_NOTE = 'Connect the desktop to change plan mode.'

afterEach(cleanup)

async function mount(paired: boolean, reachable: boolean): Promise<void> {
  mockReachable = reachable
  useAppStore.setState({ paired })
  useChatRuntime.setState({ planModes: {} })
  await render(<PlanModeControl conversationId="conv-1" />)
}

/** The switch's own state — the Toggle carries the label, the row's Text repeats it. */
const toggleState = (): { checked: boolean; disabled?: boolean } =>
  (
    screen.getByLabelText('Plan') as unknown as {
      props: { accessibilityState: { checked: boolean; disabled?: boolean } }
    }
  ).props.accessibilityState

it('is gone in demo mode — nothing there holds a stance', async () => {
  await mount(false, false)
  expect(screen.queryByLabelText('Plan')).toBeNull()
  expect(screen.queryByText(OFFLINE_NOTE)).toBeNull()
})

it('is live, and says nothing extra, while the desktop is reachable', async () => {
  await mount(true, true)
  expect(toggleState().disabled).toBe(false)
  expect(screen.queryByText(OFFLINE_NOTE)).toBeNull()
})

it('is disabled with its reason while a paired desktop is out of reach', async () => {
  await mount(true, false)
  expect(toggleState().disabled).toBe(true)
  expect(screen.getByText(OFFLINE_NOTE)).toBeTruthy()
})

it('writes the stance when it is the live one', async () => {
  await mount(true, true)
  fireEvent.press(within(screen.getByLabelText('Plan')).getByText('On'))
  await waitFor(() => expect(planModeFor('conv-1')).toBe(true))
  expect(toggleState().checked).toBe(true)
})
