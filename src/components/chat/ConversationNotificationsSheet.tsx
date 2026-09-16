import { Notification03Icon } from '@/components/core/icons'
import { NotificationCard } from '@/components/notifications/NotificationCard'
import { formatSignedRelative } from '@/lib/utils/relativeTime'
import { unarchivedFor, useNotifications } from '@/state/notifications'
import { useTheme, useTokens } from '@/providers/theme/useTheme'
import { BlurView } from 'expo-blur'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Animated,
  Easing,
  FlatList,
  I18nManager,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * What THIS conversation has told you — the notifications it raised, read
 * back beside the transcript that produced them.
 *
 * The notifications page answers "what has reached this phone"; this answers
 * "what did this run say while I was not looking", which is a different
 * question asked at a different moment. Being in a conversation marks its
 * notifications read (see clearConversationBadges), so by the time this sheet
 * opens they are usually all read — that is exactly why read ones still show
 * here. What does NOT show is an archived one: archiving is filing, and the
 * page is where a filed notification is read back.
 *
 * It comes in from the TRAILING edge, opposite the conversations sheet, and
 * that is the whole spatial argument: one door out to everything else, one
 * door into what this conversation has said. Mirrored by direction rather than
 * pinned to a side — `justify-end` on a flex-row, which React Native reverses
 * under RTL, so it is the right edge in English and the left in Arabic without
 * either being named.
 *
 * Its two actions carry no confirmation, unlike the page's bulk pair: they act
 * on ONE notification, and both are recoverable from the page.
 */

/** Panel width, capped so it never swallows a tablet's whole screen. */
const MAX_WIDTH = 360
const WIDTH_RATIO = 0.88

/** Enter duration. Short: this is a glance, not a destination. */
const SLIDE_MS = 200

export type ConversationNotificationsSheetProps = {
  open: boolean
  onClose: () => void
  /** The conversation on screen — whose notifications these are. */
  conversationId: string
}

/**
 * The shell, and the slide.
 *
 * Presented exactly while `open` is true, with no leaving animation of its
 * own — the same rule ConversationsSheet arrived at the hard way. A Modal that
 * un-mounts from an animation completion callback stays presented whenever
 * that callback does not arrive, and a fully transparent full-screen Modal
 * over the app swallows every touch while looking like nothing is there.
 */
export function ConversationNotificationsSheet({
  open,
  onClose,
  conversationId
}: ConversationNotificationsSheetProps): React.JSX.Element | null {
  const { isDark } = useTheme()
  const tokens = useTokens()
  const { width: screenWidth } = useWindowDimensions()
  const width = Math.min(MAX_WIDTH, Math.round(screenWidth * WIDTH_RATIO))

  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!open) {
      progress.setValue(0)
      return
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    })
    animation.start()
    return () => animation.stop()
  }, [open, progress])

  if (!open) return null

  /**
   * Off-screen, away from the TRAILING edge — the mirror of the conversations
   * sheet's own hidden offset. Physical, and deliberately so: React Native
   * does not mirror transforms under RTL (a translateX of +width moves right
   * on both sides of the world), so this is the one place the direction has to
   * be asked for by name. The anchoring below mirrors on its own.
   */
  const hidden = I18nManager.isRTL ? -width : width
  const panelSlide = {
    transform: [
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [hidden, 0] }) }
    ]
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <BlurView
          pointerEvents="none"
          intensity={20}
          tint={isDark ? 'dark' : 'light'}
          blurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" className="absolute inset-0 bg-black/40" />
        {/* Anywhere off the panel closes it — the sheet is a glance, and a
            glance should cost one tap to end. */}
        <Pressable accessibilityRole="none" onPress={onClose} style={StyleSheet.absoluteFill} />
        {/* justify-end puts the panel on the TRAILING edge; RN reverses the
            row under RTL, so it needs no side named and no isRTL branch. */}
        <View
          pointerEvents="box-none"
          style={StyleSheet.absoluteFill}
          className="flex-row justify-end"
        >
          <Animated.View
            style={[
              { width },
              panelSlide,
              // The rule between the panel and the conversation behind it, on
              // its INWARD edge. borderStartWidth is direction-aware in Yoga
              // and is not part of RN's left/right swap, so it lands inward
              // either way — the mirror of the other sheet's borderEndWidth.
              { borderStartWidth: 1, borderColor: tokens.borderSoft }
            ]}
            className="bg-bg"
          >
            <SheetBody conversationId={conversationId} />
          </Animated.View>
        </View>
      </View>
    </Modal>
  )
}

function SheetBody({ conversationId }: { conversationId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const markRead = useNotifications((state) => state.markRead)
  const archive = useNotifications((state) => state.archive)
  // `items` is the subscription, and the filter is derived from it. Selecting
  // the filtered array directly would hand zustand a fresh array on every
  // call, and Object.is would report a change on every store write.
  const items = useNotifications((state) => state.items)
  const records = useMemo(() => unarchivedFor({ items }, conversationId), [items, conversationId])

  /** One instant for the whole list, and it moves — see the page's own clock
   *  for why a bare Date.now() in a render body is not safe in this project. */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <View className="flex-1">
      <View
        className="border-border-soft flex-row items-center gap-2 border-b px-4 pb-3"
        style={{ paddingTop: insets.top + 12 }}
      >
        <Notification03Icon size={17} className="text-muted" />
        <Text
          numberOfLines={1}
          className="text-fg font-sans-semibold min-w-0 flex-1 text-left text-base"
        >
          {t('notifications.title')}
        </Text>
      </View>
      {records.length === 0 ? (
        // Reachable for a beat: archiving the last card empties the sheet
        // under the user's finger rather than closing it out from under them.
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-muted text-center font-sans text-sm">
            {t('notifications.conversationEmpty')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(record) => record.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 16 }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          renderItem={({ item }) => (
            <NotificationCard
              record={item}
              time={formatSignedRelative(item.at, now, t)}
              phaseLabel={t(`notifications.phase.${item.phase}`)}
              newLabel={t('notifications.new')}
              readLabel={t('notifications.markRead')}
              archiveLabel={t('notifications.archive')}
              // A tap ACKNOWLEDGES, and goes nowhere. Every card here belongs
              // to the conversation already underneath this sheet, so the
              // page's navigate-on-tap would push a second copy of the screen
              // the user is looking at.
              onOpen={(record) => markRead(record.id)}
              onRead={markRead}
              onArchive={archive}
            />
          )}
        />
      )}
      {/* Nothing else: no bulk actions, no tabs. This is one conversation's
          handful, and the page is where the whole pile is worked through. */}
    </View>
  )
}
