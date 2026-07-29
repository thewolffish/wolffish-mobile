import {
  AiMagicIcon,
  AnalyticsUpIcon,
  ArrowUp02Icon,
  BrainIcon,
  BubbleChatIcon,
  Database02Icon,
  DnaIcon,
  Key01Icon,
  McpServerIcon,
  NeuralNetworkIcon,
  PaintBoardIcon,
  PuzzleIcon
} from '@/components/core/icons'
import { NavRow, PanelScreen } from '@/components/settings/SettingsUI'
import { useConfigValue } from '@/state/demoConfig'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

/**
 * Settings root — the desktop's settings sidebar as a nav list: same tab
 * order, same hugeicons per tab (Settings.tsx TABS), live state summaries.
 */
export default function SettingsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const brainModel = useConfigValue('brainModel')

  const rows: Array<{
    key: string
    href: string
    icon: React.JSX.Element
    description?: string
  }> = [
    {
      key: 'model',
      href: '/settings/model',
      icon: <NeuralNetworkIcon size={18} className="text-muted" />,
      description: brainModel
    },
    {
      key: 'channels',
      href: '/settings/channels',
      icon: <BubbleChatIcon size={18} className="text-muted" />
    },
    {
      key: 'services',
      href: '/settings/services',
      icon: <PuzzleIcon size={18} className="text-muted" />
    },
    { key: 'mcp', href: '/settings/mcp', icon: <McpServerIcon size={18} className="text-muted" /> },
    {
      key: 'variables',
      href: '/settings/variables',
      icon: <Key01Icon size={18} className="text-muted" />
    },
    {
      key: 'capabilities',
      href: '/settings/capabilities',
      icon: <BrainIcon size={18} className="text-muted" />
    },
    {
      key: 'knowledge',
      href: '/settings/knowledge',
      icon: <DnaIcon size={18} className="text-muted" />
    },
    {
      key: 'usage',
      href: '/settings/usage',
      icon: <AnalyticsUpIcon size={18} className="text-muted" />
    },
    {
      key: 'data',
      href: '/settings/data',
      icon: <Database02Icon size={18} className="text-muted" />
    },
    {
      key: 'updates',
      href: '/settings/updates',
      icon: <ArrowUp02Icon size={18} className="text-muted" />
    },
    {
      key: 'preferences',
      href: '/settings/preferences',
      icon: <AiMagicIcon size={18} className="text-muted" />
    },
    {
      key: 'appearance',
      href: '/settings/appearance',
      icon: <PaintBoardIcon size={18} className="text-muted" />
    }
  ]

  return (
    <PanelScreen title={t('settings.title')}>
      <View className="flex-col gap-2">
        {rows.map((row) => (
          <NavRow
            key={row.key}
            label={t(`settings.tabs.${row.key}`)}
            description={row.description}
            icon={row.icon}
            onPress={() => router.push(row.href as never)}
          />
        ))}
      </View>
    </PanelScreen>
  )
}
