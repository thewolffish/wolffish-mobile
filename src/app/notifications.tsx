import {
  Archive02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  InboxIcon,
  Notification03Icon,
  Tick02Icon
} from '@/components/core/icons'
import { ConfirmDialog } from '@/components/core/ConfirmDialog'
import { SegmentedTabs } from '@/components/core/SegmentedTabs'
import { groupByRecency } from '@/lib/conversations/grouping'
import { hrefForDeeplink } from '@/lib/notifications/route'
import { goBack } from '@/lib/utils/back'
import { cn } from '@/lib/utils/cn'
import { formatSignedRelative } from '@/lib/utils/relativeTime'
import { useNotifications, type NotificationRecord } from '@/state/notifications'
import type { NotifyPhase } from '@/lib/tunnel/protocol'
import { router } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { I18nManager, Pressable, SectionList, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * The notifications page — everything the desktop has told this phone, kept
 * after the banner is gone.
 *
 * A notification used to exist for exactly as long as the OS chose to show it:
 * miss the banner, swipe it away, and the only trace left was a number on a
 * conversation. This screen is the other half of that — the text itself, the
 * time it was sent, and the same deeplink the banner carried, so a missed
 * notification is still a way into the conversation that raised it.
 *
 * TWO TABS, because a notification has two independent ends. Read/unread is
 * about attention and does not move anything: a read notification stays in the
 * list, just quietly. Archived is about the list itself, and it is one-way —
 * archiving reads at the same time, so the archive is a finished pile rather
 * than a second inbox to work through. The store (state/notifications.ts) owns
 * that rule; this screen only offers it.
 *
 * MARKING READ IS NOT COSMETIC. It takes the badge down with it — the app icon,
 * the relay's copy of the count, and the number on that conversation's row
 * everywhere it appears — by exactly one, which is why the store tracks per
 * notification whether it ever counted. That is the whole reason this page
 * needs buttons rather than just a list: unread here and unread on the icon are
 * the same fact, and the user must be able to answer it from either end.
 */

type Tab = 'inbox' | 'archive'

/** The phase chip's tint, in the vocabulary the conversation chips already
 *  use (see ConversationChip.chipTone) — real palette colors, because a var()
 *  token cannot carry an /alpha in this project. */
function phaseTone(phase: NotifyPhase): string {
  switch (phase) {
    case 'completed':
      return 'border-emerald-500/40 bg-emerald-500/10'
    case 'failed':
      return 'border-red-500/40 bg-red-500/10'
    case 'needs_input':
      return 'border-amber-500/40 bg-amber-500/10'
    case 'started':
      return 'border-primary-line bg-primary-soft'
    default:
      return 'border-border'
  }
}

function phaseText(phase: NotifyPhase): string {
  switch (phase) {
    case 'completed':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'failed':
      return 'text-red-600 dark:text-red-400'
    case 'needs_input':
      return 'text-amber-600 dark:text-amber-400'
    case 'started':
      return 'text-primary'
    default:
      return 'text-muted'
  }
}

function RowSeparator(): React.JSX.Element {
  return <View className="h-2" />
}

/**
 * One notification's own small control — icon above a label, sized for a
 * thumb, on the card's own surface. Not the core Button: these sit INSIDE a
 * pressable card and must read as secondary to it.
 */
function CardAction({
  label,
  Icon,
  onPress
}: {
  label: string
  Icon: (props: { size: number; className: string }) => React.JSX.Element
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      className="border-border flex-row items-center gap-1.5 rounded-lg border px-2.5 py-1.5 active:bg-border-soft"
    >
      <Icon size={13} className="text-muted" />
      <Text numberOfLines={1} className="text-muted font-sans-medium text-[11px]">
        {label}
      </Text>
    </Pressable>
  )
}

const Card = memo(function Card({
  record,
  time,
  phaseLabel,
  newLabel,
  readLabel,
  archiveLabel,
  onOpen,
  onRead,
  onArchive
}: {
  record: NotificationRecord
  time: string
  phaseLabel: string
  newLabel: string
  readLabel: string
  archiveLabel: string
  onOpen: (record: NotificationRecord) => void
  onRead: (id: string) => void
  onArchive: (id: string) => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={record.title}
      onPress={() => onOpen(record)}
      className={cn(
        'bg-surface flex-col gap-1.5 rounded-xl border px-4 py-3 active:bg-border-soft',
        // The unread mark is the card's own outline rather than a dot the eye
        // has to find: a list is scanned down its edge, and a tinted border is
        // legible at that speed in both themes.
        record.read ? 'border-border' : 'border-primary-line'
      )}
    >
      <View className="flex-row items-center gap-2">
        <View className={cn('rounded-full border px-2 py-0.5', phaseTone(record.phase))}>
          <Text className={cn('font-sans-medium text-[10px]', phaseText(record.phase))}>
            {phaseLabel}
          </Text>
        </View>
        {/* min-w-0 with flex-1: without it a long relative phrase pushes the
            trailing edge off the card rather than truncating inside it. */}
        <Text
          numberOfLines={1}
          className="text-muted min-w-0 flex-1 text-right font-sans text-[11px]"
        >
          {time}
        </Text>
      </View>
      <Text
        className={cn(
          'text-left text-sm',
          record.read ? 'text-fg font-sans-medium' : 'text-fg font-sans-semibold'
        )}
      >
        {record.title}
      </Text>
      {/* The whole body, unclipped: it is capped at 180 characters upstream,
          and this page exists precisely to show what the banner cut off. */}
      <Text className="text-muted text-left font-sans text-xs leading-relaxed">{record.body}</Text>
      {(!record.archived || !record.read) && (
        <View className="flex-row items-center gap-2 pt-1">
          {/* The actions grow and wrap inside their own box; min-w-0 with
              flex-1 is what keeps a long translation shrinking itself instead
              of shoving the chip off the card. */}
          <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
            {!record.archived && !record.read && (
              <CardAction label={readLabel} Icon={Tick02Icon} onPress={() => onRead(record.id)} />
            )}
            {!record.archived && (
              <CardAction
                label={archiveLabel}
                Icon={Archive02Icon}
                onPress={() => onArchive(record.id)}
              />
            )}
          </View>
          {/* The unread mark: a word, on the card's trailing bottom corner —
              solid primary, the same pill the unread counts wear everywhere
              else in the app, so "unread" reads as one mark throughout. It
              sits at the END of the card rather than the start because that is
              where the eye leaves each card, and it is text rather than a dot
              because a dot has to be learned. Mirrors on its own: the row is
              a flex-row, which React Native reverses under RTL. */}
          {!record.read && (
            <View className="bg-primary rounded-full px-2 py-0.5">
              <Text className="text-primary-fg font-sans-semibold text-[10px]">{newLabel}</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  )
})

/**
 * One of the two bulk controls, in the header beside the title — icon only,
 * where a page-level action belongs, rather than a labelled bar between the
 * tabs and the list they act on.
 *
 * Both are destructive enough to ask first: "mark all read" answers every
 * notification at once and takes the badges with them, and "archive all"
 * empties the inbox. Neither can be undone from this screen, and both are one
 * mis-tap away from the tabs.
 */
function HeaderAction({
  label,
  Icon,
  disabled,
  onPress
}: {
  label: string
  Icon: (props: { size: number; className: string }) => React.JSX.Element
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-9 w-9 items-center justify-center rounded-lg',
        disabled ? 'opacity-40' : 'active:bg-border-soft'
      )}
    >
      <Icon size={18} className="text-muted" />
    </Pressable>
  )
}

function Empty({ title, hint }: { title: string; hint: string }): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8 pt-24">
      <Notification03Icon size={28} className="text-muted" />
      <Text className="text-fg font-sans-medium text-center text-sm">{title}</Text>
      <Text className="text-muted text-center font-sans text-xs leading-relaxed">{hint}</Text>
    </View>
  )
}

export default function NotificationsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('inbox')
  /** Which bulk action is waiting on its confirmation, if any. */
  const [confirming, setConfirming] = useState<'read' | 'archive' | null>(null)
  const items = useNotifications((state) => state.items)
  const markRead = useNotifications((state) => state.markRead)
  const archive = useNotifications((state) => state.archive)
  const markAllRead = useNotifications((state) => state.markAllRead)
  const archiveAll = useNotifications((state) => state.archiveAll)

  const visible = useMemo(
    () => items.filter((record) => (tab === 'archive' ? record.archived : !record.archived)),
    [items, tab]
  )
  // The same recency ladder History and the conversations sheet use, so
  // "Yesterday" means one thing across the app. The store keeps `items`
  // newest-first, which is what the grouper requires.
  const groups = useMemo(() => groupByRecency(visible, (record) => record.at), [visible])

  /**
   * The clock the whole list is measured against — one instant per tick, so a
   * long list cannot show two cards from the same minute disagreeing about how
   * long ago it was, and it MOVES, so a page left open does not keep saying
   * "now" about something from half an hour ago.
   *
   * State plus a timer rather than a bare `Date.now()` in the render body:
   * this project builds with the React Compiler, which memoizes a value whose
   * inputs never change — and `Date.now()` has no inputs, so it can be read
   * once and frozen for the life of the screen. Every other relative time in
   * this app keeps its clock the same way.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const open = useCallback(
    (record: NotificationRecord) => {
      // Reading it is the first half of answering it — and it is the half that
      // takes the badge down, which must happen whether or not the link
      // resolves on this build.
      markRead(record.id)
      const href = hrefForDeeplink(record.deeplink)
      // Pushed, so the notifications page stays underneath and Back returns
      // here — the same thing opening a conversation from History does.
      if (href) router.push(href)
    },
    [markRead]
  )

  const BackIcon = I18nManager.isRTL ? ArrowRight01Icon : ArrowLeft01Icon

  return (
    <View className="bg-bg flex-1" style={{ paddingTop: insets.top }}>
      <View className="border-border-soft flex-row items-center gap-1 border-b px-2 pb-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={goBack}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-border-soft"
        >
          <BackIcon size={20} className="text-fg" />
        </Pressable>
        {/* min-w-0 with flex-1: the title is the growing half of the bar, and
            without it a long translation pushes the two actions off the end
            instead of truncating itself. */}
        <Text
          numberOfLines={1}
          className="text-fg font-sans-semibold min-w-0 flex-1 text-left text-base"
        >
          {t('notifications.title')}
        </Text>
        {/* Inbox only: there is nothing left to read or archive in the
            archive, and two permanently dead controls are worse than none. */}
        {tab === 'inbox' && (
          <>
            <HeaderAction
              label={t('notifications.markAllRead')}
              Icon={Tick02Icon}
              disabled={visible.length === 0}
              onPress={() => setConfirming('read')}
            />
            <HeaderAction
              label={t('notifications.archiveAll')}
              Icon={Archive02Icon}
              disabled={visible.length === 0}
              onPress={() => setConfirming('archive')}
            />
          </>
        )}
      </View>

      <View className="px-4 pt-3">
        <SegmentedTabs
          value={tab}
          accessibilityLabel={t('notifications.title')}
          options={[
            {
              value: 'inbox',
              label: t('notifications.tabs.inbox'),
              icon: (p) => <InboxIcon {...p} />
            },
            {
              value: 'archive',
              label: t('notifications.tabs.archive'),
              icon: (p) => <Archive02Icon {...p} />
            }
          ]}
          onChange={setTab}
        />
      </View>

      {visible.length === 0 ? (
        <Empty
          title={t(tab === 'archive' ? 'notifications.archiveEmpty' : 'notifications.empty')}
          hint={t(tab === 'archive' ? 'notifications.archiveEmptyHint' : 'notifications.emptyHint')}
        />
      ) : (
        <SectionList
          sections={groups}
          keyExtractor={(record) => record.id}
          // The desktop's headers scroll away with their group rather than
          // pinning; RN sticks them on iOS by default, so turn that off.
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text
              className={cn(
                'text-muted font-sans-medium px-1 pb-1.5 text-left text-[11px] uppercase',
                section.startIndex > 1 && 'pt-5'
              )}
            >
              {t(section.labelKey)}
            </Text>
          )}
          renderItem={({ item }) => (
            <Card
              record={item}
              time={formatSignedRelative(item.at, now, t)}
              phaseLabel={t(`notifications.phase.${item.phase}`)}
              newLabel={t('notifications.new')}
              readLabel={t('notifications.markRead')}
              archiveLabel={t('notifications.archive')}
              onOpen={open}
              onRead={markRead}
              onArchive={archive}
            />
          )}
          ItemSeparatorComponent={RowSeparator}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
        />
      )}

      {/* One dialog for both, told apart by which action asked: two dialogs
          would be two copies of the same footer, and only one can ever be
          open. Nothing runs until it is confirmed — these are the only
          controls on the page that touch every notification at once. */}
      <ConfirmDialog
        open={confirming !== null}
        title={t(
          confirming === 'archive'
            ? 'notifications.confirmArchiveAll.title'
            : 'notifications.confirmReadAll.title'
        )}
        message={t(
          confirming === 'archive'
            ? 'notifications.confirmArchiveAll.message'
            : 'notifications.confirmReadAll.message',
          { count: visible.length }
        )}
        confirmLabel={t(
          confirming === 'archive' ? 'notifications.archiveAll' : 'notifications.markAllRead'
        )}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming === 'archive') archiveAll()
          else if (confirming === 'read') markAllRead()
          setConfirming(null)
        }}
      />
    </View>
  )
}
