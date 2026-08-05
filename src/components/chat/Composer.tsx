import {
  ArrowExpandIcon,
  ArrowUp02Icon,
  Delete02Icon,
  Menu01Icon,
  Mic01Icon,
  PlusSignIcon,
  StopCircleIcon,
  Tick02Icon
} from '@/components/core/icons'
import { INPUT_TEXT_ALIGN, WRITING_DIRECTION, rtlPlaceholder } from '@/components/core/Input'
import type { ConversationFile } from '@/lib/conversations/types'
import { pickDocuments, pickMedia, type PickedFile } from '@/lib/files/pickAttachments'
import { MAX_FILES_PER_MESSAGE, uploadErrorMessage, validateUpload } from '@/lib/files/uploadPolicy'
import { useTokens } from '@/providers/theme/useTheme'
import { useToast } from '@/providers/toast/useToast'
import { cn } from '@/lib/utils/cn'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState
} from 'expo-audio'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, TextInput, View } from 'react-native'
import { AttachSheet, AttachmentTray } from '@/components/chat/AttachmentPicker'
import { ChatMenuSheet } from '@/components/chat/ChatMenuSheet'
import { PromptEditorModal } from '@/components/chat/PromptEditorModal'
import { QueuedPromptTray, type QueuedPrompt } from '@/components/chat/QueuedPrompts'
import { RainbowBorder } from '@/components/chat/RainbowBorder'

/**
 * The chat composer — desktop grammar mapped to touch: fixed-height surface
 * field flanked by 42.5pt icon buttons, primary arrow-up send, a red stop while
 * streaming, attach and mic on the end cluster, and the rainbow strip on top
 * while a turn runs. Voice flow: idle → recording (pulsing red dot + counter) →
 * send/delete straight from the recording bar.
 *
 * The field does NOT grow with the draft, which is where this parts from the
 * desktop textarea: on a phone a composer that climbs the screen takes the
 * conversation with it, moves the send button under the thumb that is already
 * reaching for it, and fights the keyboard for the same pixels. It scrolls
 * inside its one row instead, and a draft worth seeing whole opens in the
 * full-screen editor behind the expand button.
 *
 * Attachments follow the desktop exactly: picking stages, it does not upload,
 * and a staged file can be removed right up to the send. What leaves here is a
 * list of local files; who moves the bytes, and when, is the screen's business
 * (see chat.tsx and lib/sync/attachments.ts).
 *
 * MID-TURN nothing here is refused: a prompt, a file or a voice take submitted
 * while the agent is working is handed over exactly as it is when idle, and the
 * screen queues it (see chat.tsx). All that changes is what the composer SAYS —
 * the placeholder and the button labels name the queue — plus the red stop
 * sitting beside the primary button rather than replacing it, because a turn
 * you cannot stop while you are typing the next message would be a trap.
 */

/** The single-line height of the field, and of every button beside it. */
const ROW_HEIGHT = 42.5

export type ComposerSubmit =
  | { kind: 'text'; text: string; files: PickedFile[] }
  | { kind: 'voice'; uri: string; durationSeconds: number }

export type ComposerProps = {
  streaming: boolean
  conversation: ConversationFile | null | undefined
  /** Messages already handed over that are waiting for the turn to end. */
  queued: QueuedPrompt[]
  onSubmit: (payload: ComposerSubmit) => void
  onCancelQueued: (id: string) => void
  onStop: () => void
}

export function Composer({
  streaming,
  conversation,
  queued,
  onSubmit,
  onCancelQueued,
  onStop
}: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const tokens = useTokens()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [files, setFiles] = useState<PickedFile[]>([])
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 500)
  const [recording, setRecording] = useState(false)

  // A file on its own is a message, exactly as it is on the desktop — the
  // prompt is optional once something is attached.
  const canSend = draft.trim().length > 0 || files.length > 0

  // Not gated on `streaming`: mid-turn the submit is a queue, and the composer
  // clears either way — what was written now belongs to the send in flight or
  // to a queued row, not to the field.
  const submitText = (): void => {
    const text = draft.trim()
    if (!text && files.length === 0) return
    setDraft('')
    setFiles([])
    onSubmit({ kind: 'text', text, files })
  }

  /**
   * Take what the picker returned, one file at a time, against the limits the
   * desktop enforces. Validating per file (rather than rejecting the batch) is
   * the desktop's behavior too: a good file in a bad batch still attaches, and
   * every refusal says which rule it broke.
   */
  const stage = (picked: PickedFile[]): void => {
    if (picked.length === 0) return
    // Decided against `files` read here rather than inside a setState updater:
    // an updater must be pure (this app builds with the React Compiler, which
    // is free to re-run one), and raising a toast from inside it is a side
    // effect on another component mid-update. Two picks cannot overlap — the
    // picker is modal — so reading current state directly is sound.
    const next = [...files]
    let totalBytes = next.reduce((sum, file) => sum + file.sizeBytes, 0)
    const rejected: string[] = []
    for (const file of picked) {
      const error = validateUpload(file.name, file.sizeBytes, next.length, totalBytes)
      if (error) {
        rejected.push(uploadErrorMessage(error, t))
        continue
      }
      next.push(file)
      totalBytes += file.sizeBytes
    }
    setFiles(next)
    // One toast per distinct reason: ten files over the same cap is one
    // problem, not ten notifications stacked over the composer.
    for (const message of [...new Set(rejected)]) toast.show({ tone: 'error', message })
  }

  const attach = (source: 'media' | 'files'): void => {
    void (async () => {
      try {
        const remaining = MAX_FILES_PER_MESSAGE - files.length
        if (remaining <= 0) {
          toast.show({
            tone: 'error',
            message: uploadErrorMessage(
              { code: 'max_files_reached', max: MAX_FILES_PER_MESSAGE },
              t
            )
          })
          return
        }
        stage(source === 'media' ? await pickMedia(remaining) : await pickDocuments())
      } catch {
        // A picker that refuses to open — no library access on Android, a
        // provider that crashed. Nothing was staged; say so and move on.
        toast.show({ tone: 'error', message: t('chat.attach.error') })
      }
    })()
  }

  const startRecording = async (): Promise<void> => {
    const permission = await AudioModule.requestRecordingPermissionsAsync()
    if (!permission.granted) {
      toast.show({ tone: 'warning', message: t('chat.voice.permissionDenied') })
      return
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      // prepareToRecordAsync never settles when the platform's audio input
      // can't start (e.g. the Simulator without host mic access) — time out
      // into a visible error rather than hanging the button silently.
      await Promise.race([
        recorder.prepareToRecordAsync(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('audio input unavailable')), 4000)
        )
      ])
      recorder.record()
      setRecording(true)
    } catch {
      toast.show({ tone: 'error', message: t('chat.voice.error') })
    }
  }

  const stopRecording = async (send: boolean): Promise<void> => {
    try {
      await recorder.stop()
      // Recording keeps the session in record mode — restore playback.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
      setRecording(false)
      const uri = recorder.uri
      if (send && uri) {
        onSubmit({
          kind: 'voice',
          uri,
          durationSeconds: recorderState.durationMillis / 1000
        })
      }
    } catch {
      setRecording(false)
      toast.show({ tone: 'error', message: t('chat.voice.error') })
    }
  }

  const remove = (id: string): void => {
    setFiles((current) => current.filter((file) => file.id !== id))
  }

  const mmss = (millis: number): string => {
    const s = Math.max(0, Math.floor(millis / 1000))
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  return (
    <View className="bg-bg border-border-soft border-t">
      {streaming && <RainbowBorder />}
      {/* Queued messages sit above everything else in the composer, as they do
          on the desktop — above the staged files, never in the feed. */}
      <QueuedPromptTray prompts={queued} onCancel={onCancelQueued} />
      {/* Staged files sit above the input, as they do above the desktop
          textarea — visible, removable, and not yet anywhere but this phone. */}
      {!recording && <AttachmentTray files={files} onRemove={remove} />}
      <View className="flex-row items-end gap-2 px-3 py-2.5">
        {!recording && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.menu.title')}
            onPress={() => setMenuOpen(true)}
            className="border-border bg-surface h-[42.5px] w-[42.5px] items-center justify-center rounded-lg border active:bg-border/40"
          >
            <Menu01Icon size={18} className="text-fg" />
          </Pressable>
        )}
        {recording ? (
          <View
            key="recording-bar"
            className="bg-surface border-border h-[42.5px] flex-1 flex-row items-center gap-3 rounded-lg border px-3"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.voice.delete')}
              hitSlop={8}
              onPress={() => void stopRecording(false)}
            >
              <Delete02Icon size={18} className="text-rose-500" />
            </Pressable>
            <View className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
            <Text className="text-fg font-sans-medium flex-1 text-left text-sm">
              {t('chat.voice.recording')}
            </Text>
            <Text className="text-muted font-sans text-sm" style={{ writingDirection: 'ltr' }}>
              {mmss(recorderState.durationMillis)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.voice.send')}
              hitSlop={8}
              onPress={() => void stopRecording(true)}
              className="bg-primary h-8 w-8 items-center justify-center rounded-lg active:opacity-90"
            >
              <Tick02Icon size={16} color={tokens.primaryFg} />
            </Pressable>
          </View>
        ) : (
          <View key="compose-field" className="relative flex-1">
            {/* One row, always. `height` (not minHeight/maxHeight) is the whole
                point: the field never resizes, so nothing above it moves while
                typing — the text scrolls within these 42.5pt instead, and the
                caret is kept in view by the platform. */}
            <TextInput
              multiline
              scrollEnabled
              value={draft}
              onChangeText={setDraft}
              placeholder={rtlPlaceholder(
                streaming ? t('chat.queue.placeholder') : t('chat.placeholder')
              )}
              placeholderTextColor={tokens.muted}
              selectionColor={tokens.accent}
              style={[{ height: ROW_HEIGHT }, WRITING_DIRECTION]}
              className={cn(
                'bg-surface border-border rounded-lg border px-3 py-2.5 pe-8 font-sans text-sm leading-5',
                'text-fg',
                INPUT_TEXT_ALIGN
              )}
              accessibilityLabel={streaming ? t('chat.queue.placeholder') : t('chat.placeholder')}
            />
            {/* Expand — opens the full-screen draft editor, like the desktop
                textarea's expand button; vertically centered in the field. */}
            <View
              pointerEvents="box-none"
              className="absolute bottom-0 end-1.5 top-0 justify-center"
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chat.editor.title')}
                hitSlop={6}
                onPress={() => setEditorOpen(true)}
                className="h-6 w-6 items-center justify-center rounded-md active:bg-border/40"
              >
                <ArrowExpandIcon size={12} className="text-muted" />
              </Pressable>
            </View>
          </View>
        )}

        {/* Attach lives in the END cluster, where the desktop puts it — a
            message action, next to the mic, not a session control. It stays
            put when the mic becomes send, so a file can be added to a prompt
            that has already been typed. */}
        {!recording && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.attach.title')}
            onPress={() => setAttachOpen(true)}
            className="border-border bg-surface h-[42.5px] w-[42.5px] items-center justify-center rounded-lg border active:bg-border/40"
          >
            <PlusSignIcon size={18} className="text-fg" />
          </Pressable>
        )}

        {/* Distinct keys so React unmounts one and mounts the other on the
            mic↔send swap, instead of reusing one instance and mutating its
            variable-bearing className (which trips css-interop's remount
            warning in dev).

            The mic stays live mid-turn, as it does on the desktop: a take
            recorded while the agent is working joins the queue rather than
            being refused. */}
        {!recording && !canSend && (
          <Pressable
            key="composer-mic"
            accessibilityRole="button"
            accessibilityLabel={streaming ? t('chat.voice.queue') : t('chat.voice.record')}
            onPress={() => void startRecording()}
            className="border-border bg-surface h-[42.5px] w-[42.5px] items-center justify-center rounded-lg border active:bg-border/40"
          >
            <Mic01Icon size={18} className="text-fg" />
          </Pressable>
        )}

        {/* The primary button keeps its place and its meaning mid-turn — it
            queues instead of sending. Stop is the separate red one beside it,
            never the same control wearing two hats. */}
        {!recording && canSend && (
          <Pressable
            key="composer-send"
            accessibilityRole="button"
            accessibilityLabel={streaming ? t('chat.queue.add') : t('chat.send')}
            onPress={submitText}
            className="bg-primary h-[42.5px] w-[42.5px] items-center justify-center rounded-lg active:opacity-90"
          >
            <ArrowUp02Icon size={18} color={tokens.primaryFg} />
          </Pressable>
        )}

        {/* Stop survives the recording bar, which hides every other control: a
            turn you cannot stop because you happen to be holding a recording
            would be a trap — the desktop makes the same exception. */}
        {streaming && (
          <Pressable
            key="composer-stop"
            accessibilityRole="button"
            accessibilityLabel={t('chat.stop')}
            onPress={onStop}
            className="h-[42.5px] w-[42.5px] items-center justify-center rounded-lg bg-red-600 active:bg-red-700"
          >
            <StopCircleIcon size={18} color="#ffffff" />
          </Pressable>
        )}
      </View>

      <AttachSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPickMedia={() => attach('media')}
        onPickFiles={() => attach('files')}
      />
      <ChatMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        conversation={conversation}
      />
      <PromptEditorModal
        open={editorOpen}
        initialValue={draft}
        onDone={(value) => {
          setDraft(value)
          setEditorOpen(false)
        }}
      />
    </View>
  )
}
