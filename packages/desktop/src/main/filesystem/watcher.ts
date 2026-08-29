import path from 'path'
import fsPromises from 'fs/promises'
import { createHash } from 'crypto'
import log from 'electron-log'
import chokidar, { type FSWatcher } from 'chokidar'
import { exists } from 'common/filesystem'
import { hasMarkdownExtension, checkPathExcludePattern } from 'common/filesystem/paths'
import { getUniqueId } from '../utils'
import { loadMarkdownFile } from '../filesystem/markdown'
import { isLinux, isOsx, isWindows } from '../config'
import type { BrowserWindow } from 'electron'
import type { LineEnding } from '@shared/types/files'

// TODO(refactor): Please see GH#1035.

export const WATCHER_STABILITY_THRESHOLD = 1000
export const WATCHER_STABILITY_POLL_INTERVAL = 150
const SELF_SAVE_VALIDITY_MS = 10000

const EVENT_NAME = {
  dir: 'mt::update-object-tree' as const,
  file: 'mt::update-file' as const
}

type WatchType = 'dir' | 'file'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Preferences = any

interface SelfSaveEntry {
  windowId: number
  pathname: string
  fingerprint: string
  expiresAt: number
}

interface WatcherEntry {
  win: BrowserWindow
  watcher: FSWatcher
  pathname: string
  type: WatchType
  close: () => void
}

const normalizeWatchPath = (pathname: string): string => {
  const resolvedPath = path.resolve(pathname)
  return isWindows ? resolvedPath.toLowerCase() : resolvedPath
}

const fingerprintMarkdown = (markdown: string): string =>
  createHash('sha256').update(markdown, 'utf8').digest('hex')

const add = async(
  win: BrowserWindow,
  pathname: string,
  type: WatchType,
  endOfLine: LineEnding,
  autoGuessEncoding: boolean,
  trimTrailingNewline: number,
  autoNormalizeLineEndings: boolean
): Promise<void> => {
  const stats = await fsPromises.stat(pathname)
  const birthTime = stats.birthtime
  const mtimeMs = stats.mtimeMs
  const isMarkdown = hasMarkdownExtension(pathname)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file: any = {
    pathname,
    name: path.basename(pathname),
    isFile: true,
    isDirectory: false,
    birthTime,
    mtimeMs,
    isMarkdown
  }
  if (isMarkdown) {
    // HACK: But this should be removed completely in #1034/#1035.
    try {
      const data = await loadMarkdownFile(
        pathname,
        endOfLine,
        autoGuessEncoding,
        trimTrailingNewline,
        autoNormalizeLineEndings
      )
      file.data = data
    } catch (err) {
      // Only notify user about opened files.
      if (type === 'file') {
        win.webContents.send('mt::show-notification', {
          title: 'Watcher I/O error',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
        return
      }
    }
    win.webContents.send(EVENT_NAME[type], {
      type: 'add',
      change: file
    })
  }
}

const unlink = (win: BrowserWindow, pathname: string, type: WatchType): void => {
  const file = { pathname }
  win.webContents.send(EVENT_NAME[type], {
    type: 'unlink',
    change: file
  })
}

const change = async(
  win: BrowserWindow,
  pathname: string,
  type: WatchType,
  endOfLine: LineEnding,
  autoGuessEncoding: boolean,
  trimTrailingNewline: number,
  autoNormalizeLineEndings: boolean,
  shouldIgnoreMarkdown?: (markdown: string) => boolean
): Promise<void> => {
  if (type === 'dir') {
    // Only send mtimeMs so the sidebar can re-sort; skip loading file content.
    try {
      const stats = await fsPromises.stat(pathname)
      win.webContents.send('mt::update-object-tree', {
        type: 'change',
        change: { pathname, mtimeMs: stats.mtimeMs }
      })
    } catch {
      // File may have been deleted between the event and the stat; ignore.
    }
    return
  }

  const isMarkdown = hasMarkdownExtension(pathname)
  if (isMarkdown) {
    try {
      const [data, stats] = await Promise.all([
        loadMarkdownFile(pathname, endOfLine, autoGuessEncoding, trimTrailingNewline, autoNormalizeLineEndings),
        fsPromises.stat(pathname)
      ])
      if (shouldIgnoreMarkdown?.(data.markdown)) {
        return
      }
      const file = { pathname, data, mtimeMs: stats.mtimeMs }
      win.webContents.send('mt::update-file', {
        type: 'change',
        change: file
      })
    } catch (err) {
      if (type === 'file') {
        win.webContents.send('mt::show-notification', {
          title: 'Watcher I/O error',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }
}

const addDir = (win: BrowserWindow, pathname: string, type: WatchType): void => {
  if (type === 'file') return

  const directory = {
    pathname,
    name: path.basename(pathname),
    isCollapsed: true,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }

  win.webContents.send('mt::update-object-tree', {
    type: 'addDir',
    change: directory
  })
}

const unlinkDir = (win: BrowserWindow, pathname: string, type: WatchType): void => {
  if (type === 'file') return

  const directory = { pathname }
  win.webContents.send('mt::update-object-tree', {
    type: 'unlinkDir',
    change: directory
  })
}

class Watcher {
  private _preferences: Preferences
  private _selfSaveEntries: SelfSaveEntry[]
  watchers: Record<string, WatcherEntry>

  constructor(preferences: Preferences) {
    this._preferences = preferences
    this._selfSaveEntries = []
    this.watchers = {}
  }

  watch(win: BrowserWindow, watchPath: string, type: WatchType = 'dir'): () => void {
    const usePolling = isOsx ? true : this._preferences.getItem('watcherUsePolling')

    const id = getUniqueId()

    const watcher = chokidar.watch(watchPath, {
      ignored: (pathname: string, fileInfo?: { isDirectory: () => boolean }) => {
        if (!fileInfo) {
          return /(?:^|[/\\])(?:node_modules|(?:.+\.asar))/.test(pathname)
        }

        if (/(?:^|[/\\])(?:node_modules|(?:.+\.asar))/.test(pathname)) {
          return true
        }

        if (
          checkPathExcludePattern(pathname, this._preferences.getItem('treePathExcludePatterns'))
        ) {
          return true
        }
        if (fileInfo.isDirectory()) {
          return false
        }
        return !hasMarkdownExtension(pathname)
      },
      ignoreInitial: type === 'file',
      persistent: true,
      ignorePermissionErrors: true,

      depth: type === 'file' ? (isOsx ? 1 : 0) : undefined,

      // Please see GH#1043
      awaitWriteFinish: {
        stabilityThreshold: WATCHER_STABILITY_THRESHOLD,
        pollInterval: WATCHER_STABILITY_POLL_INTERVAL
      },

      usePolling
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chokidar's `ignored` callback signature varies between versions; this options bag works at runtime but defies the bundled type
    } as any)

    let disposed = false
    let enospcReached = false
    let renameTimer: NodeJS.Timeout | null = null

    watcher
      .on('add', async(pathname: string) => {
        const { _preferences } = this
        const eol = _preferences.getPreferredEol() as LineEnding
        const { autoGuessEncoding, trimTrailingNewline, autoNormalizeLineEndings } =
          _preferences.getAll()
        add(
          win,
          pathname,
          type,
          eol,
          autoGuessEncoding,
          trimTrailingNewline,
          autoNormalizeLineEndings
        )
      })
      .on('change', async(pathname: string) => {
        const { _preferences } = this
        const eol = _preferences.getPreferredEol() as LineEnding
        const { autoGuessEncoding, trimTrailingNewline, autoNormalizeLineEndings } =
          _preferences.getAll()
        change(
          win,
          pathname,
          type,
          eol,
          autoGuessEncoding,
          trimTrailingNewline,
          autoNormalizeLineEndings,
          type === 'file'
            ? (markdown) => this._shouldIgnoreSavedContent(win.id, pathname, markdown)
            : undefined
        )
      })
      .on('unlink', (pathname: string) => unlink(win, pathname, type))
      .on('addDir', (pathname: string) => addDir(win, pathname, type))
      .on('unlinkDir', (pathname: string) => unlinkDir(win, pathname, type))
      .on('raw', (event: string, subpath: string, details: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((globalThis as any).MARKTEXT_DEBUG_VERBOSE >= 3) {
          console.log('watcher: ', event, subpath, details)
        }

        // Fix atomic rename on Linux (chokidar#591).
        if (isLinux && type === 'file' && event === 'rename') {
          if (renameTimer) {
            clearTimeout(renameTimer)
          }
          renameTimer = setTimeout(async() => {
            renameTimer = null
            if (disposed) {
              return
            }

            const fileExists = await exists(watchPath)
            if (fileExists) {
              watcher.unwatch(watchPath)
              watcher.add(watchPath)
            }
          }, 150)
        }
      })
      .on('error', (error: unknown) => {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code === 'ENOSPC') {
          if (!enospcReached) {
            enospcReached = true
            log.warn('inotify limit reached: Too many file descriptors are opened.')

            win.webContents.send('mt::show-notification', {
              title: 'inotify limit reached',
              type: 'warning',
              message:
                'Cannot watch all files and file changes because too many file descriptors are opened.'
            })
          }
        } else {
          log.error('Error while watching files:', error)
        }
      })

    const closeFn = (): void => {
      disposed = true
      if (this.watchers[id]) {
        delete this.watchers[id]
      }
      if (renameTimer) {
        clearTimeout(renameTimer)
        renameTimer = null
      }
      watcher.close()
    }

    this.watchers[id] = {
      win,
      watcher,
      pathname: watchPath,
      type,
      close: closeFn
    }

    return closeFn
  }

  unwatch(win: BrowserWindow, watchPath: string, type: WatchType = 'dir'): void {
    for (const id of Object.keys(this.watchers)) {
      const w = this.watchers[id]
      if (w.win === win && w.pathname === watchPath && w.type === type) {
        w.watcher.close()
        delete this.watchers[id]
        break
      }
    }
  }

  unwatchByWindowId(windowId: number): void {
    const watchers: FSWatcher[] = []
    const watchIds: string[] = []
    for (const id of Object.keys(this.watchers)) {
      const w = this.watchers[id]
      if (w.win.id === windowId) {
        watchers.push(w.watcher)
        watchIds.push(id)
      }
    }
    if (watchers.length) {
      watchIds.forEach((id) => delete this.watchers[id])
      watchers.forEach((watcher) => watcher.close())
    }
    this._selfSaveEntries = this._selfSaveEntries.filter((entry) => entry.windowId !== windowId)
  }

  close(): void {
    Object.keys(this.watchers).forEach((id) => this.watchers[id].close())
    this.watchers = {}
    this._selfSaveEntries = []
  }

  rememberSelfSave(
    windowId: number,
    pathname: string,
    markdown: string,
    duration: number = SELF_SAVE_VALIDITY_MS
  ): void {
    const normalizedPathname = normalizeWatchPath(pathname)
    const fingerprint = fingerprintMarkdown(markdown)
    const now = Date.now()
    this._selfSaveEntries = this._selfSaveEntries.filter(
      (entry) =>
        entry.expiresAt > now &&
        !(entry.windowId === windowId && entry.pathname === normalizedPathname)
    )
    this._selfSaveEntries.push({
      windowId,
      pathname: normalizedPathname,
      fingerprint,
      expiresAt: now + duration
    })
  }

  cancelSelfSave(windowId: number, pathname: string, markdown: string): void {
    const normalizedPathname = normalizeWatchPath(pathname)
    const fingerprint = fingerprintMarkdown(markdown)
    this._selfSaveEntries = this._selfSaveEntries.filter(
      (entry) =>
        !(
          entry.windowId === windowId &&
          entry.pathname === normalizedPathname &&
          entry.fingerprint === fingerprint
        )
    )
  }

  private _shouldIgnoreSavedContent(winId: number, pathname: string, markdown: string): boolean {
    const normalizedPathname = normalizeWatchPath(pathname)
    const now = Date.now()
    this._selfSaveEntries = this._selfSaveEntries.filter((entry) => entry.expiresAt > now)

    const index = this._selfSaveEntries.findIndex(
      (entry) => entry.windowId === winId && entry.pathname === normalizedPathname
    )
    if (index === -1) {
      return false
    }

    const entry = this._selfSaveEntries[index]
    if (entry.fingerprint === fingerprintMarkdown(markdown)) {
      // Cloud drives can emit multiple events for the same physical save. Keep
      // the entry until it expires so all events that still represent exactly
      // what MarkText wrote are ignored.
      return true
    }

    // The file now contains different content, so this is a genuine external
    // modification and the self-save marker must no longer suppress events.
    this._selfSaveEntries.splice(index, 1)
    return false
  }
}

export default Watcher
