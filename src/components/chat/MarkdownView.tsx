import { useTokens } from '@/providers/theme/useTheme'
import { useMemo } from 'react'
import { I18nManager, Platform, ScrollView, View, useWindowDimensions } from 'react-native'
import Markdown from 'react-native-markdown-display'
import * as WebBrowser from 'expo-web-browser'
import type { ThemeTokens } from '@/lib/theme/colors'

/**
 * Markdown for chat bubbles — mirrors the desktop core/Markdown component:
 * GFM-ish rendering (markdown-it default: tables, autolinks, strikethrough),
 * bordered LTR code blocks, horizontally scrollable tables, accent links
 * opened in the in-app browser. Styled from the live theme tokens so it
 * follows light/dark, with a variant for the primary-colored user bubble.
 */

export type MarkdownVariant = 'assistant' | 'user'

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

/**
 * First strong directional character decides the block's direction — the
 * mobile equivalent of the desktop's dir="auto" on message content. Beyond
 * fidelity this is load-bearing: laying out RTL-dominant text under a forced
 * LTR writingDirection makes iOS text measurement explode to absurd heights
 * (observed with real Arabic digest conversations).
 */
const STRONG_LTR_RE = /[A-Za-zÀ-ɏ]/g
const STRONG_RTL_RE = /[֐-ࣿיִ-﷽ﹰ-ﻼ]/g

/** Whether markdown contains a GFM table — such bubbles need definite width. */
export function markdownHasTable(text: string): boolean {
  return /^\s*\|.*\|\s*$/m.test(text)
}

export function contentIsRtl(text: string): boolean {
  const sample = text.slice(0, 2000)
  const ltr = sample.match(STRONG_LTR_RE)?.length ?? 0
  const rtl = sample.match(STRONG_RTL_RE)?.length ?? 0
  if (ltr === 0 && rtl === 0) return I18nManager.isRTL
  return rtl > ltr
}

function buildStyles(
  tokens: ThemeTokens,
  variant: MarkdownVariant,
  rtl: boolean
): Record<string, object> {
  const onPrimary = variant === 'user'
  const fg = onPrimary ? tokens.primaryFg : tokens.fg
  const muted = onPrimary ? tokens.primaryFg : tokens.muted
  const border = onPrimary ? `${tokens.primaryFg}44` : tokens.border
  const codeBg = onPrimary ? '#00000022' : tokens.bg
  const accent = onPrimary ? tokens.primaryFg : tokens.accent

  return {
    body: {
      color: fg,
      fontFamily: 'IBMPlexSansArabic-Regular',
      fontSize: 14,
      lineHeight: 21,
      writingDirection: rtl ? 'rtl' : 'ltr',
      textAlign: rtl ? 'right' : 'left'
    },
    paragraph: { marginTop: 0, marginBottom: 8 },
    heading1: {
      fontFamily: 'IBMPlexSansArabic-SemiBold',
      fontSize: 20,
      marginBottom: 8,
      marginTop: 8
    },
    heading2: {
      fontFamily: 'IBMPlexSansArabic-SemiBold',
      fontSize: 18,
      marginBottom: 8,
      marginTop: 8
    },
    heading3: {
      fontFamily: 'IBMPlexSansArabic-SemiBold',
      fontSize: 16,
      marginBottom: 6,
      marginTop: 6
    },
    heading4: {
      fontFamily: 'IBMPlexSansArabic-SemiBold',
      fontSize: 14,
      marginBottom: 6,
      marginTop: 6
    },
    strong: { fontFamily: 'IBMPlexSansArabic-SemiBold' },
    em: { fontStyle: 'italic' },
    link: { color: accent, textDecorationLine: 'underline' },
    blockquote: {
      backgroundColor: 'transparent',
      borderStartWidth: 2,
      borderStartColor: border,
      borderLeftWidth: 2,
      borderLeftColor: border,
      paddingLeft: 12,
      paddingRight: 0,
      marginLeft: 0,
      color: muted,
      fontStyle: 'italic'
    },
    hr: { backgroundColor: border, height: 1, marginVertical: 12 },
    bullet_list: { marginBottom: 8 },
    ordered_list: { marginBottom: 8 },
    list_item: { marginBottom: 2 },
    code_inline: {
      backgroundColor: codeBg,
      color: fg,
      fontFamily: MONO_FONT,
      fontSize: 12,
      borderWidth: 0,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 1
    },
    code_block: {
      backgroundColor: codeBg,
      color: fg,
      fontFamily: MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
      borderWidth: 1,
      borderColor: border,
      borderRadius: 8,
      padding: 12,
      writingDirection: 'ltr',
      textAlign: 'left'
    },
    fence: {
      backgroundColor: codeBg,
      color: fg,
      fontFamily: MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
      borderWidth: 1,
      borderColor: border,
      borderRadius: 8,
      padding: 12,
      writingDirection: 'ltr',
      textAlign: 'left'
    },
    // Every border-bearing key must be overridden — the library defaults
    // tables and blocklinks to pure #000000, which reads as a harsh black
    // line in both themes.
    table: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: 8,
      marginBottom: 8
    },
    thead: { borderColor: border },
    tbody: { borderColor: border },
    th: {
      padding: 8,
      fontFamily: 'IBMPlexSansArabic-SemiBold',
      fontSize: 13,
      minWidth: 112,
      textAlign: 'left',
      borderColor: border
    },
    tr: { borderBottomWidth: 1, borderColor: border, flexDirection: 'row' },
    td: { padding: 8, fontSize: 13, minWidth: 112, textAlign: 'left', borderColor: border },
    blocklink: { borderColor: border, borderBottomWidth: 1 },
    image: { borderRadius: 16, marginVertical: 4 }
  }
}

export type MarkdownViewProps = {
  children: string
  variant?: MarkdownVariant
}

export function MarkdownView({
  children,
  variant = 'assistant'
}: MarkdownViewProps): React.JSX.Element {
  const tokens = useTokens()
  const { width } = useWindowDimensions()
  const rtl = useMemo(() => contentIsRtl(children), [children])
  const styles = useMemo(() => buildStyles(tokens, variant, rtl), [tokens, variant, rtl])
  const rules = useMemo(
    () => ({
      // Tables and fenced code overflow horizontally inside their own
      // scroller — the feed itself must never scroll sideways.
      // NOTE: a bubble containing a table must have a DEFINITE width
      // (w-[85%], not max-w) — see markdownHasTable. A horizontal scroller
      // under content-sized ancestors creates a circular width constraint
      // that explodes Yoga into a screens-tall blank void (observed with
      // real Arabic table replies).
      table: (node: { key: string }, children: React.ReactNode) => (
        <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.table as object}>{children}</View>
        </ScrollView>
      )
    }),
    [styles, width]
  )

  return (
    <Markdown
      style={styles}
      rules={rules}
      onLinkPress={(url: string) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          void WebBrowser.openBrowserAsync(url)
        }
        return false
      }}
    >
      {children}
    </Markdown>
  )
}
