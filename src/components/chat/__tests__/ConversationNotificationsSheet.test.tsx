jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
jest.mock('expo-blur', () => ({ BlurView: () => null }))

/**
 * The conversation's own notifications sheet — what this run said, read back
 * beside the transcript that produced it.
 *
 * Three rules separate it from the notifications page, and each is one the
 * user can only discover by being surprised:
 *
 *  - ARCHIVED ONES ARE GONE. Archiving is filing, and the page is where a
 *    filed notification is read back. A sheet that kept showing them would
 *    make the archive button look broken.
 *  - READ ONES STAY. Being in a conversation marks its notifications read, so
 *    by the time this sheet can be opened they usually all are — hiding them
 *    would empty the sheet exactly when it is opened.
 *  - NEITHER ACTION ASKS FIRST. They act on one notification and both are
 *    recoverable from the page, unlike the page's own bulk pair.
 */

import { ConversationNotificationsSheet } from '@/components/chat/ConversationNotificationsSheet'
import '@/lib/i18n'
import { ThemeContext } from '@/providers/theme/useTheme'
import { useNotifications, type NotificationRecord } from '@/state/notifications'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

const NOW = Date.now()

function record(id: string, over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id,
    title: `Run ${id}`,
    body: 'Fourteen runs since, no flakes.',
    at: NOW - 3 * 3_600_000,
    conversationId: 'conv-a',
    deeplink: null,
    phase: 'completed',
    read: false,
    archived: false,
    counted: true,
    ...over
  }
}

async function mount(): Promise<void> {
  await render(
    <ThemeContext.Provider
      value={{ theme: 'light', isDark: false, setTheme: async () => undefined }}
    >
      <ConversationNotificationsSheet open onClose={jest.fn()} conversationId="conv-a" />
    </ThemeContext.Provider>
  )
}

beforeEach(() => {
  useNotifications.setState({ items: [] })
})

describe('what the sheet lists', () => {
  it('shows this conversation and not the one next to it', async () => {
    useNotifications.setState({
      items: [
        record('mine'),
        record('theirs', { conversationId: 'conv-b', title: 'Run theirs' }),
        record('general', { conversationId: null, title: 'Run general' })
      ]
    })
    await mount()

    expect(screen.getByText('Run mine')).toBeTruthy()
    expect(screen.queryByText('Run theirs')).toBeNull()
    expect(screen.queryByText('Run general')).toBeNull()
  })

  it('keeps read ones — which is most of them, since being here reads them', async () => {
    useNotifications.setState({ items: [record('n1', { read: true })] })
    await mount()

    expect(screen.getByText('Run n1')).toBeTruthy()
    // Read, so no New mark and nothing left to read — archive still stands.
    expect(screen.queryByText('New')).toBeNull()
    expect(screen.queryByText('Mark as read')).toBeNull()
    expect(screen.getByLabelText('Archive')).toBeTruthy()
  })

  it('leaves archived ones to the notifications page', async () => {
    useNotifications.setState({
      items: [record('filed', { archived: true, read: true }), record('open')]
    })
    await mount()

    expect(screen.getByText('Run open')).toBeTruthy()
    expect(screen.queryByText('Run filed')).toBeNull()
  })

  it('says so when everything has been filed', async () => {
    useNotifications.setState({ items: [record('filed', { archived: true, read: true })] })
    await mount()

    expect(
      screen.getByText('Nothing left here — everything this conversation sent is archived.')
    ).toBeTruthy()
  })
})

describe('its two actions', () => {
  it('marks one read on the spot, with nothing to confirm', async () => {
    useNotifications.setState({ items: [record('n1'), record('n2')] })
    await mount()

    fireEvent.press(screen.getAllByLabelText('Mark as read')[0])

    // Read immediately — no dialog stands between the press and the change.
    await waitFor(() => expect(useNotifications.getState().items[0].read).toBe(true))
    expect(screen.queryByText('Mark all as read?')).toBeNull()
    // …and it stays on the list, because read ones belong here.
    expect(screen.getByText('Run n1')).toBeTruthy()
  })

  it('archives one on the spot, and it leaves the sheet', async () => {
    useNotifications.setState({ items: [record('n1'), record('n2')] })
    await mount()

    fireEvent.press(screen.getAllByLabelText('Archive')[0])

    await waitFor(() => expect(screen.queryByText('Run n1')).toBeNull())
    expect(screen.getByText('Run n2')).toBeTruthy()
    // Archiving reads at the same time — the store's rule, not the sheet's.
    expect(useNotifications.getState().items[0]).toMatchObject({ archived: true, read: true })
  })

  it('acknowledges on a card tap without navigating anywhere', async () => {
    // Every card here belongs to the conversation under this sheet, so the
    // page's navigate-on-tap would push a second copy of the screen behind it.
    useNotifications.setState({ items: [record('n1')] })
    await mount()

    fireEvent.press(screen.getByText('Run n1'))

    await waitFor(() => expect(useNotifications.getState().items[0].read).toBe(true))
    expect(screen.getByText('Run n1')).toBeTruthy()
  })
})
