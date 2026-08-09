/**
 * The turn score bar on the chat screen — WHEN it is offered.
 *
 * The desktop's rule, ported: a completed turn in an idle chat is rateable
 * 0-10, the bar appears the moment that turn ends rather than when its saved
 * copy arrives, and it retires the moment that turn has a score — from any
 * surface, since the score is a fact about the turn and not about the device
 * that cast it. Every half is load-bearing and every one fails invisibly: a
 * bar that only shows up after the body refetch looks like a slow render, a
 * bar that shows up mid-turn invites a vote on an answer still being written,
 * and a bar that outlives the vote it asked for is the one users read as
 * nagging.
 */

import { cleanup, act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeContext } from '@/providers/theme/useTheme'

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }))
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  // The focus-scoped badge clearing belongs to react-navigation; a no-op
  // keeps this suite free of notification side effects.
  useFocusEffect: () => undefined,
  useLocalSearchParams: () => ({ id: 'conv-1' })
}))
jest.mock('expo-image', () => {
  const { View } = require('react-native')
  return { Image: View }
})
jest.mock('react-native-webview', () => {
  const { View } = jest.requireActual('react-native')
  return { WebView: (props: object) => <View {...props} /> }
})
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn() }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }),
  setAudioModeAsync: jest.fn()
}))
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false, status: 'readyToPlay' }),
  VideoView: () => null
}))
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native')
  const fade = { duration: () => fade }
  return { __esModule: true, default: { View }, FadeOut: fade }
})

jest.mock('@/components/chat/Composer', () => {
  const { View } = require('react-native')
  return { Composer: () => <View testID="composer" /> }
})

/** Reveals itself on mount, as the real feed does once it is pinned. */
jest.mock('@/components/chat/ChatFeed', () => {
  const { View } = require('react-native')
  const { useEffect } = require('react')
  return {
    FEED_FADE_MS: 0,
    ChatFeed: ({ children, onReady }: { children: React.ReactNode; onReady?: () => void }) => {
      useEffect(() => onReady?.(), [onReady])
      return <View>{children}</View>
    }
  }
})

const mockConversation: { data: unknown; isFetching: boolean } = {
  data: undefined,
  isFetching: false
}
jest.mock('@/lib/conversations/hooks', () => ({
  useConversation: () => mockConversation
}))

jest.mock('@/lib/sync/prompt', () => ({
  sendPrompt: jest.fn(async () => ({ conversationId: 'conv-1' })),
  beginTurn: jest.fn(),
  abortTurn: jest.fn()
}))

const mockRateTurn = jest.fn(async () => true)
jest.mock('@/lib/sync/rating', () => ({
  rateTurn: (...args: unknown[]) => mockRateTurn(...(args as []))
}))

// Connected, so the bar is offered: a paired phone with no link refuses every
// write, and this one is hidden rather than left to swallow taps.
jest.mock('@/lib/tunnel/client', () => ({
  tunnelClient: {
    connected: true,
    subscribe: (listener: (state: { status: string }) => void) => {
      listener({ status: 'connected' })
      return () => undefined
    },
    get active() {
      return { connected: true, rpc: jest.fn() }
    }
  }
}))

import '@/lib/i18n'
import ChatScreen from '@/app/chat'
import type { ConversationFile, ConversationRating } from '@/lib/conversations/types'
import { queryClient } from '@/lib/query/queryClient'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/providers/toast/ToastProvider'
import { useAppStore } from '@/state/appStore'
import { useChatRuntime } from '@/state/chatRuntime'
import { useDemoConfig } from '@/state/demoConfig'

const CONVERSATION = 'conv-1'
const ANSWER = 'm_answer'

function stored(ratings?: ConversationRating[]): ConversationFile {
  return {
    id: CONVERSATION,
    title: 'Rated',
    model: null,
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: 'm_prompt', role: 'user', content: 'hello', timestamp: 1 },
      { id: ANSWER, role: 'assistant', content: 'there', timestamp: 2 }
    ],
    ...(ratings ? { ratings } : {})
  }
}

async function mount(): Promise<void> {
  await render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 }
        }}
      >
        <ThemeContext.Provider
          value={{ theme: 'light', isDark: false, setTheme: async () => undefined }}
        >
          <ToastProvider>
            <ChatScreen />
          </ToastProvider>
        </ThemeContext.Provider>
      </SafeAreaProvider>
    </QueryClientProvider>
  )
}

const bar = (): unknown => screen.queryByLabelText('Rate this turn')

afterEach(() => {
  // Two open handles, or the jest worker never exits after the last assertion:
  // the mounted tree (any interval it holds is cleared on unmount) and the query
  // cache (a query that loses its last observer arms a 7-day gc timer).
  cleanup()
  queryClient.clear()
})

beforeEach(() => {
  useAppStore.setState({ paired: true })
  useChatRuntime.setState({ streams: {}, cards: {} })
  useDemoConfig.setState({ reflectionScoringInapp: true })
  mockConversation.data = stored()
  mockConversation.isFetching = false
  mockRateTurn.mockClear()
})

describe('the rating bar', () => {
  it('offers the last completed turn, and files the vote under its message id', async () => {
    await mount()
    expect(bar()).toBeTruthy()
    await fireEvent.press(screen.getByLabelText('Rate 8 out of 10'))
    expect(mockRateTurn).toHaveBeenCalledWith(CONVERSATION, ANSWER, 8)
  })

  it('retires once the turn has a score, from whichever surface cast it', async () => {
    // A vote from a bare-number Telegram reply, arriving here on the
    // turn.scored push. The bar is answered — for THIS turn there is nothing
    // left to ask, whoever did the asking.
    mockConversation.data = stored([{ messageId: ANSWER, score: 3, at: 10, source: 'telegram' }])
    await mount()
    expect(bar()).toBeNull()
  })

  it('retires a turn scored from this phone, not just one scored elsewhere', async () => {
    mockConversation.data = stored([{ messageId: ANSWER, score: 8, at: 10, source: 'mobile' }])
    await mount()
    expect(bar()).toBeNull()
  })

  it('stays away while the turn is being written', async () => {
    await act(async () => {
      useChatRuntime.getState().putStream(CONVERSATION, {
        message: { role: 'assistant', content: 'writ', timestamp: 3 },
        status: 'streaming'
      })
    })
    await mount()
    expect(bar()).toBeNull()
  })

  it('appears at the END of the turn, before the saved copy has arrived', async () => {
    // Nothing stored yet — this is the window between the desktop marking the
    // turn done and the phone's refetch replacing the live row with its
    // persisted twin. The desktop's bar is up in exactly this window too.
    // `ended: 'desktop'` is what a terminal turn.status stamps, and it is the
    // difference between this and the assumed-complete case below.
    mockConversation.data = { ...stored(), messages: [] }
    await act(async () => {
      useChatRuntime.getState().putStream(CONVERSATION, {
        message: { id: ANSWER, role: 'assistant', content: 'done', timestamp: 3 },
        status: 'complete',
        ended: 'desktop'
      })
    })
    await mount()
    expect(bar()).toBeTruthy()
    await fireEvent.press(screen.getByLabelText('Rate 10 out of 10'))
    expect(mockRateTurn).toHaveBeenCalledWith(CONVERSATION, ANSWER, 10)
  })

  it('stays away from a turn only ASSUMED complete by a reconnect', async () => {
    // The reported bug. A phone that reconnects mid-turn — backgrounded and
    // brought back, the common case — force-settles every stream it may have
    // missed the end of (attachTurnStream). The turn is very much still being
    // written on the desktop; nothing said otherwise. Reading "not streaming"
    // as "finished" put a rating bar over it until the next frame arrived and
    // took it away again.
    mockConversation.data = { ...stored(), messages: [] }
    await act(async () => {
      useChatRuntime.getState().putStream(CONVERSATION, {
        message: { id: ANSWER, role: 'assistant', content: 'half a rep', timestamp: 3 },
        status: 'complete',
        ended: 'assumed'
      })
    })
    await mount()
    expect(bar()).toBeNull()
  })

  it('stays away while a turn runs over a conversation whose last word is stored', async () => {
    // The other half: the tunnel comes up while the desktop is mid-run, so the
    // live row carries nothing yet but the stored transcript still ends on the
    // PREVIOUS turn's answer — an already-rateable-looking message under a
    // conversation that is busy. seedActiveRuns opens the overlay that makes
    // this readable; the bar has to respect it.
    await act(async () => {
      useChatRuntime.getState().putStream(CONVERSATION, {
        message: { role: 'assistant', content: '', timestamp: 4 },
        status: 'streaming'
      })
    })
    await mount()
    expect(bar()).toBeNull()
  })

  it('is absent when turn scoring is switched off in Knowledge', async () => {
    useDemoConfig.setState({ reflectionScoringInapp: false })
    await mount()
    expect(bar()).toBeNull()
  })

  it('is absent on a chat whose last word is the user’s', async () => {
    mockConversation.data = {
      ...stored(),
      messages: [{ id: 'm_prompt', role: 'user', content: 'hello', timestamp: 1 }]
    }
    await mount()
    expect(bar()).toBeNull()
  })
})
