import { SmartPhone01Icon, TelegramLogo, WhatsAppLogo } from '@/components/core/icons'
import { CodeChip } from '@/components/settings/SettingsUI'
import { useConversationList } from '@/lib/conversations/hooks'
import { formatBytes } from '@/lib/files/fileKinds'
import { computeUsageStats } from '@/lib/usage/stats'
import { cn } from '@/lib/utils/cn'
import { formatTokens } from '@/lib/utils/formatTokens'
import { formatShortWait, minutesUntilHour } from '@/lib/utils/schedule'
import { useLocale } from '@/providers/locale/useLocale'
import { useTheme } from '@/providers/theme/useTheme'
import {
  useConfigValue,
  useDemoConfig,
  useDesktopData,
  useDesktopInfo,
  useUsageDays
} from '@/state/demoConfig'
import Constants from 'expo-constants'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

/**
 * What each settings tab is worth knowing without opening it — the one figure
 * or state that answers "do I need to go in there?", rendered at the trailing
 * edge of its NavRow.
 *
 * One component per tab rather than one hook-heavy list screen, so the demo
 * config store's single-field subscription contract holds: flipping a
 * capability re-renders the capabilities summary, not the whole settings list.
 * Each one is also responsible for its own shrink behaviour — the row gives
 * the trailing slot no wrapper — so a long value truncates itself instead of
 * pushing the chevron off the row.
 */

const TONES = {
  muted: 'text-muted',
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400'
} as const

/** A summary that is words rather than a value: muted unless it is a state. */
function Note({
  children,
  tone = 'muted'
}: {
  children: string
  tone?: keyof typeof TONES
}): React.JSX.Element {
  return (
    <Text numberOfLines={1} className={cn('shrink font-sans text-xs', TONES[tone])}>
      {children}
    </Text>
  )
}

/**
 * Model — the brain and the mode it answers in. Only the model id truncates:
 * it is the long half and the one whose tail ("-4-8") matters least, while the
 * mode is two words that change what the app does.
 */
export function ModelSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const model = useConfigValue('brainModel')
  const mode = useConfigValue('chatMode')
  return (
    <View className="max-w-[55%] shrink flex-row items-center gap-1">
      <Text
        numberOfLines={1}
        style={{ writingDirection: 'ltr' }}
        className="text-muted shrink font-mono text-xs"
      >
        {model}
      </Text>
      {/* The separator is its own node so RTL mirrors the pair by flex order
          rather than by where a "·" landed inside a bidi string. */}
      <Text className="text-muted shrink-0 font-sans text-xs">·</Text>
      <Text className="text-muted shrink-0 font-sans text-xs">
        {t(`settings.chatModes.${mode}`)}
      </Text>
    </View>
  )
}

/**
 * Channels — this phone and the two bridges, as their own marks. A channel the
 * agent can actually reach you on is green; one it cannot stays muted rather
 * than disappearing, so the row says "WhatsApp is off" instead of leaving you
 * to wonder whether it exists.
 *
 * The phone leads, in the desktop's own channel order, and reads its
 * notifications switch: reachable is the question all three answer, and for
 * this device the answer is whether notify_phone is allowed to ring it. Being
 * paired is not the signal — you are looking at the app, so you know.
 */
export function ChannelsSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const phone = useConfigValue('mobileNotifications')
  const telegram = useConfigValue('telegramEnabled')
  const whatsapp = useConfigValue('whatsappEnabled')
  const state = (on: boolean): string => (on ? t('settings.toggle.on') : t('settings.toggle.off'))
  return (
    <View
      className="shrink-0 flex-row items-center gap-2"
      accessibilityLabel={`${t('settings.channels.notifications')} ${state(phone)}, Telegram ${state(
        telegram
      )}, WhatsApp ${state(whatsapp)}`}
    >
      <SmartPhone01Icon size={15} className={phone ? TONES.ok : TONES.muted} />
      <TelegramLogo size={15} className={telegram ? TONES.ok : TONES.muted} />
      <WhatsAppLogo size={15} className={whatsapp ? TONES.ok : TONES.muted} />
    </View>
  )
}

/**
 * Services — how many are actually live, out of the ones that can be. The
 * account links carry a connection the desktop reports; Brave, video and memes
 * carry a switch. Speech-to-text and text-to-speech are neither: they are
 * always-on settings, so counting them would only ever add a constant.
 */
export function ServicesSummary(): React.JSX.Element {
  const services = useDemoConfig((state) => state.services)
  const brave = useConfigValue('braveEnabled')
  const video = useConfigValue('videoEnabled')
  const memes = useConfigValue('memesEnabled')
  const switches = [brave, video, memes]
  const on =
    services.filter((service) => service.connected).length + switches.filter(Boolean).length
  return <CodeChip mono className="shrink-0" value={`${on}/${services.length + switches.length}`} />
}

/** MCP — servers switched on, out of those the desktop has configured. */
export function McpSummary(): React.JSX.Element {
  const servers = useDemoConfig((state) => state.mcpServers)
  const names = Object.keys(servers)
  return (
    <CodeChip
      mono
      className="shrink-0"
      value={`${names.filter((name) => servers[name]).length}/${names.length}`}
    />
  )
}

/**
 * Conversations — a plain count of what is on this device.
 *
 * `isLoading` renders an em dash rather than a `0`: "none" and "not read yet"
 * are different facts, and printing the first while the second is true is how a
 * list that has content reads as empty for a beat.
 *
 * Projects, Procedures, Automations and Customization used to have summaries
 * here too. They left Settings for the chat sheet, which renders label + icon
 * only, and their summaries left with them.
 */
export function ConversationsSummary(): React.JSX.Element {
  const { data, isLoading } = useConversationList()
  return <CodeChip mono className="shrink-0" value={isLoading ? '—' : `${data?.length ?? 0}`} />
}

/** Variables — a plain count: a variable is defined or it is not. */
export function VariablesSummary(): React.JSX.Element {
  const variables = useConfigValue('variables')
  return <CodeChip mono className="shrink-0" value={`${variables.length}`} />
}

/** Capabilities — active out of installed, the desktop's own active/inactive. */
export function CapabilitiesSummary(): React.JSX.Element {
  const capabilities = useDemoConfig((state) => state.capabilities)
  const names = Object.keys(capabilities)
  return (
    <CodeChip
      mono
      className="shrink-0"
      value={`${names.filter((name) => capabilities[name]).length}/${names.length}`}
    />
  )
}

/**
 * Knowledge — when the next two nightly passes fire, in the desktop's zone.
 * Both waits are labelled because "4h · 22h" alone leaves the reader to guess
 * which pass is which, and the whole point is not having to open the tab.
 */
export function KnowledgeSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const dailyHour = useConfigValue('compactionDailyHour')
  const reflectionHour = useConfigValue('reflectionHour')
  const { timezone } = useDesktopInfo()
  // Same 60s tick as the Knowledge panel's own next-run chip: a settings list
  // left open must not keep claiming the wait it had when it mounted.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const compaction = formatShortWait(minutesUntilHour(dailyHour, timezone, now), t)
  const reflection = formatShortWait(minutesUntilHour(reflectionHour, timezone, now), t)
  return (
    <Note>{`${t('settings.summary.compaction')} ${compaction} · ${t('settings.summary.reflection')} ${reflection}`}</Note>
  )
}

/** Usage — what today has cost in tokens, the ledger's headline figure. */
export function UsageSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const days = useUsageDays()
  // Cheap enough to recompute per render (one pass over day rows) and immune
  // to the stale-`now` a memo over `days` would freeze in at midnight.
  const { totalTokens } = computeUsageStats(days, 'today', new Date())
  return <Note>{t('settings.summary.today', { value: formatTokens(totalTokens, locale) })}</Note>
}

/**
 * Data — the workspace's size on the desktop. Same tiers the Data screen's
 * Workspace row prints, and the same em dash when no snapshot has landed:
 * this device cannot measure that machine.
 */
export function DataSummary(): React.JSX.Element {
  const { workspaceBytes } = useDesktopData()
  return <CodeChip mono className="shrink-0" value={formatBytes(workspaceBytes) || '—'} />
}

/** Updates — which build of THIS app is running, as its own screen prints it. */
export function UpdatesSummary(): React.JSX.Element {
  const version = Constants.expoConfig?.version ?? '?'
  const build =
    Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '?'
  return <CodeChip mono className="shrink-0" value={`v${version} (${build})`} />
}

/**
 * Preferences — whether the agent still stops to ask. Coloured rather than
 * merely stated: this is the one preference whose off state changes what
 * every run does, and a word in amber says so from the list.
 */
export function PreferencesSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const bypass = useConfigValue('bypassPermissions')
  return (
    <Note tone={bypass ? 'ok' : 'warn'}>
      {`${t('settings.summary.bypass')} ${bypass ? t('settings.toggle.on') : t('settings.toggle.off')}`}
    </Note>
  )
}

/**
 * Appearance — the theme SOURCE, not the scheme it resolved to: "System" is
 * the choice that was made, and whether it currently reads dark is already
 * visible on the screen saying so.
 */
export function AppearanceSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { locale } = useLocale()
  return <Note>{`${t(`theme.${theme}`)} · ${locale.toUpperCase()}`}</Note>
}
