import { AssistantMessageView, UserBubble } from '@/components/chat/MessageBubbles'
import { ChatFeed, FEED_FADE_MS, type ChatFeedHandle } from '@/components/chat/ChatFeed'
import { ChatSkeleton } from '@/components/chat/ChatSkeleton'
import { Composer, type ComposerSubmit } from '@/components/chat/Composer'
import type { QueuedPrompt } from '@/components/chat/QueuedPrompts'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  PlusSignIcon,
  Settings02Icon
} from '@/components/core/icons'
import { buildFeed } from '@/lib/conversations/feed'
import { useConversation } from '@/lib/conversations/hooks'
import { mintMessageId, type ConversationMessage } from '@/lib/conversations/types'
import { deriveTitle, ensureDemoConversation, sendDemoPrompt, stopDemoTurn } from '@/lib/demo/agent'
import { importLocalFile } from '@/lib/files/fileCache'
import type { PickedFile } from '@/lib/files/pickAttachments'
import { useChatRuntime } from '@/state/chatRuntime'
import { useConfigValue } from '@/state/demoConfig'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { abortTurn, beginTurn, sendPrompt } from '@/lib/sync/prompt'
import {
  discardStaged,
  fileLocally,
  stageForSend,
  stagedAttachment,
  uploadForSend
} from '@/lib/sync/attachments'
import { uploadFileToDesktop } from '@/lib/sync/files'
import { tunnelClient } from '@/lib/tunnel/client'
import { useToast } from '@/providers/toast/useToast'
import { useAppStore } from '@/state/appStore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import Animated, { FadeOut } from 'react-native-reanimated'
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
 * Everything about WHERE that ScrollView sits lives in ChatFeed.
 *
 * The screen has four display states and exactly one transition between any
 * two of them, because the alternative — letting each state appear as soon as
 * its data happens to arrive — is what made opening a conversation flash the
 * hero, then the top of the transcript, then snap to the end:
 *
 *   new chat        no id, nothing to load          → hero, immediately
 *   opening         id, transcript not laid out yet → skeleton
 *   open            transcript pinned to its end    → feed, faded in
 *   empty           id, but genuinely no messages   → hero
 *
 * The skeleton covers the whole "opening" window — reading SQLite, downloading
 * the body over the tunnel, laying the messages out, pinning to the end — so
 * the transcript is never seen anywhere but at its final position.
 *
 * SENDING adds a fifth state that none of those four can express, and getting
 * it wrong is what made a prompt sent from here disappear into nothing: a new
 * chat has no conversation to load, so it is neither "opening" (no skeleton)
 * nor "empty" (the hero is gone the moment the user sends) for the whole round
 * trip in which the desktop mints one. The prompt is therefore rendered from
 * local state for exactly that window — `pendingUser` — and handed to the live
 * turn the moment there is an id to file it under. Neither the hero nor a bare
 * feed is ever shown while a turn is in flight.
 *
 * SENDING MID-TURN is the desktop's queue, ported whole: a submit that arrives
 * while a turn is running is not refused and does not enter the feed — it waits
 * in a cancelable row above the composer and is sent, through this very same
 * path, when the turn ends. See `queued` below.
 */

/** Identity for a queued row. Local and disposable — the queue never leaves
 *  this screen, so these ids never have to agree with anything. */
let queueSequence = 0

export default function ChatScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string }>()
  const feedRef = useRef<ChatFeedHandle>(null)
  const [conversationId, setConversationId] = useState<string | null>(params.id ?? null)
  // The conversation this screen was OPENED on — History, a deep link, a
  // notification. Distinct from `conversationId`, which also moves when a new
  // chat gets its id on first send: that transition must not re-gate a feed
  // the user is already looking at.
  const openedId = params.id ?? null
  const [feedRevealed, setFeedRevealed] = useState(openedId === null)
  useEffect(() => {
    setFeedRevealed(openedId === null)
    // Messages queued for the conversation being left do not follow the user
    // into the next one — they were written as replies to a turn that is no
    // longer on screen. The desktop wipes its queue on the same transition.
    setQueued([])
  }, [openedId])
  const paired = useAppStore((state) => state.paired)
  const { data: conversation, isFetching: conversationFetching } = useConversation(conversationId)
  // The turn being written into this conversation right now, from whichever
  // side started it — this phone, the desktop, a channel. One store for demo
  // and paired alike, so the feed has one streaming shape rather than two.
  const live = useChatRuntime((state) =>
    conversationId ? state.streams[conversationId] : undefined
  )
  // A prompt sent from a chat with no id yet, held for the round trip that
  // mints one. Cleared as it is handed to the live turn below.
  const [pendingUser, setPendingUser] = useState<ConversationMessage | null>(null)
  const [sending, setSending] = useState(false)
  // Submits held back because a turn was running when they arrived. In memory
  // only, and never written anywhere: a queued row is a message that has not
  // been sent, and the app has exactly one place for messages that have.
  const [queued, setQueued] = useState<QueuedPrompt[]>([])
  // One flag for both ends: the desktop's `inapp.verbose`. The feed is a
  // display preference of the workspace, not of the device rendering it.
  const verbose = useConfigValue('inappVerbose')

  const streaming = live?.status === 'streaming' || sending

  const feed = useMemo(
    () => buildFeed({ messages: conversation?.messages, live, pendingUser, sending }),
    [conversation, live, pendingUser, sending]
  )

  /**
   * A send that will not happen, taken back down. The live turn opened at the
   * tap has to come with it, or the thinking words run against a desktop that
   * was never asked — the same take-back sendPrompt does when its own RPC
   * throws.
   */
  const abandon = useCallback(
    (settle: (id?: string) => void): void => {
      if (conversationId) useChatRuntime.getState().endStream(conversationId)
      settle()
    },
    [conversationId]
  )

  /**
   * A message carrying files.
   *
   * The desktop copies an attachment into the workspace at the PICK and sends
   * the path; a phone cannot, because the workspace is on the other side of a
   * relay. So the bytes travel here, at the send, and the ordering is what
   * keeps the two surfaces identical:
   *
   *   stage  — the picked files move into the local workspace, and the bubble
   *            is re-published with them, so the message on screen carries its
   *            pictures while the upload is still running
   *   upload — one file at a time; the desktop names each one and, for a first
   *            message, mints the conversation it lands in
   *   send   — the prompt goes with the desktop's own attachment metadata, so
   *            the stored message is byte-for-byte what a desktop send makes
   *
   * A file that fails says so and costs only itself; the prompt and the rest
   * of the files still go, exactly as a bad file costs only itself when it is
   * dropped on the desktop composer.
   */
  const sendWithFiles = useCallback(
    async (text: string, files: PickedFile[], settle: (id?: string) => void): Promise<void> => {
      const staged = await stageForSend(files)
      const optimistic = staged.map(stagedAttachment)
      if (optimistic.length > 0) {
        const user: ConversationMessage = {
          id: mintMessageId(),
          role: 'user',
          content: text,
          timestamp: Date.now(),
          attachments: optimistic
        }
        // A conversation that exists gets the row through the live turn, not
        // through the screen's own copy: buildFeed prefers `live.user`, and a
        // stream left over from a turn whose stored copy never arrived would
        // otherwise keep showing the PREVIOUS prompt for the whole upload.
        // A chat with no id yet has no stream to file it under.
        if (conversationId) beginTurn(conversationId, user)
        else setPendingUser(user)
      }
      // Every file failed to even reach the workspace, and there is no prompt
      // to send without them: there is no message here.
      if (staged.length === 0 && !text) {
        toast.show({ tone: 'error', message: t('chat.attach.error') })
        abandon(settle)
        return
      }

      try {
        if (paired && tunnelClient.connected) {
          const result = await uploadForSend(staged, conversationId)
          if (result.failed.length > 0) {
            toast.show({
              tone: 'error',
              message: t('chat.attach.failed', { names: result.failed.join(', ') })
            })
          }
          // Nothing landed and nothing was typed — sending would be an empty
          // prompt, which the desktop refuses anyway.
          if (result.attachments.length === 0 && !text) {
            abandon(settle)
            return
          }
          const sent = await sendPrompt({
            conversationId: result.conversationId ?? conversationId,
            text,
            attachments: result.attachments
          })
          settle(sent.conversationId)
          return
        }

        // Demo, or a paired phone that cannot reach its desktop right now: the
        // files are filed under the conversation's own uploads folder, in the
        // shape the desktop would have produced, so the feed has one kind of
        // attachment rather than two. Offline, sendPrompt writes the reply
        // that says why nothing answered and the desktop's copy replaces the
        // whole conversation once the link is back.
        let id = conversationId
        if (!id) id = await ensureDemoConversation(deriveTitle(text, optimistic))
        const attachments = await fileLocally(staged, id)
        if (paired) {
          const sent = await sendPrompt({ conversationId: id, text, attachments })
          settle(sent.conversationId)
          return
        }
        await sendDemoPrompt({ conversationId: id, text, attachments })
        settle(id)
      } catch {
        discardStaged(staged)
        abandon(settle)
      }
    },
    [conversationId, paired, toast, t, abandon]
  )

  /**
   * Send one submit, now. The queue calls this too — a queued row is sent by
   * exactly the path it would have taken had it been written a moment later,
   * which is the whole reason the queue holds the composer's payload verbatim
   * rather than anything half-sent.
   */
  const performSubmit = useCallback(
    (payload: ComposerSubmit): void => {
      // The one case CSS can't cover on the desktop either: sending while
      // scrolled up. Re-pin at the send, before the message exists, so the
      // user always sees their own prompt and the reply that follows it.
      feedRef.current?.scrollToEnd()
      const attaching = payload.kind === 'text' && payload.files.length > 0
      // Everything visible about the send happens in THIS tick — before any
      // await — so the prompt and the thinking words are on screen from the tap
      // rather than from the reply. For a conversation that already exists,
      // sendPrompt opens the live turn itself; a new chat has nowhere to file
      // one yet, so the screen holds the prompt for that one round trip.
      //
      // Files make that round trip long — a video is a minute of chunks — and
      // they make it long for an EXISTING conversation too, since nothing is
      // sent until the last byte lands. So a message with attachments is always
      // held here, and re-published a moment later with its files (below) once
      // they have a path to render from.
      if (payload.kind === 'text' && (conversationId === null || attaching)) {
        setPendingUser({
          id: mintMessageId(),
          role: 'user',
          content: payload.text,
          timestamp: Date.now()
        })
      }
      setSending(true)
      // Handing over is one state change, not three: by the time this runs the
      // live turn carries the prompt under the conversation's own id, so the
      // row the screen was holding is released in the same frame its
      // replacement appears.
      const settle = (id?: string): void => {
        setPendingUser(null)
        setSending(false)
        if (id) setConversationId(id)
      }
      void (async () => {
        if (payload.kind === 'text' && !attaching) {
          try {
            // Paired: the desktop runs the turn and streams it back. Demo: the
            // on-device stand-in answers. Same call site, same result shape.
            const id = paired
              ? (await sendPrompt({ conversationId, text: payload.text })).conversationId
              : await sendDemoPrompt({ conversationId, text: payload.text })
            settle(id)
          } catch {
            settle()
          }
          return
        }

        if (payload.kind === 'text') {
          await sendWithFiles(payload.text, payload.files, settle)
          return
        }
        // Voice note. Paired, the desktop owns the workspace: upload the
        // bytes first — the desktop names the file and, for a first message,
        // creates the conversation — keep a local copy under that same path
        // so playback never re-downloads, then send the message referencing
        // it. The desktop transcribes and runs the turn from there.
        const timestamp = Date.now()
        const name = `voice-${timestamp}.m4a`
        try {
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
              settle(result.conversationId)
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
            settle(result.conversationId)
            return
          }
          await sendDemoPrompt({ conversationId: id, text: '', attachments, voicePrompt: true })
          settle(id)
        } catch {
          settle()
        }
      })()
    },
    [conversationId, paired, t, sendWithFiles]
  )

  /**
   * What the composer hands over. Idle it goes; mid-turn it waits.
   *
   * "Mid-turn" is `streaming`, which is both a turn running in this
   * conversation — this phone's, the desktop's, a channel's — and a send of
   * this screen's own that has not come back yet. That second half matters:
   * without it a fast second tap would race the first send's round trip, and
   * the two prompts would reach the desktop in whichever order the network
   * settled on.
   */
  const handleSubmit = useCallback(
    (payload: ComposerSubmit): void => {
      if (streaming) {
        queueSequence += 1
        setQueued((prev) => [...prev, { ...payload, id: `q_${queueSequence}` }])
        return
      }
      performSubmit(payload)
    },
    [streaming, performSubmit]
  )

  const cancelQueued = useCallback((id: string): void => {
    setQueued((prev) => prev.filter((item) => item.id !== id))
  }, [])

  /**
   * The flush: while nothing is running and something is waiting, the head of
   * the queue goes. One per idle moment, not the whole queue — each send makes
   * the screen busy again, and the next row leaves when THAT turn ends, so the
   * conversation stays one ordered transcript.
   *
   * Stated as an invariant ("idle and non-empty ⇒ send") rather than as a
   * reaction to the turn ending, because the edge is missable: a prompt
   * submitted in the same frame the turn finishes would be queued just after
   * the transition it was waiting for, and would then sit there until some
   * later turn happened to end. Every path out of a turn — finished, stopped,
   * failed, offline — lands here the same way.
   */
  useEffect(() => {
    if (streaming || queued.length === 0) return
    const [next, ...rest] = queued
    setQueued(rest)
    // Synchronous: performSubmit marks the screen sending in this same commit,
    // so this effect cannot run again on the render it causes.
    performSubmit(next)
  }, [streaming, queued, performSubmit])

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

  // Emptiness is a property of the FEED, not of the stored transcript: a turn
  // in flight is on screen whether or not anything has been saved for it yet,
  // and that is what keeps a fresh send out of both the hero and the skeleton.
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

  // The skeleton stands in for the whole opening sequence, not just the read:
  // it stays up while the body arrives AND while the laid-out feed is pinning
  // itself to the end behind it (ChatFeed.onReady). A conversation that turns
  // out to have no messages resolves to the hero instead — `loading` is false
  // and there is nothing to lay out.
  const showSkeleton = !feedRevealed && (loading || !empty)

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
          onPress={() => {
            // A turn still running in the conversation being left keeps its own
            // live entry, keyed by its id — leaving is not stopping. What must
            // not follow the user to the empty chat is this screen's copy of the
            // last prompt, or messages queued behind a turn they are walking
            // away from.
            setPendingUser(null)
            setSending(false)
            setQueued([])
            setConversationId(null)
          }}
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
        <View className="flex-1">
          {empty && !loading ? (
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
            <ChatFeed
              // A different conversation is a different scroll position and a
              // different gate; keying on the opened id restarts both.
              key={openedId ?? 'new'}
              ref={feedRef}
              gated={openedId !== null}
              onReady={() => setFeedRevealed(true)}
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
            </ChatFeed>
          )}
          {showSkeleton && (
            // Fades out as the feed fades in — one cross-dissolve, so the
            // placeholders resolve into the messages they stood in for
            // instead of being replaced by them.
            <Animated.View exiting={FadeOut.duration(FEED_FADE_MS)} style={StyleSheet.absoluteFill}>
              <ChatSkeleton />
            </Animated.View>
          )}
        </View>

        <View style={{ paddingBottom: insets.bottom }}>
          <Composer
            streaming={streaming}
            conversation={conversation}
            queued={queued}
            onSubmit={handleSubmit}
            onCancelQueued={cancelQueued}
            onStop={handleStop}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}
