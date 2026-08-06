import { useFreshConfig } from '@/lib/sync/useFreshConfig'
import {
  ConfigSelectRow,
  ConfigStatusRow,
  ConfigSwitchRow,
  ConfigTextRow
} from '@/components/settings/ConfigRows'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { useTranslation } from 'react-i18next'

const STALE_HOURS = ['1', '3', '6', '12', '24'].map((value) => ({ value, label: value }))

/**
 * Channels — the desktop's In-App / Telegram / WhatsApp panels. Mobile edits
 * a channel's settings (allow-list, auto-refresh, stale window, verbose,
 * hide-automations) but never its power switch: enabling a channel starts a
 * bridge process on the desktop, which is the desktop's to start, so the
 * enabled row reports state and the rest gate on it. Every row binds to a
 * single config key, so a toggle re-renders only itself.
 */
export default function ChannelsScreen(): React.JSX.Element {
  // Desktop-owned values: pull the current ones when this screen opens.
  useFreshConfig()
  const { t } = useTranslation()

  return (
    <PanelScreen title={t('settings.tabs.channels')} subtitle={t('settings.channels.subtitle')}>
      {/* One in-app feed setting, not two: `inapp.verbose` is the desktop's
          own key and it drives this device's chat as well — the preference
          belongs to the workspace, not to whichever screen renders it. */}
      <Section title={t('settings.channels.inapp')}>
        <ConfigSwitchRow
          field="inappVerbose"
          label={t('settings.verbose.label')}
          description={t('settings.verbose.description')}
        />
      </Section>

      {/* This device, as the desktop's Mobile panel sees it — the same two
          settings, the same words, in the desktop's own channel order
          (in-app, phone, Telegram, WhatsApp). Both are real switches rather
          than status rows: unlike a Telegram bridge, nothing has to be
          started on the desktop for either to take effect, so the phone is
          free to drive its own channel. */}
      <Section title={t('settings.channels.phone')}>
        <ConfigSwitchRow
          field="mobileNotifications"
          label={t('settings.channels.notifications')}
          description={t('settings.channels.notificationsDescription')}
        />
        <ConfigSwitchRow
          field="mobileVerbose"
          label={t('settings.channels.taskResults')}
          description={t('settings.channels.taskResultsDescription')}
        />
      </Section>

      <Section title="Telegram">
        <ConfigStatusRow
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
          description={t('settings.verbose.channelDescription')}
          requires="telegramEnabled"
        />
      </Section>

      <Section title="WhatsApp">
        <ConfigStatusRow
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
          description={t('settings.verbose.channelDescription')}
          requires="whatsappEnabled"
        />
      </Section>
    </PanelScreen>
  )
}
