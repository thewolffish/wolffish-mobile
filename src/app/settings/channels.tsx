import { ConfigSelectRow, ConfigSwitchRow, ConfigTextRow } from '@/components/settings/ConfigRows'
import { PanelScreen, Section, SwitchRow } from '@/components/settings/SettingsUI'
import { useAppStore } from '@/state/appStore'
import { useTranslation } from 'react-i18next'

const STALE_HOURS = ['1', '3', '6', '12', '24'].map((value) => ({ value, label: value }))

/**
 * Channels — the desktop's In-App / Telegram / WhatsApp panels with their
 * full control sets: enable, allow-lists, auto-refresh, stale window, verbose
 * and hide-automations. Every row binds to a single config key, so a toggle
 * re-renders only itself.
 */
export default function ChannelsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const verbose = useAppStore((state) => state.verboseFeed)
  const setVerboseFeed = useAppStore((state) => state.setVerboseFeed)

  return (
    <PanelScreen title={t('settings.tabs.channels')} subtitle={t('settings.channels.subtitle')}>
      <Section title={t('settings.channels.inapp')}>
        <SwitchRow
          label={t('settings.verbose.label')}
          description={t('settings.verbose.description')}
          value={verbose}
          onValueChange={setVerboseFeed}
        />
      </Section>

      <Section title="Telegram">
        <ConfigSwitchRow
          field="telegramEnabled"
          label={t('settings.channels.enabled')}
          description={t('settings.channels.telegramDescription')}
        />
        <ConfigTextRow
          field="telegramAllowedUserIds"
          label={t('settings.channels.allowedUserIds')}
          requires="telegramEnabled"
        />
        <ConfigSwitchRow
          field="telegramAutoRefresh"
          label={t('settings.channels.autoRefresh')}
          description={t('settings.channels.autoRefreshDescription')}
          requires="telegramEnabled"
        />
        <ConfigSelectRow
          field="telegramStaleHours"
          label={t('settings.channels.staleHours')}
          options={STALE_HOURS}
        />
        <ConfigSwitchRow
          field="telegramHideAutomations"
          label={t('settings.channels.hideAutomations')}
          description={t('settings.channels.hideAutomationsDescription')}
          requires="telegramEnabled"
        />
        <ConfigSwitchRow
          field="telegramVerbose"
          label={t('settings.verbose.label')}
          requires="telegramEnabled"
        />
      </Section>

      <Section title="WhatsApp">
        <ConfigSwitchRow
          field="whatsappEnabled"
          label={t('settings.channels.enabled')}
          description={t('settings.channels.whatsappDescription')}
        />
        <ConfigTextRow
          field="whatsappAllowedNumbers"
          label={t('settings.channels.allowedNumbers')}
          requires="whatsappEnabled"
          keyboardType="phone-pad"
        />
        <ConfigSwitchRow
          field="whatsappAutoRefresh"
          label={t('settings.channels.autoRefresh')}
          description={t('settings.channels.autoRefreshDescription')}
          requires="whatsappEnabled"
        />
        <ConfigSelectRow
          field="whatsappStaleHours"
          label={t('settings.channels.staleHours')}
          options={STALE_HOURS}
        />
        <ConfigSwitchRow
          field="whatsappHideAutomations"
          label={t('settings.channels.hideAutomations')}
          description={t('settings.channels.hideAutomationsDescription')}
          requires="whatsappEnabled"
        />
        <ConfigSwitchRow
          field="whatsappVerbose"
          label={t('settings.verbose.label')}
          requires="whatsappEnabled"
        />
      </Section>
    </PanelScreen>
  )
}
