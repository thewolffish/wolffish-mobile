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
import { useChatRuntime } from '@/state/chatRuntime'
import { useConfigValue } from '@/state/demoConfig'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import {
  abortTurn,
  isTurnRunning,
  onStreamingText,
  onTurnState,
  sendPrompt,
  streamingTextFor
} from '@/lib/sync/prompt'
import { uploadFileToDesktop } from '@/lib/sync/files'
import { useAppStore } from '@/state/appStore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const paired = useAppStore((state) => state.paired)
  // Assistant text arriving from the desktop before the message is final, so
  // the feed shows it being written rather than appearing all at once.
  const [remoteStream, setRemoteStream] = useState<string>('')
  // Whether the desktop is running a turn for this conversation right now —
  // what puts the composer in its stop state before the first token arrives.
  const [remoteRunning, setRemoteRunning] = useState(false)
  useEffect(() => {
    if (!paired || !conversationId) return
    setRemoteStream(streamingTextFor(conversationId) ?? '')
    setRemoteRunning(isTurnRunning(conversationId))
    const offText = onStreamingText((id, text) => {
      if (id === conversationId) setRemoteStream(text)
    })
    const offTurn = onTurnState((id, running) => {
      if (id === conversationId) setRemoteRunning(running)
    })
    return () => {
      offText()
      offTurn()
    }
  }, [paired, conversationId])
  const { data: conversation, isFetching: conversationFetching } = useConversation(conversationId)
  const stream = useChatRuntime((state) =>
    conversationId ? state.streams[conversationId] : undefined
  )
  // One flag for both ends: the desktop's `inapp.verbose`. The feed is a
  // display preference of the workspace, not of the device rendering it.
  const verbose = useConfigValue('inappVerbose')

  const streaming = stream !== undefined || (paired && (remoteRunning || remoteStream.length > 0))

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
    // Paired mode has no local turn runner — the desktop is writing, and its
    // text arrives as deltas. Render them as the same kind of live row the
    // demo agent produces so the feed has one streaming shape, not two.
    if (paired && remoteStream) {
      items.push({
        key: 'remote-live',
        message: {
          id: 'remote-live',
          role: 'assistant',
          content: remoteStream,
          timestamp: Date.now()
        } as ConversationMessage,
        streaming: true
      })
    }
    return items
  }, [conversation, stream, paired, remoteStream])

  const handleSubmit = useCallback(
    (payload: ComposerSubmit): void => {
      void (async () => {
        if (payload.kind === 'text') {
          // Paired: the desktop runs the turn and streams it back. Demo: the
          // on-device stand-in answers. Same call site, same result shape.
          const id = paired
            ? (await sendPrompt({ conversationId, text: payload.text })).conversationId
            : await sendDemoPrompt({ conversationId, text: payload.text })
          setConversationId(id)
          return
        }
        // Voice note. Paired, the desktop owns the workspace: upload the
        // bytes first — the desktop names the file and, for a first message,
        // creates the conversation — keep a local copy under that same path
        // so playback never re-downloads, then send the message referencing
        // it. The desktop transcribes and runs the turn from there.
        const timestamp = Date.now()
        const name = `voice-${timestamp}.m4a`
        if (paired) {
          let uploaded: Awaited<ReturnType<typeof uploadFileToDesktop>> = null
          try {
            uploaded = await uploadFileToDesktop(payload.uri, name, 'audio/mp4', conversationId)
          } catch {
            uploaded = null // a broken transfer keeps the recording local, like offline
          }
          if (uploaded) {
            await importLocalFile(
              payload.uri,
              uploaded.attachment.filePath,
              uploaded.conversationId
            )
            const result = await sendPrompt({
              conversationId: uploaded.conversationId,
              text: '',
              attachments: [{ ...uploaded.attachment, durationSeconds: payload.durationSeconds }],
              voicePrompt: true
            })
            setConversationId(result.conversationId)
            return
          }
        }
        // Demo — or a paired phone that cannot reach its desktop right now:
        // file the recording locally under the conversation's uploads dir and
        // send the same attachment shape. Offline the reply says why nothing
        // answers, and the local conversation is pruned when the real list
        // resyncs.
        let id = conversationId
        if (!id) id = await ensureDemoConversation(t('chat.voice.record'))
        const relPath = `uploads/conv-${id}/${name}`
        await importLocalFile(payload.uri, relPath, id)
        const attachments = [
          {
            type: 'audio' as const,
            filePath: relPath,
            originalName: name,
            mimeType: 'audio/mp4',
            sizeBytes: 0,
            durationSeconds: payload.durationSeconds
          }
        ]
        if (paired) {
          const result = await sendPrompt({
            conversationId: id,
            text: '',
            attachments,
            voicePrompt: true
          })
          setConversationId(result.conversationId)
          return
        }
        await sendDemoPrompt({ conversationId: id, text: '', attachments, voicePrompt: true })
        setConversationId(id)
      })()
    },
    [conversationId, paired, t]
  )

  const handleStop = useCallback((): void => {
    if (!conversationId) return
    // Paired, the turn runs on the desktop — stopping is an RPC, not a local
    // timer. Demo turns stay the demo agent's to cancel.
    if (paired) void abortTurn(conversationId)
    else stopDemoTurn(conversationId)
  }, [conversationId, paired])

  const BackIcon = I18nManager.isRTL ? ArrowRight01Icon : ArrowLeft01Icon
  const title =
    conversation?.title && conversation.title !== 'Untitled' ? conversation.title : t('app.name')

  const empty = feed.length === 0
  // Reading the conversation out of SQLite is async, so an opened conversation
  // has no messages for a frame or two. Show placeholders rather than letting
  // it fall through to the new-chat hero and snap to the feed.
  //
  // `isFetching` covers the second case: a paired conversation opened before
  // its body has been downloaded is present but empty, and the download that
  // fills it is a *refetch* — the data is no longer undefined, so the first
  // test alone would show an empty transcript while the messages are on their
  // way. Only when there is nothing to show yet: a conversation that is
  // genuinely empty stays empty while a background refresh runs.
  const loading =
    empty && conversationId !== null && (conversation === undefined || conversationFetching)

  return (
    <View className="bg-bg flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="border-border-soft flex-row items-center gap-1 border-b px-2 pb-2">
        {/* Paired, there is nowhere to go back to: the entry screen is behind
            a replace, and the only thing it offers is a way to drop this very
            connection. Absent rather than disabled — a dead control invites
            the tap that a missing one never gets. */}
        {!paired && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={8}
            onPress={() => router.back()}
            className="h-9 w-9 items-center justify-center rounded-lg active:bg-border/40"
          >
            <BackIcon size={20} className="text-fg" />
          </Pressable>
        )}
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
