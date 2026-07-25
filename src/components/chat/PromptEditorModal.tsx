import { Button } from '@/components/core/Button'
import { useTokens } from '@/providers/theme/useTheme'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Expanded prompt editor — the mobile take on the desktop's draft-expand
 * modal (CodeMirror there): full-screen markdown editor with a line-number
 * gutter and the platform's typo correction (autocorrect + spellcheck)
 * enabled. Edits the same draft the composer holds.
 */

const LINE_HEIGHT = 20
const FONT_SIZE = 13

export function PromptEditorModal({
  open,
  initialValue,
  onDone
}: {
  open: boolean
  initialValue: string
  /** The single exit — Done (and the platform back gesture) commit the draft. */
  onDone: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const [value, setValue] = useState(initialValue)

  // Reset local state each time the editor opens with a fresh draft.
  const [openedWith, setOpenedWith] = useState(initialValue)
  if (open && openedWith !== initialValue) {
    setOpenedWith(initialValue)
    setValue(initialValue)
  }

  const lineCount = useMemo(() => Math.max(value.split('\n').length, 1), [value])
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'),
    [lineCount]
  )

  return (
    <RNModal visible={open} animationType="slide" onRequestClose={() => onDone(value)}>
      <View className="bg-bg flex-1" style={{ paddingTop: insets.top }}>
        <View className="border-border-soft flex-row items-center gap-2 border-b px-3 pb-2">
          <Text className="text-fg font-sans-semibold flex-1 text-left text-base">
            {t('chat.editor.title')}
          </Text>
          <Button size="sm" onPress={() => onDone(value)}>
            {t('chat.editor.done')}
          </Button>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-1 flex-row" style={{ direction: 'ltr' }}>
              {/* Line-number gutter — same font metrics as the input so rows align. */}
              <View className="bg-surface border-border border-e px-2 py-3">
                <Text
                  className="text-muted text-right font-mono"
                  style={{ fontSize: FONT_SIZE - 2, lineHeight: LINE_HEIGHT }}
                >
                  {gutter}
                </Text>
              </View>
              <TextInput
                multiline
                autoFocus
                value={value}
                onChangeText={setValue}
                autoCorrect
                spellCheck
                autoCapitalize="sentences"
                placeholder={t('chat.editor.placeholder')}
                placeholderTextColor={tokens.muted}
                selectionColor={tokens.accent}
                textAlignVertical="top"
                className="text-fg flex-1 px-3 py-3 font-mono"
                style={{ fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT }}
                accessibilityLabel={t('chat.editor.title')}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </RNModal>
  )
}
