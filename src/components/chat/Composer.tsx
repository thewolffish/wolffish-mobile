import {
  ArrowExpandIcon,
  ArrowUp02Icon,
  Delete02Icon,
  Menu01Icon,
  Mic01Icon,
  StopCircleIcon,
  Tick02Icon
} from '@/components/core/icons'
import { INPUT_TEXT_ALIGN, WRITING_DIRECTION, rtlPlaceholder } from '@/components/core/Input'
import type { ConversationFile } from '@/lib/conversations/types'
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
import { ChatMenuSheet } from './ChatMenuSheet'
import { PromptEditorModal } from './PromptEditorModal'
import { RainbowBorder } from './RainbowBorder'

/**
 * The chat composer — desktop grammar mapped to touch: growing surface
 * textarea flanked by 42.5pt icon buttons, primary arrow-up send that turns
 * into a red stop while streaming, mic on the end cluster, and the rainbow
 * strip on top while a turn runs. Voice flow: idle → recording (pulsing red
 * dot + counter) → send/delete straight from the recording bar.
 */

export type ComposerSubmit =
  { kind: 'text'; text: string } | { kind: 'voice'; uri: string; durationSeconds: number }

export type ComposerProps = {
  streaming: boolean
  conversation: ConversationFile | null | undefined
  onSubmit: (payload: ComposerSubmit) => void
  onStop: () => void
}

export function Composer({
  streaming,
  conversation,
  onSubmit,
  onStop
}: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const tokens = useTokens()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 500)
  const [recording, setRecording] = useState(false)

  const canSend = draft.trim().length > 0

  const submitText = (): void => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    onSubmit({ kind: 'text', text })
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

  const mmss = (millis: number): string => {
    const s = Math.max(0, Math.floor(millis / 1000))
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  return (
    <View className="bg-bg border-border-soft border-t">
      {streaming && <RainbowBorder />}
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
            <TextInput
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder={rtlPlaceholder(t('chat.placeholder'))}
              placeholderTextColor={tokens.muted}
              selectionColor={tokens.accent}
              style={[{ minHeight: 42.5, maxHeight: 160 }, WRITING_DIRECTION]}
              className={cn(
                'bg-surface border-border rounded-lg border px-3 py-2.5 pe-8 font-sans text-sm leading-5',
                'text-fg',
                INPUT_TEXT_ALIGN
              )}
              accessibilityLabel={t('chat.placeholder')}
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

        {/* Distinct keys so React unmounts one and mounts the other on the
            mic↔send swap, instead of reusing one instance and mutating its
            variable-bearing className (which trips css-interop's remount
            warning in dev). */}
        {!recording && !streaming && !canSend && (
          <Pressable
            key="composer-mic"
            accessibilityRole="button"
            accessibilityLabel={t('chat.voice.record')}
            onPress={() => void startRecording()}
            className="border-border bg-surface h-[42.5px] w-[42.5px] items-center justify-center rounded-lg border active:bg-border/40"
          >
            <Mic01Icon size={18} className="text-fg" />
          </Pressable>
        )}

        {!recording && (streaming || canSend) && (
          <Pressable
            key="composer-send"
            accessibilityRole="button"
            accessibilityLabel={streaming ? t('chat.stop') : t('chat.send')}
            onPress={streaming ? onStop : submitText}
            className={cn(
              'h-[42.5px] w-[42.5px] items-center justify-center rounded-lg',
              streaming ? 'bg-red-600 active:bg-red-700' : 'bg-primary active:opacity-90'
            )}
          >
            {streaming ? (
              <StopCircleIcon size={18} color="#ffffff" />
            ) : (
              <ArrowUp02Icon size={18} color={tokens.primaryFg} />
            )}
          </Pressable>
        )}
      </View>

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
