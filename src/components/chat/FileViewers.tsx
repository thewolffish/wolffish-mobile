import {
  ArrowExpandIcon,
  CodeIcon,
  Copy01Icon,
  EyeIcon,
  File01Icon,
  Pdf02Icon,
  Upload01Icon,
  Table01Icon,
  Tick02Icon
} from '@/components/core/icons'
import { ExpandedSheet } from '@/components/core/ExpandedSheet'
import { delimiterFor, parseDelimited, type SheetTable } from '@/lib/files/csv'
import { fileName as baseName, formatBytes, type FileClassification } from '@/lib/files/fileKinds'
import { useWorkspaceFile } from '@/lib/files/useWorkspaceFile'
import { useWorkspaceFileText } from '@/lib/files/useWorkspaceFileText'
import { cn } from '@/lib/utils/cn'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import {
  CardFooter,
  CardHeader,
  CardShell,
  IconAction,
  MissingCard,
  RenderGuard,
  shareFile,
  type Align
} from './FileChrome'
import { MarkdownView } from './MarkdownView'

/**
 * Inline file viewers — the mobile counterparts of the desktop's
 * MarkdownFileViewer / CodeFileViewer / HtmlFileViewer / SpreadsheetViewer /
 * PdfViewer. Each renders a preview card at chat-bubble width and opens the
 * same content full-screen through ExpandedSheet, mirroring the desktop's
 * card→expand pair.
 *
 * Two mobile-specific rules, both about living inside a scrolling feed:
 *  - inline previews are NON-INTERACTIVE (a WebView that scrolls inside the
 *    chat list steals the list's pan gesture) — tapping a preview expands it,
 *    and the expanded sheet is where scrolling, zooming and links live;
 *  - the desktop's open/reveal/download trio collapses into the system share
 *    sheet, which is where "open in…", "save to Files" and "print" live.
 */

/** Line-numbered source and rendered markdown both clamp to this inline. */
const INLINE_BODY_HEIGHT = 260
/** Beyond this many characters the body is clipped for rendering only. */
const MAX_RENDER_CHARS = 120_000

function CopyAction({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const Icon = copied ? Tick02Icon : Copy01Icon
  return (
    <IconAction
      label={t('chat.copy')}
      icon={<Icon size={14} className={copied ? 'text-emerald-600' : 'text-muted'} />}
      onPress={() => {
        void Clipboard.setStringAsync(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    />
  )
}

function ShareAction({ uri }: { uri: string | null }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <IconAction
      label={t('chat.fileCard.share')}
      icon={<Upload01Icon size={14} className="text-muted" />}
      onPress={() => shareFile(uri)}
    />
  )
}

function ExpandAction({ onPress }: { onPress: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <IconAction
      label={t('chat.fileCard.expand')}
      icon={<ArrowExpandIcon size={14} className="text-muted" />}
      onPress={onPress}
    />
  )
}

function LoadingCard({ align }: { align?: Align }): React.JSX.Element {
  return (
    <CardShell align={align}>
      <View className="h-40 items-center justify-center">
        <ActivityIndicator />
      </View>
    </CardShell>
  )
}

/**
 * Non-interactive preview that expands on tap — see the file header note.
 * Text-ish bodies pass `maxHeight` so a two-line file gets a two-line card;
 * WebView bodies (HTML, PDF) have no intrinsic height and pass `height`.
 */
function PreviewTap({
  onPress,
  label,
  height,
  maxHeight,
  children
}: {
  onPress: () => void
  label: string
  height?: number
  maxHeight?: number
  children: ReactNode
}): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <View
        pointerEvents="none"
        style={height !== undefined ? { height } : { maxHeight }}
        className="overflow-hidden"
      >
        {children}
      </View>
    </Pressable>
  )
}

/** Line-numbered monospace body — one Text per column keeps it cheap. */
function SourceBody({ content, flex }: { content: string; flex?: boolean }): React.JSX.Element {
  const shown = content.length > MAX_RENDER_CHARS ? content.slice(0, MAX_RENDER_CHARS) : content
  const gutter = useMemo(
    () => Array.from({ length: Math.max(shown.split('\n').length, 1) }, (_, i) => i + 1).join('\n'),
    [shown]
  )
  return (
    <ScrollView
      className={flex ? 'flex-1' : ''}
      style={flex ? undefined : { maxHeight: INLINE_BODY_HEIGHT }}
      nestedScrollEnabled
    >
      {/* The gutter sits OUTSIDE the horizontal scroller — line numbers stay
          pinned to the leading edge while only the code slides sideways (the
          desktop does the same with `sticky left-0`). Both columns share the
          vertical scroller and the same line metrics, so rows stay aligned. */}
      <View className="flex-row" style={{ direction: 'ltr' }}>
        <View className="bg-bg/50 border-border border-e px-2 py-2">
          <Text
            className="text-muted/70 text-right font-mono"
            style={{ fontSize: 11, lineHeight: 18 }}
            selectable={false}
          >
            {gutter}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text
            className="text-fg px-3 py-2 font-mono"
            style={{ fontSize: 11, lineHeight: 18 }}
            selectable
          >
            {shown}
          </Text>
        </ScrollView>
      </View>
    </ScrollView>
  )
}

function MarkdownBody({ content, flex }: { content: string; flex?: boolean }): React.JSX.Element {
  const shown = content.length > MAX_RENDER_CHARS ? content.slice(0, MAX_RENDER_CHARS) : content
  return (
    <ScrollView
      className={flex ? 'flex-1' : ''}
      style={flex ? undefined : { maxHeight: INLINE_BODY_HEIGHT }}
      contentContainerStyle={{ padding: 12 }}
      nestedScrollEnabled
    >
      <MarkdownView>{shown}</MarkdownView>
    </ScrollView>
  )
}

export type FileViewerProps = {
  relPath: string
  conversationId?: string
  classification: FileClassification
  sizeBytes?: number
  displayName?: string
  align?: Align
  /** Rendered when the body can't be shown inline (missing, oversized, binary). */
  fallback: React.JSX.Element
}

/**
 * Markdown, plain-text and source files: rendered markdown or line-numbered
 * source, clamped inline with copy/share/expand — the desktop's
 * MarkdownFileViewer/CodeFileViewer card.
 */
export function TextFileCard({
  relPath,
  conversationId,
  classification,
  sizeBytes,
  displayName,
  align,
  fallback
}: FileViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    text,
    uri,
    sizeBytes: readSize,
    loading,
    missing,
    oversized
  } = useWorkspaceFileText(relPath, conversationId)
  const name = displayName ?? classification.name ?? baseName(relPath)

  if (loading) return <LoadingCard align={align} />
  if (missing || oversized || text === null) return fallback

  const isMarkdown = classification.kind === 'markdown'
  const lineCount = text.split('\n').length
  const body = isMarkdown ? <MarkdownBody content={text} /> : <SourceBody content={text} />
  const expandedBody = isMarkdown ? (
    <MarkdownBody content={text} flex />
  ) : (
    <SourceBody content={text} flex />
  )
  const footerLabel = [
    classification.language ?? classification.ext,
    formatBytes(sizeBytes || readSize)
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <CardShell align={align}>
      <CardHeader
        icon={
          isMarkdown ? (
            <File01Icon size={14} className="text-muted" />
          ) : (
            <CodeIcon size={14} className="text-muted" />
          )
        }
        name={name}
        meta={t('chat.fileViewer.lines', { count: lineCount })}
      />
      <PreviewTap onPress={() => setOpen(true)} label={name} maxHeight={INLINE_BODY_HEIGHT}>
        {body}
      </PreviewTap>
      <CardFooter label={footerLabel}>
        <ShareAction uri={uri} />
        <CopyAction text={text} />
        <ExpandAction onPress={() => setOpen(true)} />
      </CardFooter>
      <ExpandedSheet
        open={open}
        onClose={() => setOpen(false)}
        title={name}
        actions={
          <>
            <ShareAction uri={uri} />
            <CopyAction text={text} />
          </>
        }
      >
        {expandedBody}
      </ExpandedSheet>
    </CardShell>
  )
}

/**
 * HTML files: a live (sandboxed) render of the page with a source toggle —
 * the desktop's HtmlFileViewer. The inline card is a static preview; expanding
 * gives the full-screen, interactive page, which is the mobile answer to
 * "open this website".
 */
export function HtmlFileCard({
  relPath,
  conversationId,
  classification,
  sizeBytes,
  displayName,
  align,
  fallback
}: FileViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const {
    text,
    uri,
    sizeBytes: readSize,
    loading,
    missing,
    oversized
  } = useWorkspaceFileText(relPath, conversationId)
  const name = displayName ?? classification.name ?? baseName(relPath)

  if (loading) return <LoadingCard align={align} />
  if (missing || oversized || text === null) return fallback

  // The page runs for real — scripts and all — which is the point of
  // delivering an HTML file to a phone. It is confined the same way the
  // desktop's sandboxed iframe is: loaded from a string (opaque origin, no
  // baseUrl), no file access, no shared storage, so it can reach neither the
  // app's data nor the workspace cache. Only the initial document load may
  // navigate the frame — a tapped link opens in the system browser instead of
  // replacing the card's contents.
  const frame = (
    <WebView
      originWhitelist={['*']}
      source={{ html: text }}
      style={{ backgroundColor: 'white' }}
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      domStorageEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === 'about:blank' || request.url.startsWith('data:')) return true
        if (/^https?:/.test(request.url)) void WebBrowser.openBrowserAsync(request.url)
        return false
      }}
    />
  )

  const previewing = view === 'preview'
  const footerLabel = ['html', formatBytes(sizeBytes || readSize)].filter(Boolean).join(' · ')
  const viewToggle = (
    <IconAction
      label={t(`chat.htmlViewer.${previewing ? 'source' : 'preview'}`)}
      selected={previewing}
      icon={
        previewing ? (
          <CodeIcon size={14} className="text-muted" />
        ) : (
          <EyeIcon size={14} className="text-muted" />
        )
      }
      onPress={() => setView(previewing ? 'source' : 'preview')}
    />
  )

  return (
    <CardShell align={align}>
      <CardHeader icon={<CodeIcon size={14} className="text-muted" />} name={name} />
      <PreviewTap onPress={() => setOpen(true)} label={name} height={INLINE_BODY_HEIGHT}>
        {/* While the sheet is up the card is hidden behind it — don't keep a
            second copy of the page (and its scripts) alive underneath. */}
        {open ? (
          <View className="bg-surface flex-1" />
        ) : previewing ? (
          frame
        ) : (
          <SourceBody content={text} />
        )}
      </PreviewTap>
      <CardFooter label={footerLabel}>
        {viewToggle}
        <ShareAction uri={uri} />
        <CopyAction text={text} />
        <ExpandAction onPress={() => setOpen(true)} />
      </CardFooter>
      <ExpandedSheet
        open={open}
        onClose={() => setOpen(false)}
        title={name}
        actions={
          <>
            {viewToggle}
            <ShareAction uri={uri} />
            <CopyAction text={text} />
          </>
        }
      >
        {previewing ? frame : <SourceBody content={text} flex />}
      </ExpandedSheet>
    </CardShell>
  )
}

function SheetGrid({ table, flex }: { table: SheetTable; flex?: boolean }): React.JSX.Element {
  const [header, ...body] = table.rows
  return (
    <ScrollView
      horizontal
      className={flex ? 'flex-1' : ''}
      style={flex ? undefined : { maxHeight: INLINE_BODY_HEIGHT }}
    >
      <ScrollView nestedScrollEnabled style={flex ? undefined : { maxHeight: INLINE_BODY_HEIGHT }}>
        <View style={{ direction: 'ltr' }}>
          {header ? (
            <View className="bg-bg/60 border-border flex-row border-b">
              {header.map((cell, index) => (
                <Text
                  key={index}
                  numberOfLines={2}
                  className="text-fg font-sans-medium border-border w-32 border-e px-2 py-1.5 text-left text-[11px]"
                >
                  {cell}
                </Text>
              ))}
            </View>
          ) : null}
          {body.map((row, rowIndex) => (
            <View key={rowIndex} className="border-border/60 flex-row border-b">
              {row.map((cell, index) => (
                <Text
                  key={index}
                  numberOfLines={2}
                  className="text-fg border-border/60 w-32 border-e px-2 py-1.5 text-left font-sans text-[11px]"
                >
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  )
}

/** CSV/TSV rendered as a table — the desktop's SpreadsheetViewer for those. */
export function SheetFileCard({
  relPath,
  conversationId,
  classification,
  sizeBytes,
  displayName,
  align,
  fallback
}: FileViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    text,
    uri,
    sizeBytes: readSize,
    loading,
    missing,
    oversized
  } = useWorkspaceFileText(relPath, conversationId)
  const table = useMemo(
    () => (text === null ? null : parseDelimited(text, delimiterFor(classification.ext))),
    [text, classification.ext]
  )
  const name = displayName ?? classification.name ?? baseName(relPath)

  if (loading) return <LoadingCard align={align} />
  if (missing || oversized || text === null || table === null || table.rows.length === 0) {
    return fallback
  }

  const footerLabel = [
    t('chat.fileViewer.rows', { count: table.totalRows }),
    formatBytes(sizeBytes || readSize)
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <CardShell align={align}>
      <CardHeader icon={<Table01Icon size={14} className="text-muted" />} name={name} />
      <PreviewTap onPress={() => setOpen(true)} label={name} maxHeight={INLINE_BODY_HEIGHT}>
        <SheetGrid table={table} />
      </PreviewTap>
      <CardFooter label={footerLabel}>
        <ShareAction uri={uri} />
        <CopyAction text={text} />
        <ExpandAction onPress={() => setOpen(true)} />
      </CardFooter>
      <ExpandedSheet
        open={open}
        onClose={() => setOpen(false)}
        title={name}
        actions={
          <>
            <ShareAction uri={uri} />
            <CopyAction text={text} />
          </>
        }
      >
        <SheetGrid table={table} flex />
      </ExpandedSheet>
    </CardShell>
  )
}

/**
 * PDFs. iOS renders them natively in WKWebView, so the card shows a real
 * first-page preview and expands to a scrollable document — the desktop's
 * PdfViewer. Android's WebView has no PDF engine, so there the card hands off
 * to the system viewer through the share sheet (`fallback`).
 */
export function PdfFileCard({
  relPath,
  conversationId,
  classification,
  sizeBytes,
  displayName,
  align,
  fallback
}: FileViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { uri, sizeBytes: cachedSize, loading, missing } = useWorkspaceFile(relPath, conversationId)
  const name = displayName ?? classification.name ?? baseName(relPath)

  if (Platform.OS !== 'ios') return fallback
  if (loading) return <LoadingCard align={align} />
  if (missing || !uri) return fallback

  const directory = uri.slice(0, uri.lastIndexOf('/') + 1)
  const frame = (
    <WebView
      source={{ uri }}
      // Without file:// in the whitelist the WebView refuses the document and
      // punts it to Linking.openURL, which can't open a sandbox path — the
      // card renders blank. This is what makes the PDF preview appear at all.
      originWhitelist={['file://*']}
      // iOS needs explicit read access to the containing directory to load a
      // file:// document; scoping it to the file's own folder keeps the frame
      // away from the rest of the cache.
      allowingReadAccessToURL={directory}
      allowFileAccess
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      style={{ backgroundColor: 'white' }}
      onShouldStartLoadWithRequest={(request) => request.url.startsWith('file://')}
    />
  )

  return (
    <CardShell align={align}>
      <CardHeader icon={<Pdf02Icon size={14} className="text-muted" />} name={name} />
      <PreviewTap onPress={() => setOpen(true)} label={name} height={INLINE_BODY_HEIGHT + 60}>
        {/* One document renderer at a time — see HtmlFileCard. */}
        {open ? <View className="bg-surface flex-1" /> : frame}
      </PreviewTap>
      <CardFooter
        label={[classification.ext.toUpperCase(), formatBytes(sizeBytes || cachedSize)]
          .filter(Boolean)
          .join(' · ')}
      >
        <ShareAction uri={uri} />
        <ExpandAction onPress={() => setOpen(true)} />
      </CardFooter>
      <ExpandedSheet
        open={open}
        onClose={() => setOpen(false)}
        title={name}
        actions={<ShareAction uri={uri} />}
      >
        {frame}
      </ExpandedSheet>
    </CardShell>
  )
}

/**
 * The catch-all card: icon, name, type · size, and a tap that hands the file
 * to the OS (share sheet → open in…, save to Files). Also the fallback every
 * viewer above degrades to.
 */
export function GenericFileCard({
  relPath,
  conversationId,
  sizeBytes,
  displayName,
  classification,
  align
}: {
  relPath: string
  conversationId?: string
  sizeBytes?: number
  displayName?: string
  classification: FileClassification
  align?: Align
}): React.JSX.Element {
  const { t } = useTranslation()
  const { uri, sizeBytes: cachedSize, loading, missing } = useWorkspaceFile(relPath, conversationId)
  const name = displayName ?? classification.name ?? baseName(relPath)
  // Attachments carry a size; delivered files don't — fall back to the file
  // the cache actually holds (the desktop stats over IPC for the same reason).
  const shownSize = sizeBytes || cachedSize

  if (!loading && (missing || !uri)) {
    return <MissingCard label={t('chat.fileCard.deleted')} align={align} />
  }

  const isPdf = classification.kind === 'pdf'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      disabled={loading || !uri}
      onPress={() => shareFile(uri)}
      className={cn(
        // w-[85%], not max-w — a card sized to its filename would sit short of
        // every other card in the feed.
        'bg-surface border-border w-[85%] flex-row items-center gap-3 rounded-xl border px-4 py-3',
        'active:bg-border/40',
        align === 'end' ? 'self-end' : 'self-start'
      )}
    >
      <View className="bg-bg border-border h-10 w-10 items-center justify-center rounded-lg border">
        {loading ? (
          <ActivityIndicator size="small" />
        ) : isPdf ? (
          <Pdf02Icon size={18} className="text-muted" />
        ) : (
          <File01Icon size={18} className="text-muted" />
        )}
      </View>
      <View className="min-w-0 flex-shrink flex-col gap-0.5">
        <Text numberOfLines={1} className="text-fg font-sans-medium text-left text-sm">
          {name}
        </Text>
        <Text className="text-muted text-left font-sans text-xs">
          {[classification.ext.toUpperCase(), formatBytes(shownSize)].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  )
}
