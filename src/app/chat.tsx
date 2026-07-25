import { AssistantMessageView, UserBubble } from '@/components/chat/MessageBubbles'
import { ChatSkeleton } from '@/components/chat/ChatSkeleton'
import { Composer, type ComposerSubmit } from '@/components/chat/Composer'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  PlusSignIcon,
  Settings02Icon
} from '@/components/core/icons'
import { useConversation } from '@/lib/conversations/hooks'
import type { ConversationMessage } from '@/lib/conversations/types'
import { ensureDemoConversation, sendDemoPrompt, stopDemoTurn } from '@/lib/demo/agent'
import { importLocalFile } from '@/lib/files/fileCache'
import { useAppStore } from '@/state/appStore'
import { useChatRuntime } from '@/state/chatRuntime'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * The chat screen — the desktop Chat page adapted to one column: header with
 * back/new/history/verbose controls, bottom-pinned feed, composer with
 * send/stop/record. Works identically for a fresh chat and for any of the
 * imported demo conversations (open from History).
 *
 * The feed is a plain ScrollView, deliberately:
 * - inverted FlatList: Fabric text measurement explodes on RTL-heavy rows
 *   (real Arabic conversations blanked the whole feed);
 * - non-inverted FlatList: scrollToEnd targets the ESTIMATED content end,
 *   which never converges with a few huge rows, so opening at the bottom
 *   is unreliable.
 * Conversations are small (median 2, max 30 messages in three months of
 * real data), so full rendering is cheap and bottom-pinning deterministic.
 */

type FeedItem = { key: string; message: ConversationMessage; streaming: boolean }

export default function ChatScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string }>()
  const listRef = useRef<ScrollView>(null)
  const [conversationId, setConversationId] = useState<string | null>(params.id ?? null)
  const { data: conversation } = useConversation(conversationId)
  const stream = useChatRuntime((state) =>
    conversationId ? state.streams[conversationId] : undefined
  )
  const verbose = useAppStore((state) => state.verboseFeed)

  const streaming = stream !== undefined

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []
    for (const message of conversation?.messages ?? []) {
      items.push({ key: message.id ?? `${message.timestamp}`, message, streaming: false })
    }
    if (stream) {
      items.push({
        key: stream.message.id ?? 'live',
        message: stream.message,
        streaming: stream.status === 'streaming'
      })
    }
    return items
  }, [conversation, stream])

  const handleSubmit = useCallback(
    (payload: ComposerSubmit): void => {
      void (async () => {
        if (payload.kind === 'text') {
          const id = await sendDemoPrompt({ conversationId, text: payload.text })
          setConversationId(id)
          return
        }
        // Voice note: file the recording under the conversation's uploads dir,
        // then send it as an audio attachment with the voice flag — the same
        // shape the desktop persists for voice prompts.
        let id = conversationId
        if (!id) id = await ensureDemoConversation(t('chat.voice.record'))
        const timestamp = Date.now()
        const name = `voice-${timestamp}.m4a`
        const relPath = `uploads/conv-${id}/${name}`
        await importLocalFile(payload.uri, relPath, id)
        await sendDemoPrompt({
          conversationId: id,
          text: '',
          attachments: [
            {
              type: 'audio',
              filePath: relPath,
              originalName: name,
              mimeType: 'audio/mp4',
              sizeBytes: 0,
              durationSeconds: payload.durationSeconds
            }
          ],
          voicePrompt: true
        })
        setConversationId(id)
      })()
    },
    [conversationId, t]
  )

  const handleStop = useCallback((): void => {
    if (conversationId) stopDemoTurn(conversationId)
  }, [conversationId])

  const BackIcon = I18nManager.isRTL ? ArrowRight01Icon : ArrowLeft01Icon
  const title = conversation?.title && conversation.title !== 'Untitled'
    ? conversation.title
    : t('app.name')

  const empty = feed.length === 0
  // Reading the conversation out of SQLite is async, so an opened conversation
  // has no messages for a frame or two. Show placeholders rather than letting
  // it fall through to the new-chat hero and snap to the feed.
  const loading = empty && conversationId !== null && conversation === undefined

  return (
    <View className="bg-bg flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="border-border-soft flex-row items-center gap-1 border-b px-2 pb-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={() => router.back()}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-border/40"
        >
          <BackIcon size={20} className="text-fg" />
        </Pressable>
        <Text numberOfLines={1} className="text-fg font-sans-semibold flex-1 text-left text-base">
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          hitSlop={8}
          onPress={() => router.push('/settings')}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-border/40"
        >
          <Settings02Icon size={18} className="text-fg" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.history')}
          hitSlop={8}
          onPress={() => router.push('/history')}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-border/40"
        >
          <Clock01Icon size={18} className="text-fg" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.newChat')}
          hitSlop={8}
          onPress={() => setConversationId(null)}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-border/40"
        >
          <PlusSignIcon size={18} className="text-fg" />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <ChatSkeleton />
        ) : empty ? (
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Image
              source={require('../../assets/images/icon-trans.png')}
              style={{ width: 80, height: 80 }}
              contentFit="contain"
            />
            <Text className="text-fg font-sans-semibold text-center text-2xl">
              {t('chat.empty.title')}
            </Text>
            <Text className="text-muted text-center font-sans text-sm leading-relaxed">
              {t('chat.empty.subtitle')}
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={listRef}
            onContentSizeChange={() => {
              listRef.current?.scrollToEnd({ animated: false })
            }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 16 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            {feed.map((item) =>
              item.message.role === 'user' ? (
                <UserBubble
                  key={item.key}
                  message={item.message}
                  conversationId={conversationId ?? undefined}
                />
              ) : (
                <AssistantMessageView
                  key={item.key}
                  message={item.message}
                  conversationId={conversationId ?? undefined}
                  verbose={verbose}
                  streaming={item.streaming}
                />
              )
            )}
          </ScrollView>
        )}

        <View style={{ paddingBottom: insets.bottom }}>
          <Composer
            streaming={streaming}
            conversation={conversation}
            onSubmit={handleSubmit}
            onStop={handleStop}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}
