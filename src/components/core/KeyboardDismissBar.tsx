import { KeyboardHideIcon } from '@/components/core/icons'
import { useTranslation } from 'react-i18next'
import { InputAccessoryView, Keyboard, Platform, Pressable, View } from 'react-native'

/**
 * The iPhone's missing keyboard-dismiss control. Android docks a chevron in
 * its navigation bar and the iPad keyboard carries its own dismiss key; the
 * iPhone keyboard ships with no way out at all — the app is expected to
 * provide one. The feed's swipe-down gesture is that answer for anyone who
 * knows it; this is the visible one: a chevron docked just above the
 * keyboard, riding it as it comes and goes (and down with the interactive
 * drag, since the accessory belongs to the keyboard's own window).
 *
 * iOS only, twice over: Android needs nothing, and InputAccessoryView exists
 * nowhere else anyway. A field opts in by naming KEYBOARD_DISMISS_BAR_ID as
 * its inputAccessoryViewID — which is also why the full-screen editors
 * (PromptEditorModal, MarkdownDocEditor) go without: an InputAccessoryView
 * hosted inside an RN Modal never renders on iOS, and both carry their own
 * header exits.
 */

export const KEYBOARD_DISMISS_BAR_ID = 'keyboard-dismiss-bar'

export function KeyboardDismissBar(): React.JSX.Element | null {
  const { t } = useTranslation()
  if (Platform.OS !== 'ios') return null
  return (
    <InputAccessoryView nativeID={KEYBOARD_DISMISS_BAR_ID}>
      {/* Trailing edge, where the thumb already lives — justify-end so RTL
          mirrors it. The disc is the composer card's own surface-and-border
          language; border-border rather than border-soft, which reads black
          on a floating disc in dark mode. */}
      <View className="flex-row justify-end px-3 py-1.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.hideKeyboard')}
          hitSlop={8}
          onPress={() => Keyboard.dismiss()}
          className="bg-surface border-border h-8 w-8 items-center justify-center rounded-full border active:opacity-60"
        >
          <KeyboardHideIcon size={18} className="text-muted" />
        </Pressable>
      </View>
    </InputAccessoryView>
  )
}
