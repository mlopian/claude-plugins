import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, FsEntry, Register, RenderChildren } from 'claude-code'

import type { SessionDiff, SessionGit, SessionPaths, SessionTab } from '../types'
import {
  cacheHitRate,
  diffCounts,
  formatCount,
  formatDuration,
  formatSize,
  formatTime,
  meter,
  parseGitStatus,
  parseTranscript,
  previewLines,
} from './format'
import type { FileVersion, ToolCall } from './format'

const PANE = 'session-panel'
const tab = atom({ plugin: 'session-panel', key: 'tab' } as const, 'usage' as SessionTab)
const dir = atom({ plugin: 'session-panel', key: 'dir' } as const, '')
const tick = atom({ plugin: 'session-panel', key: 'tick' } as const, 0)
const offset = atom({ plugin: 'session-panel', key: 'offset' } as const, 0)
const isErrorsOnly = atom({ plugin: 'session-panel', key: 'isErrorsOnly' } as const, false)
const selectedTool = atom({ plugin: 'session-panel', key: 'selectedTool' } as const, null as string | null)
const listOffset = atom({ plugin: 'session-panel', key: 'listOffset' } as const, 0)
const diff = atom({ plugin: 'session-panel', key: 'diff' } as const, null as SessionDiff | null)
const git = atom({ plugin: 'session-panel', key: 'git' } as const, null as SessionGit | null)
const pathsAtom = atom({ plugin: 'session-panel', key: 'paths' } as const, null as SessionPaths | null)

const TABS: { id: SessionTab; label: string; hotkey: string }[] = [
  { id: 'usage', label: 'Usage', hotkey: 'u' },
  { id: 'tools', label: 'Tool calls', hotkey: 't' },
  { id: 'changes', label: 'Changes', hotkey: 'c' },
  { id: 'activity', label: 'Activity', hotkey: 'a' },
  { id: 'files', label: 'Files', hotkey: 'f' },
  { id: 'stats', label: 'Stats', hotkey: 's' },
  { id: 'help', label: '?', hotkey: 'h' },
]

const LIVE_TABS = new Set<SessionTab>(['usage', 'activity', 'files'])
const LIVE_REFRESH_MS = 2000
const HEADER_ROWS = 3
const CARD_ROWS = 6
const PREVIEW_LINES = CARD_ROWS - 3

const FILE_COLORS: Record<string, Color> = {
  ts: 'ide',
  tsx: 'ide',
  js: 'warning',
  json: 'merged',
  jsonl: 'merged',
  md: 'suggestion',
  sh: 'success',
  py: 'autoAccept',
  html: 'claude',
  css: 'planMode',
}

const GIT_COLORS: Record<string, Color> = {
  M: 'warning',
  A: 'success',
  '??': 'success',
  D: 'error',
  R: 'merged',
}

function toolColor(name: string): Color {
  if (name === 'Bash') return 'bashBorder'
  if (name === 'Edit' || name === 'Write') return 'permission'
  if (name === 'Read') return 'ide'
  if (name.startsWith('mcp__')) return 'merged'

  return 'suggestion'
}

function statusOf(call: ToolCall): { mark: string; color: Color } {
  if (call.isError === null) return { mark: '…', color: 'warning' }

  return call.isError ? { mark: '✗', color: 'error' } : { mark: '✓', color: 'success' }
}

const AGENT_COLORS: Record<string, Color> = {
  running: 'warning',
  pending: 'inactive',
  waiting: 'permission',
  idle: 'suggestion',
  completed: 'success',
  failed: 'error',
  killed: 'error',
}

async function sessionPaths($: EngineInterface): Promise<SessionPaths> {
  const [id, cwd, home, uid] = await Promise.all([
    $.session.id(),
    $.session.cwd(),
    $.env.get('HOME'),
    $.process.run(['id', '-u']),
  ])
  const projectKey = cwd.replace(/[^a-zA-Z0-9]/g, '-')

  return {
    id,
    cwd,
    transcript: `${home}/.claude/projects/${projectKey}/${id}.jsonl`,
    env: `${home}/.claude/session-env/${id}`,
    tmp: `/tmp/claude-${uid.stdout.trim()}/${projectKey}/${id}`,
    fileHistory: `${home}/.claude/file-history/${id}`,
  }
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

async function openInEditor($: EngineInterface, path: string): Promise<void> {
  const editor = (await $.env.get('VISUAL')) ?? (await $.env.get('EDITOR')) ?? 'vi'
  const command = `exec ${editor} ${shellQuote(path)}`
  try {
    const herdrPane = await $.env.get('HERDR_PANE_ID')
    if (herdrPane) {
      const split = await $.process.run(['herdr', 'pane', 'split', '--pane', herdrPane, '--direction', 'right', '--focus'])
      const pane: string = JSON.parse(split.stdout).result.pane.pane_id
      await $.process.run(['herdr', 'pane', 'run', pane, command])
      return
    }
    if (await $.env.get('TMUX')) {
      await $.process.run(['tmux', 'new-window', command])
      return
    }
    await $.ui.copy({ text: path })
    $.ui.toast(`No herdr or tmux, path copied: ${path}`)
  } catch (error) {
    $.ui.toast(`Could not open the editor: ${String(error)}`)
  }
}

async function showDiff($: EngineInterface, paths: SessionPaths, file: string, versions: FileVersion[]): Promise<void> {
  const first = versions.find(version => version.backupFileName)
  const before = first ? `${paths.fileHistory}/${first.backupFileName}` : '/dev/null'
  const after = (await $.fs.exists(file)) ? file : '/dev/null'
  const run = await $.process.run(['diff', '-u', '-L', `before (v${first?.version ?? 0})`, '-L', 'now', before, after])
  await update($, diff, () => ({ path: file, text: run.stdout, against: `first backup (v${first?.version ?? 0})` }))
  await update($, offset, () => 0)
}

async function refreshGit($: EngineInterface): Promise<void> {
  const repo = await $.session.repo()
  if (!repo) {
    await update($, git, () => null)
    return
  }
  const [status, numstat] = await Promise.all([
    $.process.run(['git', 'status', '--porcelain=v1', '--branch', '--untracked-files=all'], { cwd: repo.root }),
    $.process.run(['git', 'diff', '--numstat', 'HEAD'], { cwd: repo.root }),
  ])
  const next = parseGitStatus(repo.root, status.stdout, numstat.stdout)
  const previous = await read($, git)
  if (JSON.stringify(previous) !== JSON.stringify(next)) await update($, git, () => next)
}

async function showGitDiff($: EngineInterface, status: SessionGit, file: SessionGit['files'][number]): Promise<void> {
  const argv =
    file.code === '??'
      ? ['git', 'diff', '--no-index', '--', '/dev/null', file.path]
      : ['git', 'diff', 'HEAD', '--', file.path]
  const run = await $.process.run(argv, { cwd: status.root })
  await update($, diff, () => ({ path: `${status.root}/${file.path}`, text: run.stdout, against: file.code === '??' ? 'untracked, whole file' : 'git HEAD' }))
  await update($, offset, () => 0)
}

async function readOr($: EngineInterface, path: string, fallback: string): Promise<string> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : fallback
}

async function listOr($: EngineInterface, path: string): Promise<FsEntry[]> {
  return (await $.fs.exists(path)) ? $.fs.list(path) : []
}

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) =>
    (a.kind === 'dir') === (b.kind === 'dir') ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  )
}

function loadColor(percent: number): Color {
  if (percent >= 80) return 'error'
  if (percent >= 50) return 'warning'

  return 'success'
}

function fileColor(name: string): Color {
  return FILE_COLORS[name.split('.').pop() ?? ''] ?? 'text'
}

function shortTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function shortPath(path: string, cwd: string): string {
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}

let maxOffset = 0
let isListMode = false

async function refreshLiveTab($: EngineInterface): Promise<void> {
  const [current, panes] = await Promise.all([read($, tab), $.ui.panes()])
  if (!panes.some(pane => pane.id === PANE && pane.isShown)) return
  if (current === 'changes') await refreshGit($)
  else if (LIVE_TABS.has(current)) await update($, tick, n => n + 1)
}

function scrollBy($: EngineInterface, rows: number): Promise<unknown> {
  return update($, offset, current => Math.max(0, Math.min(maxOffset, current + rows)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-panel',
      description: 'Show the current session transcript, changes, activity, stats, environment and scratch directory in a side pane',
    })
    const paths = await sessionPaths($)
    await update($, pathsAtom, () => paths)
    $.clock.every(LIVE_REFRESH_MS, () => void refreshLiveTab($))

    return next(e)
  })

  on('command.run', { command: 'session-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Session', focus: true })
    await $.ui.scroll({ to: 'start', in: PANE })

    return { text: 'Session panel opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await update($, tick, n => n + 1)
    await refreshGit($)

    return result
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!isListMode) return next(e)
    if (e.origin.kind === 'person') await scrollBy($, Math.sign(e.by))

    return next({ ...e, offset: 0 })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const [current, relative, paths, scrolled, errorsOnly, selectedId, savedListOffset, currentDiff, gitStatus] = await Promise.all([
      read($, tab),
      read($, dir),
      read($, pathsAtom),
      read($, offset),
      read($, isErrorsOnly),
      read($, selectedTool),
      read($, listOffset),
      read($, diff),
      read($, git),
      read($, tick),
    ])
    if (!paths) return <Text dimColor>Loading session paths...</Text>

    const columns = e.props.bodyColumns
    const bodyRows = e.props.scroll.bodyRows
    const windowRows = Math.max(CARD_ROWS, bodyRows - HEADER_ROWS)
    const visibleCount = Math.max(1, Math.floor(windowRows / CARD_ROWS))
    const page = Math.max(1, Math.floor(visibleCount / 2))
    isListMode = false

    const section = (title: string, color: Color, children: RenderChildren) => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        <Text bold color={color}>
          {title}
        </Text>
        {children}
      </Box>
    )

    const fact = (label: string, value: string, color: Color = 'text') => (
      <Box flexDirection="row" columnGap={1}>
        <Box width={14} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text color={color} wrap="wrap">
          {value}
        </Text>
      </Box>
    )

    const gauge = (label: string, percent: number, detail: string) => (
      <Box flexDirection="row" columnGap={1}>
        <Box width={14} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text color={loadColor(percent)}>{meter(percent)}</Text>
        <Text bold color={loadColor(percent)}>
          {`${Math.round(percent)}%`}
        </Text>
        <Text dimColor>{detail}</Text>
      </Box>
    )

    const bar = (label: string, value: number, max: number, detail: string, color: Color) => (
      <Box flexDirection="row" columnGap={1}>
        <Box width={14} flexShrink={0}>
          <Text dimColor wrap="truncate-end">
            {label}
          </Text>
        </Box>
        <Text color={color}>{'█'.repeat(Math.max(1, Math.round((value / Math.max(1, max)) * 30)))}</Text>
        <Text dimColor>{detail}</Text>
      </Box>
    )

    const actions = (extra: RenderChildren) => (
      <Box flexDirection="row" columnGap={1} height={1} flexShrink={0} overflow="hidden">
        {extra}
      </Box>
    )

    const tabRow = (
      <Box flexDirection="row" columnGap={1} height={1} flexShrink={0} overflow="hidden">
        {TABS.map(one => (
          <Button
            key={`tab-${one.id}`}
            label={one.label}
            hotkey={one.hotkey}
            variant={one.id === current ? 'primary' : 'secondary'}
            onPress={async () => {
              await update($, tab, () => one.id)
              await update($, offset, () => 0)
              if (one.id === 'changes') await refreshGit($)
            }}
          />
        ))}
      </Box>
    )

    const separator = (label: string) => (
      <Box flexDirection="row" columnGap={1} height={1} flexShrink={0}>
        <Text color="inactive">{'─'.repeat(Math.max(0, columns - label.length - 2))}</Text>
        <Text color="suggestion">{label}</Text>
      </Box>
    )

    const frame = (toolbar: RenderChildren, body: RenderChildren) => (
      <Box flexDirection="column">
        {tabRow}
        {toolbar}
        {separator('')}
        {body}
      </Box>
    )

    if (current === 'help') {
      const shortcut = (keys: string, action: string) => (
        <Box flexDirection="row" columnGap={1}>
          <Box width={14} flexShrink={0}>
            <Text bold color="suggestion">
              {keys}
            </Text>
          </Box>
          <Text>{action}</Text>
        </Box>
      )

      return frame(
        actions(null),
        <Box flexDirection="column" rowGap={1}>
          {section(
            '⌨ Claude Code',
            'claude',
            <Box flexDirection="column">
              {shortcut('ctrl+x tab', 'move the keyboard from the prompt to this panel')}
              {shortcut('esc', 'give the keyboard back to the prompt')}
              {shortcut('ctrl+x x', 'close the panel')}
              {shortcut('tab / arrows', 'walk the buttons while the panel has the keyboard')}
              {shortcut('enter', 'press the focused button')}
              {shortcut('/session-panel', 'open the panel with the keyboard in it')}
            </Box>,
          )}
          {section(
            '▦ Tabs',
            'suggestion',
            <Box flexDirection="column">
              {TABS.map(one => shortcut(one.hotkey, one.id === 'help' ? 'this help' : one.label))}
            </Box>,
          )}
          {section(
            '↕ Everywhere',
            'ide',
            <Box flexDirection="column">
              {shortcut('j / k', 'tool call list: scroll down / up by half a page of cards')}
              {shortcut('mouse wheel', 'scroll, one card at a time in the tool call list')}
              {shortcut('arrows / pgup / pgdn', 'scroll the other tabs and a tool call in full')}
            </Box>,
          )}
          {section(
            '⏺ Tool calls',
            'bashBorder',
            <Box flexDirection="column">
              {shortcut('enter', 'open the focused tool call in full, with syntax colouring')}
              {shortcut('b', 'back from a tool call to the list')}
              {shortcut('e', 'show only failed tool calls, or all of them')}
              {shortcut('r', 'refresh (it also refreshes after every turn)')}
            </Box>,
          )}
          {section(
            '± Changes',
            'permission',
            <Box flexDirection="column">
              {shortcut('enter', 'open a diff: a git file against HEAD, a session file against its first backup')}
              {shortcut('b', 'back from a diff to the list')}
            </Box>,
          )}
          {section(
            '▣ Files',
            'ide',
            <Box flexDirection="column">
              {shortcut('enter', 'open a file in $EDITOR, a PNG in the system viewer, or enter a folder')}
              {shortcut('b', 'go back to the parent folder')}
            </Box>,
          )}
          <Text color="inactive" italic>
            Usage, Activity and Files refresh by themselves every 2 seconds.
          </Text>
        </Box>,
      )
    }

    const transcript = parseTranscript(await readOr($, paths.transcript, ''))
    const { meta } = transcript

    if (current === 'tools') {
      const selected = selectedId ? transcript.toolCalls.find(call => call.id === selectedId) : undefined

      if (selected) {
        const status = statusOf(selected)
        const color = toolColor(selected.name)

        return frame(
          actions(
            <Button
              key="back"
              label="↰ Back"
              hotkey="b"
              onPress={async () => {
                await update($, selectedTool, () => null)
                await update($, offset, () => savedListOffset)
              }}
            />,
          ),
          <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                <Text bold color={color}>{`⏺ ${selected.name}`}</Text>
                <Text bold color={status.color}>{`${status.mark} ${selected.isError === null ? 'running' : selected.isError ? 'failed' : 'ok'}`}</Text>
                <Text color="inactive">{formatDuration(selected.durationMs)}</Text>
              </Box>
              <Text dimColor>{`started ${selected.startedAt ? new Date(selected.startedAt).toLocaleString('en-GB', { hour12: false }) : 'unknown'}`}</Text>
              {selected.summary && <Text color="suggestion">{selected.summary}</Text>}
            </Box>
            {section(
              '▸ Input',
              color,
              <Code source={selected.source || ' '} language={selected.language || undefined} format={selected.format} />,
            )}
            {section(
              selected.isError ? '✗ Result' : '◂ Result',
              selected.isError ? 'error' : 'success',
              selected.result ? <Code source={selected.result} /> : <Text dimColor italic>No result yet.</Text>,
            )}
          </Box>,
        )
      }

      const calls = transcript.toolCalls.filter(call => !errorsOnly || call.isError).reverse()
      const errorCount = transcript.toolCalls.filter(call => call.isError).length
      isListMode = true
      maxOffset = Math.max(0, calls.length - visibleCount)
      const first = Math.min(scrolled, maxOffset)
      const visibleCalls = calls.slice(first, first + visibleCount)
      const position = calls.length === 0 ? '' : `${first + 1}-${first + visibleCalls.length} of ${calls.length}`

      return (
        <Box flexDirection="column" height={bodyRows}>
          {tabRow}
          {actions(
          <>
            <Button key="up" label="▲" hotkey="k" onPress={() => scrollBy($, -page)} />
            <Button key="down" label="▼" hotkey="j" onPress={() => scrollBy($, page)} />
            <Button key="refresh" label="Refresh" hotkey="r" onPress={() => update($, tick, n => n + 1)} />
            <Button
              key="errors-only"
              label={errorsOnly ? 'Show all' : `Errors only (${errorCount})`}
              hotkey="e"
              onPress={async () => {
                await update($, isErrorsOnly, value => !value)
                await update($, offset, () => 0)
              }}
            />
          </>,
          )}
          {separator(position)}
          <Box flexDirection="column" height={windowRows} flexShrink={0} overflow="hidden">
          {calls.length === 0 && <Text dimColor italic>{errorsOnly ? 'No failed tool calls.' : 'No tool calls yet.'}</Text>}
          {visibleCalls.map(call => {
            const color = toolColor(call.name)
            const status = statusOf(call)

            return (
              <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} height={CARD_ROWS} flexShrink={0}>
                <Box flexDirection="row" columnGap={1} height={1} overflow="hidden">
                  <Button
                    key={`tool-${call.id}`}
                    plain
                    label={`⏺ ${call.name}`}
                    onPress={async () => {
                      await update($, listOffset, () => first)
                      await update($, selectedTool, () => call.id)
                      await update($, offset, () => 0)
                    }}
                  />
                  <Box flexShrink={0}>
                    <Text color={status.color}>{status.mark}</Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Text dimColor>{formatTime(call.startedAt)}</Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Text color="inactive">{formatDuration(call.durationMs)}</Text>
                  </Box>
                  <Text color="suggestion" wrap="truncate-end">
                    {call.summary}
                  </Text>
                </Box>
                <Code
                  source={previewLines(call.format === 'diff' ? call.source.split('\n').slice(3).join('\n') : call.source, PREVIEW_LINES).join('\n')}
                  language={call.language || undefined}
                  wrap="truncate-end"
                />
              </Box>
            )
          })}
          </Box>
        </Box>
      )
    }

    if (current === 'changes') {
      const files = Object.entries(transcript.fileVersions).sort(
        ([, a], [, b]) => Date.parse(b.at(-1)?.time ?? '') - Date.parse(a.at(-1)?.time ?? ''),
      )


      if (currentDiff) {
        const counts = diffCounts(currentDiff.text)

        return frame(
          actions(<Button key="back" label="↰ Back" hotkey="b" onPress={() => update($, diff, () => null)} />),
          <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="column" borderStyle="round" borderColor={fileColor(currentDiff.path)} paddingX={1}>
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                <Text bold color={fileColor(currentDiff.path)}>{`± ${shortPath(currentDiff.path, paths.cwd)}`}</Text>
                <Text color="diffAdded">{`+${counts.added}`}</Text>
                <Text color="diffRemoved">{`-${counts.removed}`}</Text>
              </Box>
              <Text dimColor>{`against ${currentDiff.against}`}</Text>
            </Box>
            {section(
              '▸ Diff',
              'diffAdded',
              currentDiff.text ? (
                <Code source={currentDiff.text} format="diff" path={currentDiff.path} />
              ) : (
                <Text dimColor italic>No changes.</Text>
              ),
            )}
          </Box>,
        )
      }

      return frame(
        actions(null),
        <Box flexDirection="column" rowGap={1}>
          {section(
            gitStatus ? `⎇ git: ${gitStatus.branch || 'detached'}` : '⎇ git',
            'ide',
            !gitStatus ? (
              <Text dimColor italic>
                The working directory is not a git repository.
              </Text>
            ) : gitStatus.files.length === 0 ? (
              <Text color="success">Working tree clean.</Text>
            ) : (
              <Box flexDirection="column">
                {gitStatus.files.map(file => (
                  <Box flexDirection="row" columnGap={1}>
                    <Box width={3} flexShrink={0}>
                      <Text bold color={GIT_COLORS[file.code] ?? 'warning'}>
                        {file.code}
                      </Text>
                    </Box>
                    <Button key={`git-${file.path}`} plain label={file.path} onPress={() => showGitDiff($, gitStatus, file)} />
                    {file.added > 0 && <Text color="diffAdded">{`+${file.added}`}</Text>}
                    {file.removed > 0 && <Text color="diffRemoved">{`-${file.removed}`}</Text>}
                  </Box>
                ))}
              </Box>
            ),
          )}
          {section(
            `✎ Files edited in this session (${files.length})`,
            'permission',
            files.length === 0 ? (
              <Text dimColor italic>
                Claude has not edited any files yet.
              </Text>
            ) : (
              <Box flexDirection="column">
                {files.map(([file, versions]) => (
                  <Box flexDirection="column">
                    <Box flexDirection="row" columnGap={1}>
                      <Text color={fileColor(file)}>●</Text>
                      <Button key={`diff-${file}`} plain label={shortPath(file, paths.cwd)} onPress={() => showDiff($, paths, file, versions)} />
                    </Box>
                    <Box flexDirection="row" columnGap={1} paddingLeft={2}>
                      <Text color="suggestion">{`${versions.length} versions`}</Text>
                      <Text dimColor>{`last ${shortTime(Date.parse(versions.at(-1)?.time ?? ''))}`}</Text>
                      <Button key={`edit-${file}`} plain label="edit" onPress={() => openInEditor($, file)} />
                    </Box>
                  </Box>
                ))}
              </Box>
            ),
          )}
          <Text color="inactive" italic>
            Enter shows a diff: git files against HEAD, session files against the first backup Claude took.
          </Text>
        </Box>,
      )
    }

    if (current === 'activity') {
      const [agents, tasks] = await Promise.all([$.agent.list(), listOr($, `${paths.tmp}/tasks`)])
      const taskFiles = tasks.filter(task => task.kind === 'file').sort((a, b) => b.mtimeMs - a.mtimeMs)

      return frame(
        actions(null),
        <Box flexDirection="column" rowGap={1}>
          {section(
            `⚙ Agents (${agents.length})`,
            'autoAccept',
            agents.length === 0 ? (
              <Text dimColor italic>
                No subagents or teammates in this session.
              </Text>
            ) : (
              <Box flexDirection="column">
                {agents.map(agent => (
                  <Box flexDirection="column">
                    <Box flexDirection="row" columnGap={1}>
                      <Text bold color={AGENT_COLORS[agent.status] ?? 'text'}>{`● ${agent.status}`}</Text>
                      <Text color="merged">{agent.type}</Text>
                      {agent.name && <Text color="suggestion">{agent.name}</Text>}
                    </Box>
                    <Box paddingLeft={2}>
                      <Text dimColor wrap="truncate-end">
                        {agent.description}
                      </Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            ),
          )}
          {section(
            `▶ Background task output (${taskFiles.length})`,
            'bashBorder',
            taskFiles.length === 0 ? (
              <Text dimColor italic>
                No background task output yet.
              </Text>
            ) : (
              <Box flexDirection="column">
                {taskFiles.map(task => (
                  <Box flexDirection="row" columnGap={1}>
                    <Text color="bashBorder">▸</Text>
                    <Button key={`task-${task.name}`} plain label={task.name} onPress={() => openInEditor($, `${paths.tmp}/tasks/${task.name}`)} />
                    <Text color="inactive">{formatSize(task.size)}</Text>
                    <Text dimColor>{shortTime(task.mtimeMs)}</Text>
                  </Box>
                ))}
              </Box>
            ),
          )}
        </Box>,
      )
    }

    if (current === 'stats') {
      const turns = transcript.turnSeconds.map((seconds, index) => ({ index: index + 1, seconds })).slice(-15)
      const longestTurn = Math.max(0, ...transcript.turnSeconds)
      const totalSeconds = transcript.turnSeconds.reduce((sum, seconds) => sum + seconds, 0)
      const tools = Object.entries(transcript.toolCounts).sort(([, a], [, b]) => b - a)
      const topTool = tools[0]?.[1] ?? 0
      const heaviest = [...transcript.requests].sort((a, b) => b.output - a.output).slice(0, 5)
      const sum = (pick: (one: (typeof transcript.requests)[number]) => number) => transcript.requests.reduce((total, one) => total + pick(one), 0)
      const hitRate = cacheHitRate(transcript.requests)

      return frame(
        actions(null),
        <Box flexDirection="column" rowGap={1}>
          {section(
            'Σ Totals',
            'claude',
            <Box flexDirection="column">
              {fact('Requests', String(transcript.requests.length), 'suggestion')}
              {fact('Turns', `${transcript.turnSeconds.length}, ${(totalSeconds / 60).toFixed(1)} min of work`, 'suggestion')}
              {fact('Input', formatCount(sum(one => one.input)), 'ide')}
              {fact('Output', formatCount(sum(one => one.output)), 'success')}
              {fact('Cache read', formatCount(sum(one => one.cacheRead)), 'merged')}
              {fact('Cache write', formatCount(sum(one => one.cacheWrite)), 'merged')}
              {gauge('Cache hits', hitRate, 'of input served from cache')}
            </Box>,
          )}
          {section(
            `⏱ Turn durations (last ${turns.length})`,
            'warning',
            <Box flexDirection="column">
              {turns.map(turn =>
                bar(`#${turn.index}`, turn.seconds, longestTurn, `${turn.seconds.toFixed(1)}s`, turn.seconds === longestTurn ? 'error' : 'warning'),
              )}
            </Box>,
          )}
          {section(
            '⚒ Tools used',
            'permission',
            <Box flexDirection="column">
              {tools.map(([name, count]) => bar(name, count, topTool, String(count), name === 'Bash' ? 'bashBorder' : 'permission'))}
            </Box>,
          )}
          {section(
            '⇡ Heaviest requests',
            'success',
            <Box flexDirection="column">
              {heaviest.map(one => (
                <Box flexDirection="row" columnGap={1}>
                  <Text dimColor>{one.time}</Text>
                  <Text color="success">{`out ${formatCount(one.output)}`}</Text>
                  <Text color="merged">{`cache ${formatCount(one.cacheRead)}`}</Text>
                  <Text color="inactive">{one.model}</Text>
                </Box>
              ))}
            </Box>,
          )}
        </Box>,
      )
    }

    if (current === 'usage') {
      const [model, version, turns, repo, usage, envFiles] = await Promise.all([
        $.session.model(),
        $.session.version(),
        $.session.turns(),
        $.session.repo(),
        $.session.usage({ breakdown: 'summary', columns }),
        listOr($, paths.env),
      ])
      const envContents = await Promise.all(
        envFiles
          .filter(entry => entry.kind === 'file')
          .map(async entry => ({ name: entry.name, text: await $.fs.read(`${paths.env}/${entry.name}`) })),
      )
      const { context } = usage
      const breakdown = context.breakdown
      const categories = (breakdown?.categories ?? []).filter(category => category.kind !== 'deferred' && category.tokens > 0)

      return frame(
        actions(null),
        <Box flexDirection="column" rowGap={1}>
          {section(
            '◆ Session',
            'claude',
            <Box flexDirection="column">
              {meta.title && fact('Title', meta.title, 'claude')}
              {fact('ID', paths.id, 'merged')}
              {fact('Model', model, 'claude')}
              {fact('Effort', meta.effort || 'n/a', 'planMode')}
              {fact('Mode', meta.permissionMode || 'n/a', 'autoAccept')}
              {fact('Claude Code', meta.versions.length > 1 ? meta.versions.join(' → ') : version.version)}
              {fact('Started', shortTime(usage.startedAt))}
              {fact('Turns', String(turns), 'suggestion')}
              {fact('Cost', usage.cost ? `$${usage.cost.usd.toFixed(2)}` : 'n/a', 'success')}
              {fact('Working dir', paths.cwd, 'ide')}
              {fact('Repository', repo ? `${repo.name ?? repo.root}${repo.remote ? ` (${repo.remote})` : ''}` : 'none', 'ide')}
              {meta.branch && fact('Branch', meta.branch, 'ide')}
            </Box>,
          )}
          {usage.rateLimits.length > 0 &&
            section(
              '◔ Rate limits',
              'error',
              <Box flexDirection="column">
                {usage.rateLimits.map(limit =>
                  gauge(limit.kind, limit.percentUsed, limit.resetsAt ? `resets ${shortTime(Date.parse(limit.resetsAt))}` : ''),
                )}
              </Box>,
            )}
          {section(
            '▤ Context',
            'warning',
            <Box flexDirection="column">
              {context.percent === undefined
                ? fact('Context', 'not measured yet')
                : gauge('Context', context.percent, `${formatCount(context.tokens ?? 0)} / ${formatCount(context.window)}`)}
              {breakdown?.isAutoCompactEnabled && breakdown.autoCompactThreshold !== undefined && (
                <Box>
                  {fact(
                    'Auto-compact',
                    `at ${formatCount(breakdown.autoCompactThreshold)}, ${formatCount(Math.max(0, breakdown.autoCompactThreshold - breakdown.totalTokens))} tokens left`,
                    'warning',
                  )}
                </Box>
              )}
              {breakdown && (
                <Box flexDirection="column" marginTop={1}>
                  {breakdown.gridRows.map(row => (
                    <Text>
                      {row.map(square => (
                        <Text color={square.color}>{square.isFilled ? '■ ' : '□ '}</Text>
                      ))}
                    </Text>
                  ))}
                </Box>
              )}
              {categories.map(category => (
                <Box flexDirection="row" columnGap={1}>
                  <Text color={category.color}>■</Text>
                  <Box width={22} flexShrink={0}>
                    <Text wrap="truncate-end">{category.name}</Text>
                  </Box>
                  <Text color={category.color}>{formatCount(category.tokens)}</Text>
                  <Text dimColor>{`${((category.tokens / Math.max(1, breakdown?.maxTokens ?? 1)) * 100).toFixed(1)}%`}</Text>
                </Box>
              ))}
              {breakdown && breakdown.memoryFiles.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold color="suggestion">
                    Memory files
                  </Text>
                  {breakdown.memoryFiles.map(file => (
                    <Box flexDirection="row" columnGap={1}>
                      <Text color="merged">{formatCount(file.tokens)}</Text>
                      <Text dimColor wrap="truncate-start">
                        {file.path}
                      </Text>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>,
          )}
          {section(
            '⌂ Paths',
            'suggestion',
            <Box flexDirection="column">
              {fact('Transcript', paths.transcript, 'merged')}
              {fact('session-env', paths.env, 'merged')}
              {fact('File history', paths.fileHistory, 'merged')}
              {fact('Scratch dir', paths.tmp, 'merged')}
              <Box flexDirection="row" columnGap={1} marginTop={1}>
                <Button key="env-open-transcript" label="Edit transcript" onPress={() => openInEditor($, paths.transcript)} />
                <Button key="env-open-scratch" label="Browse scratch dir" onPress={() => update($, tab, () => 'files' as const)} />
              </Box>
            </Box>,
          )}
          {section(
            '$ session-env',
            'success',
            envContents.length === 0 ? (
              <Text dimColor italic>
                Empty, the session has not exported any variables yet.
              </Text>
            ) : (
              <Box flexDirection="column">
                {envContents.map(file => (
                  <Box flexDirection="column">
                    <Text color="success">{file.name}</Text>
                    <Code source={file.text} language="sh" />
                  </Box>
                ))}
              </Box>
            ),
          )}
        </Box>,
      )
    }

    const here = relative ? `${paths.tmp}/${relative}` : paths.tmp
    const entries = sortEntries(await listOr($, here))
    const crumbs = ['scratchpad root', ...(relative ? relative.split('/') : [])]

    return frame(
      actions(
        relative && (
          <Button key="parent" label="↰ Up" hotkey="b" onPress={() => update($, dir, d => d.split('/').slice(0, -1).join('/'))} />
        ),
      ),
      <Box flexDirection="column" rowGap={1}>
        {section(
          '▣ Scratch directory',
          'ide',
          <Box flexDirection="column">
            <Text color="inactive" wrap="truncate-start">
              {paths.tmp}
            </Text>
            <Text>
              {crumbs.map((crumb, index) => (
                <Text color={index === crumbs.length - 1 ? 'suggestion' : 'inactive'} bold={index === crumbs.length - 1}>
                  {index === 0 ? crumb : ` › ${crumb}`}
                </Text>
              ))}
            </Text>
          </Box>,
        )}
        <Box flexDirection="column">
          {entries.length === 0 && (
            <Text dimColor italic>
              Empty directory.
            </Text>
          )}
          {entries.map(entry =>
            entry.kind === 'dir' ? (
              <Box flexDirection="row" columnGap={1}>
                <Text color="suggestion">▸</Text>
                <Button
                  key={`dir-${entry.name}`}
                  plain
                  label={`${entry.name}/`}
                  onPress={async () => {
                    await update($, dir, d => (d ? `${d}/${entry.name}` : entry.name))
                    await update($, offset, () => 0)
                  }}
                />
              </Box>
            ) : (
              <Box flexDirection="row" columnGap={1}>
                <Text color={fileColor(entry.name)}>●</Text>
                <Button
                  key={`file-${entry.name}`}
                  plain
                  label={entry.name}
                  onPress={async () => {
                    const path = `${here}/${entry.name}`
                    if (entry.name.toLowerCase().endsWith('.png')) await $.process.run(['open', path])
                    else await openInEditor($, path)
                  }}
                />
                <Text color="inactive">{formatSize(entry.size)}</Text>
                <Text dimColor>{shortTime(entry.mtimeMs)}</Text>
              </Box>
            ),
          )}
        </Box>
        <Text color="inactive" italic>
          Enter opens a file in $EDITOR in a new herdr pane, a PNG in the system viewer.
        </Text>
      </Box>,
    )
  })
}
