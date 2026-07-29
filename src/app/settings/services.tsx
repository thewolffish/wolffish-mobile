import { Input } from '@/components/core/Input'
import type { SelectOption } from '@/components/core/Select'
import { SERVICE_LOGOS } from '@/components/core/providerLogos'
import { ConfigSelectRow, ConfigSwitchRow, ConfigTextRow } from '@/components/settings/ConfigRows'
import { PanelScreen, Section, StatusDot } from '@/components/settings/SettingsUI'
import { cn } from '@/lib/utils/cn'
import { useDemoConfig } from '@/state/demoConfig'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

/**
 * Services — every desktop service panel, with the full config.json surface
 * each one owns: Brave, Memes, STT, TTS, Computer Use and the Browser
 * Extension are edited here; Google / GitHub / Notion stay read-only because
 * the action behind them is an OAuth flow or a token the desktop keychain
 * holds. Every editable row binds to a single flat config key.
 */

/** Kokoro's English voice catalog, verbatim from the desktop TTS panel. */
const VOICES: Array<{ id: string; label: string; lang: 'us' | 'uk' }> = [
  { id: 'af_bella', label: 'Bella', lang: 'us' },
  { id: 'af_heart', label: 'Heart', lang: 'us' },
  { id: 'af_nicole', label: 'Nicole', lang: 'us' },
  { id: 'af_sarah', label: 'Sarah', lang: 'us' },
  { id: 'af_aoede', label: 'Aoede', lang: 'us' },
  { id: 'af_kore', label: 'Kore', lang: 'us' },
  { id: 'af_nova', label: 'Nova', lang: 'us' },
  { id: 'af_sky', label: 'Sky', lang: 'us' },
  { id: 'am_adam', label: 'Adam', lang: 'us' },
  { id: 'am_michael', label: 'Michael', lang: 'us' },
  { id: 'am_eric', label: 'Eric', lang: 'us' },
  { id: 'am_liam', label: 'Liam', lang: 'us' },
  { id: 'am_onyx', label: 'Onyx', lang: 'us' },
  { id: 'am_puck', label: 'Puck', lang: 'us' },
  { id: 'bf_emma', label: 'Emma', lang: 'uk' },
  { id: 'bf_isabella', label: 'Isabella', lang: 'uk' },
  { id: 'bf_alice', label: 'Alice', lang: 'uk' },
  { id: 'bf_lily', label: 'Lily', lang: 'uk' },
  { id: 'bm_george', label: 'George', lang: 'uk' },
  { id: 'bm_lewis', label: 'Lewis', lang: 'uk' },
  { id: 'bm_daniel', label: 'Daniel', lang: 'uk' },
  { id: 'bm_fable', label: 'Fable', lang: 'uk' }
]

/** Whisper sizes the desktop offers, plus the turbo build the workspace runs. */
const STT_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'large-v3-turbo']

const SCREENSHOT_WIDTHS: readonly SelectOption<string>[] = ['640', '960', '1280', '1920'].map(
  (value) => ({ value, label: `${value}px` })
)

const SCREENSHOT_FORMATS: readonly SelectOption<string>[] = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' }
]

/**
 * Section header: the service's brand mark and name on the leading edge, and
 * — for the services that have a link to be up or down — the connection state
 * on the trailing edge, dot and label together, in the tone that state
 * deserves.
 */
function ServiceHeader({
  serviceKey,
  connected
}: {
  serviceKey: string
  connected?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const Logo = SERVICE_LOGOS[serviceKey]
  return (
    <View className="flex-row items-center gap-2">
      {Logo ? <Logo size={16} className="text-fg" /> : null}
      <Text className="text-fg font-sans-semibold flex-1 text-left text-sm">
        {t(`settings.services.items.${serviceKey}`)}
      </Text>
      {/* Dot and label read as one unit — the dot is the label's bullet, so
          it sits with the state, not with the service's identity. */}
      {connected === undefined ? null : (
        <View className="flex-row items-center gap-1.5">
          <StatusDot connected={connected} />
          <Text
            className={cn(
              'font-sans text-xs',
              connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'
            )}
          >
            {connected ? t('settings.services.connected') : t('settings.services.notConnected')}
          </Text>
        </View>
      )}
    </View>
  )
}

/**
 * A credential field, deliberately NOT bound to the config store: secrets
 * belong in the desktop's keychain, never in this device's AsyncStorage. It
 * renders the same masked affordance the desktop shows for a stored key so
 * the surface is complete — same posture as the provider key on Model.
 */
function SecretRow({
  label,
  secure = true
}: {
  label: string
  secure?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Input
      label={label}
      placeholder={t('settings.services.secretPlaceholder')}
      secureTextEntry={secure}
      autoCapitalize="none"
      autoCorrect={false}
    />
  )
}

function DesktopNote(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Text className="text-muted text-left font-sans text-xs leading-5">
      {t('settings.services.desktopOnly')}
    </Text>
  )
}

export default function ServicesScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const services = useDemoConfig((state) => state.services)
  const byKey = new Map(services.map((service) => [service.key, service]))

  const voiceOptions = useMemo<readonly SelectOption<string>[]>(
    () =>
      VOICES.map((voice) => ({
        value: voice.id,
        label: `${voice.label} · ${t(`settings.services.voiceLang.${voice.lang}`)}`
      })),
    [t]
  )
  const sttOptions = useMemo<readonly SelectOption<string>[]>(
    () => STT_MODELS.map((value) => ({ value, label: value })),
    []
  )
  const speedOptions = useMemo<readonly SelectOption<string>[]>(
    () => [
      { value: '0.75', label: t('settings.services.speed.slow') },
      { value: '1.0', label: t('settings.services.speed.normal') },
      { value: '1.25', label: t('settings.services.speed.fast') },
      { value: '1.5', label: t('settings.services.speed.veryFast') }
    ],
    [t]
  )

  const connectionRows = (key: string): React.JSX.Element[] =>
    (byKey.get(key)?.connections ?? []).map((connection, index) => (
      <View key={index} className="flex-row items-center justify-between gap-3">
        <Text className="text-fg text-left font-sans text-sm">{connection.label}</Text>
        <Text numberOfLines={1} className="text-muted flex-shrink text-left font-sans text-xs">
          {connection.detail}
        </Text>
      </View>
    ))

  return (
    <PanelScreen title={t('settings.tabs.services')} subtitle={t('settings.services.subtitle')}>
      {/* Account links — the connect/OAuth/token half stays desktop-bound. */}
      {['google', 'github', 'notion'].map((key) => (
        <Section key={key}>
          <ServiceHeader serviceKey={key} connected={byKey.get(key)?.connected ?? false} />
          {connectionRows(key)}
          <DesktopNote />
        </Section>
      ))}

      <Section>
        <ServiceHeader serviceKey="brave" />
        <ConfigSwitchRow
          field="braveEnabled"
          label={t('settings.channels.enabled')}
          description={t('settings.services.brave.description')}
        />
        <SecretRow label={t('settings.services.brave.apiKey')} />
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.services.secretNote')}
        </Text>
      </Section>

      <Section>
        <ServiceHeader serviceKey="memes" />
        <ConfigSwitchRow
          field="memesEnabled"
          label={t('settings.channels.enabled')}
          description={t('settings.services.memes.description')}
        />
        <SecretRow label={t('settings.services.memes.imgflipUsername')} secure={false} />
        <SecretRow label={t('settings.services.memes.imgflipPassword')} />
        <SecretRow label={t('settings.services.memes.giphyKey')} />
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.services.secretNote')}
        </Text>
      </Section>

      <Section>
        <ServiceHeader serviceKey="stt" />
        <ConfigSelectRow
          field="sttModel"
          label={t('settings.services.sttModel')}
          options={sttOptions}
        />
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.services.stt.hint')}
        </Text>
      </Section>

      <Section>
        <ServiceHeader serviceKey="tts" />
        <ConfigSelectRow
          field="ttsVoice"
          label={t('settings.services.ttsVoice')}
          options={voiceOptions}
          searchable
        />
        <ConfigSelectRow
          field="ttsSpeed"
          label={t('settings.services.ttsSpeed')}
          options={speedOptions}
        />
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.services.tts.hint')}
        </Text>
      </Section>

      <Section>
        <ServiceHeader
          serviceKey="computerUse"
          connected={byKey.get('computerUse')?.connected ?? false}
        />
        {connectionRows('computerUse')}
        <ConfigSelectRow
          field="screenshotMaxWidth"
          label={t('settings.services.screenshotMaxWidth')}
          options={SCREENSHOT_WIDTHS}
        />
        <ConfigSelectRow
          field="screenshotFormat"
          label={t('settings.services.screenshotFormat')}
          options={SCREENSHOT_FORMATS}
        />
      </Section>

      <Section>
        <ServiceHeader
          serviceKey="browserExtension"
          connected={byKey.get('browserExtension')?.connected ?? false}
        />
        {connectionRows('browserExtension')}
        <ConfigTextRow
          field="browserExtensionPort"
          label={t('settings.services.browserExtension.port')}
          keyboardType="number-pad"
        />
        <ConfigSelectRow
          field="browserScreenshotMaxWidth"
          label={t('settings.services.screenshotMaxWidth')}
          options={SCREENSHOT_WIDTHS}
        />
        <ConfigSelectRow
          field="browserScreenshotFormat"
          label={t('settings.services.screenshotFormat')}
          options={SCREENSHOT_FORMATS}
        />
        <ConfigTextRow
          field="browserScreenshotQuality"
          label={t('settings.services.browserExtension.quality')}
          keyboardType="number-pad"
        />
        {/* Not the generic desktop-only note — the settings above ARE editable
            here; only the install-and-pair handshake is desktop-bound. */}
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.services.browserExtension.pairingNote')}
        </Text>
      </Section>
    </PanelScreen>
  )
}
