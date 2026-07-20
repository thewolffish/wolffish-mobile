import { ComputerIcon, Moon02Icon, Sun03Icon } from '@/components/core/icons'
import { Select, type SelectOption } from '@/components/core/Select'
import { useTheme, type ThemeSource } from '@/providers/theme/useTheme'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export function ThemeSelector({ className }: { className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  const options = useMemo<readonly SelectOption<ThemeSource>[]>(
    () => [
      {
        value: 'system',
        label: t('theme.system'),
        icon: <ComputerIcon size={16} className="text-muted" />
      },
      {
        value: 'light',
        label: t('theme.light'),
        icon: <Sun03Icon size={16} className="text-muted" />
      },
      {
        value: 'dark',
        label: t('theme.dark'),
        icon: <Moon02Icon size={16} className="text-muted" />
      }
    ],
    [t]
  )

  return (
    <Select<ThemeSource>
      label={t('theme.label')}
      value={theme}
      options={options}
      onChange={(next) => void setTheme(next)}
      className={className}
    />
  )
}
