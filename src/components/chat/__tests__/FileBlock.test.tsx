/**
 * End-to-end render test for delivered/attached files: one case per file type
 * the desktop app supports, driven through the real FileBlock dispatch, the
 * real viewers and a faked workspace cache. A regression here means a file the
 * desktop renders would land in the mobile feed as a dead card.
 */
import { ThemeContext } from '@/providers/theme/useTheme'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }))

/** relPath → body. Anything absent from this map is a missing file. */
const FILES: Record<string, string> = {
  'files/shot.png': 'binary-png',
  'files/clip.mp4': 'binary-mp4',
  'voice/reply.mp3': 'binary-mp3',
  'files/report.pdf': '%PDF-1.4 binary',
  'files/page.html': '<html><body><h1>Report</h1></body></html>',
  'files/README.md': '# Title\n\nSome **bold** prose.',
  'files/notes.txt': 'plain line one\nplain line two',
  'files/app.ts': 'export const answer = 42\n',
  'files/data.csv': 'name,qty\nwidget,7\ngizmo,3',
  'files/logo.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>',
  'files/book.xlsx': 'binary-xlsx',
  'files/letter.docx': 'binary-docx',
  'files/archive.zip': 'binary-zip'
}

jest.mock('@/lib/files/fileCache', () => ({
  resolveWorkspaceFile: jest.fn(async (relPath: string) =>
    relPath in FILES ? `file:///cache/${relPath}` : null
  )
}))

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    get size(): number {
      return this.body().length
    }
    private body(): string {
      return FILES[this.uri.replace('file:///cache/', '')] ?? ''
    }
    async text(): Promise<string> {
      return this.body()
    }
  }
}))

jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native')
  return { Image: (props: object) => <View testID="image" {...props} /> }
})

jest.mock('react-native-webview', () => {
  const { View } = jest.requireActual('react-native')
  return { WebView: (props: object) => <View testID="webview" {...props} /> }
})

jest.mock('expo-video', () => {
  const { View } = jest.requireActual('react-native')
  return {
    // Includes the listener surface `useEvent(player, 'statusChange')` needs.
    useVideoPlayer: () => ({
      loop: false,
      status: 'readyToPlay',
      play: jest.fn(),
      pause: jest.fn(),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      removeListener: jest.fn()
    }),
    VideoView: (props: object) => <View testID="video" {...props} />
  }
})

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn() }),
  useAudioPlayerStatus: () => ({ playing: false, duration: 12, currentTime: 0 })
}))

jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined) }))
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => undefined) }))

import '@/lib/i18n'
import { FileBlock } from '@/components/chat/FileBlock'
import * as Sharing from 'expo-sharing'

const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 }
}

// `render` and `fireEvent` are async in RNTL 14: they resolve their own
// `act()` before the render result is published to `screen`. Every call site
// must await, or the queries below race the mount.
async function renderBlock(element: ReactElement): Promise<void> {
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA}>
      <ThemeContext.Provider
        value={{ theme: 'light', isDark: false, setTheme: async () => undefined }}
      >
        {element}
      </ThemeContext.Provider>
    </SafeAreaProvider>
  )
}

describe('FileBlock — one delivered file per supported type', () => {
  it('renders an image as a tappable thumbnail that expands full screen', async () => {
    await renderBlock(<FileBlock relPath="files/shot.png" declared="image" />)
    await waitFor(() => expect(screen.getByTestId('image')).toBeTruthy())

    await fireEvent.press(screen.getByLabelText('shot.png'))
    // Thumbnail + the expanded sheet's full-bleed copy.
    await waitFor(() => expect(screen.getAllByTestId('image').length).toBeGreaterThan(1))
    expect(screen.getByText('shot.png')).toBeTruthy()
  })

  it('renders a video in the native player', async () => {
    await renderBlock(<FileBlock relPath="files/clip.mp4" declared="video" />)
    await waitFor(() => expect(screen.getByTestId('video')).toBeTruthy())
    expect(screen.getByText('clip.mp4')).toBeTruthy()
  })

  it('renders audio as a transport with a play control', async () => {
    await renderBlock(<FileBlock relPath="voice/reply.mp3" declared="audio" />)
    await waitFor(() => expect(screen.getByText('reply.mp3')).toBeTruthy())
    expect(screen.getByText('0:00 / 0:12')).toBeTruthy()

    // Audio carries the same export affordance as video.
    await fireEvent.press(screen.getByLabelText('Share'))
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/voice/reply.mp3')
  })

  it('renders a PDF preview that expands (iOS)', async () => {
    await renderBlock(<FileBlock relPath="files/report.pdf" declared="document" />)
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy())
    expect(screen.getByText('report.pdf')).toBeTruthy()

    await fireEvent.press(screen.getByLabelText('Expand'))
    // The sheet takes over the single document renderer; its close control is
    // the proof it is up.
    await waitFor(() => expect(screen.getByLabelText('Close')).toBeTruthy())
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('renders HTML live, toggles to source, and expands', async () => {
    await renderBlock(<FileBlock relPath="files/page.html" declared="file" />)
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy())

    await fireEvent.press(screen.getByLabelText('Source'))
    await waitFor(() => expect(screen.queryByTestId('webview')).toBeNull())
    expect(screen.getByText(/<h1>Report<\/h1>/)).toBeTruthy()

    await fireEvent.press(screen.getByLabelText('Preview'))
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy())

    await fireEvent.press(screen.getByLabelText('Expand'))
    await waitFor(() => expect(screen.getByLabelText('Close')).toBeTruthy())
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('renders markdown as rich text, not source', async () => {
    await renderBlock(<FileBlock relPath="files/README.md" declared="file" />)
    await waitFor(() => expect(screen.getByText('Title')).toBeTruthy())
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('renders plain text as line-numbered source', async () => {
    await renderBlock(<FileBlock relPath="files/notes.txt" declared="document" />)
    await waitFor(() => expect(screen.getByText(/plain line one/)).toBeTruthy())
    expect(screen.getByText('1\n2')).toBeTruthy()
    expect(screen.getByText('2 lines')).toBeTruthy()
  })

  it('renders source files as a code card', async () => {
    await renderBlock(<FileBlock relPath="files/app.ts" declared="file" />)
    await waitFor(() => expect(screen.getByText(/export const answer = 42/)).toBeTruthy())
    expect(screen.getByText(/typescript/)).toBeTruthy()
  })

  it('renders an SVG exactly like any other image', async () => {
    // expo-image decodes SVG, so a delivered logo gets the same thumbnail,
    // lightbox and share as a .png — no card chrome, and never its markup.
    await renderBlock(<FileBlock relPath="files/logo.svg" declared="file" />)
    await waitFor(() => expect(screen.getByTestId('image')).toBeTruthy())
    expect(screen.queryByText(/<circle/)).toBeNull()

    await fireEvent.press(screen.getByLabelText('logo.svg'))
    await waitFor(() => expect(screen.getAllByTestId('image').length).toBeGreaterThan(1))
    expect(screen.getByText('logo.svg')).toBeTruthy()
  })

  it('renders CSV as a table', async () => {
    await renderBlock(<FileBlock relPath="files/data.csv" declared="document" />)
    await waitFor(() => expect(screen.getByText('widget')).toBeTruthy())
    expect(screen.getByText('name')).toBeTruthy()
    expect(screen.getByText('qty')).toBeTruthy()
    expect(screen.getByText(/3 rows/)).toBeTruthy()
  })

  it.each([
    ['files/book.xlsx', 'book.xlsx', 'XLSX'],
    ['files/letter.docx', 'letter.docx', 'DOCX'],
    ['files/archive.zip', 'archive.zip', 'ZIP']
  ])('hands %s to the system viewer through a file card', async (relPath, name, ext) => {
    await renderBlock(<FileBlock relPath={relPath} declared="file" sizeBytes={2048} />)
    await waitFor(() => expect(screen.getByText(name)).toBeTruthy())
    expect(screen.getByText(`${ext} · 2 KB`)).toBeTruthy()

    await fireEvent.press(screen.getByLabelText(name))
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`file:///cache/${relPath}`)
  })
})

describe('FileBlock — degraded states', () => {
  it.each([
    ['files/gone.png', 'image', 'Image file was deleted or unavailable'],
    ['files/gone.mp4', 'video', 'Video file was deleted or unavailable'],
    ['files/gone.mp3', 'audio', 'Audio file was deleted or unavailable'],
    ['files/gone.md', 'file', 'File was deleted'],
    ['files/gone.csv', 'document', 'File was deleted'],
    ['files/gone.html', 'file', 'File was deleted'],
    ['files/gone.pdf', 'document', 'File was deleted'],
    ['files/gone.zip', 'file', 'File was deleted']
  ])('shows the per-type unavailable state for a pruned %s', async (relPath, declared, label) => {
    await renderBlock(<FileBlock relPath={relPath} declared={declared as 'file'} />)
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy())
  })

  it('renders attachments on the user side with the same dispatch', async () => {
    await renderBlock(
      <FileBlock
        relPath="files/data.csv"
        declared="other"
        displayName="quarterly.csv"
        align="end"
      />
    )
    await waitFor(() => expect(screen.getByText('quarterly.csv')).toBeTruthy())
    expect(screen.getByText('widget')).toBeTruthy()
  })
})
