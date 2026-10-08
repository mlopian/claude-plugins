type Block = {
  type: string
  name?: string
  id?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

type Backup = { backupFileName: string | null; version: number; backupTime: string }

type Row = {
  type: string
  subtype?: string
  timestamp?: string
  requestId?: string
  durationMs?: number
  gitBranch?: string
  effort?: string
  version?: string
  aiTitle?: string
  permissionMode?: string
  snapshot?: { trackedFileBackups?: Record<string, Backup> }
  trackingPath?: string
  backup?: Backup
  message?: { model?: string; content?: string | Block[]; usage?: Usage }
}

export type ToolCall = {
  id: string
  name: string
  startedAt: string
  durationMs: number | null
  summary: string
  source: string
  language: string
  format: 'source' | 'diff'
  result: string
  isError: boolean | null
}

export type RequestStats = { time: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number }

export type FileVersion = { backupFileName: string | null; version: number; time: string }

export type SessionMeta = {
  title: string
  branch: string
  permissionMode: string
  effort: string
  versions: string[]
}

export type Transcript = {
  rows: number
  prompts: number
  outputTokens: number
  meta: SessionMeta
  toolCalls: ToolCall[]
  turnSeconds: number[]
  requests: RequestStats[]
  toolCounts: Record<string, number>
  fileVersions: Record<string, FileVersion[]>
}

const MAX_TEXT = 20_000

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  sh: 'sh',
  java: 'java',
  kt: 'kotlin',
  vue: 'vue',
  css: 'css',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
}

export function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n... (+${text.length - max} chars)` : text
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleTimeString('en-GB', { hour12: false }) : ''
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'running'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`

  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`
}

export function formatCount(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

export function meter(percent: number, width = 20): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function previewLines(text: string, count: number): string[] {
  const lines = text.split('\n').filter(line => line.trim() !== '')

  return Array.from({ length: count }, (_, index) => lines[index] ?? '')
}

export function languageOf(path: string): string {
  return LANGUAGES[path.split('.').pop()?.toLowerCase() ?? ''] ?? ''
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'object' && part && 'text' in part ? String(part.text) : '')).join('\n')
  }

  return content === undefined ? '' : JSON.stringify(content)
}

function editDiff(path: string, before: string, after: string): string {
  const removed = before.split('\n').map(line => `-${line}`)
  const added = after.split('\n').map(line => `+${line}`)

  return [`--- ${path}`, `+++ ${path}`, `@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added].join('\n')
}

export function describeTool(name: string, input: Record<string, unknown>): Pick<ToolCall, 'summary' | 'source' | 'language' | 'format'> {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  const path = text('file_path')

  if (name === 'Bash') return { summary: text('description'), source: clip(text('command')), language: 'sh', format: 'source' }
  if (name === 'Edit' && path) {
    return { summary: path, source: clip(editDiff(path, text('old_string'), text('new_string'))), language: languageOf(path), format: 'diff' }
  }
  if (name === 'Write' && path) return { summary: path, source: clip(text('content')), language: languageOf(path), format: 'source' }
  if (name === 'Read' && path) return { summary: path, source: path, language: '', format: 'source' }

  return { summary: '', source: clip(JSON.stringify(input, null, 2)), language: 'json', format: 'source' }
}

function addFileVersion(versions: Record<string, FileVersion[]>, path: string, backup: Backup) {
  const list = (versions[path] ??= [])
  if (list.some(one => one.version === backup.version)) return
  list.push({ backupFileName: backup.backupFileName, version: backup.version, time: backup.backupTime })
  list.sort((a, b) => a.version - b.version)
}

export function parseTranscript(jsonl: string): Transcript {
  const rows: Row[] = jsonl
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as Row]
      } catch {
        return []
      }
    })

  const seenRequests = new Set<string>()
  const meta: SessionMeta = { title: '', branch: '', permissionMode: '', effort: '', versions: [] }
  const toolCalls = new Map<string, ToolCall>()
  const turnSeconds: number[] = []
  const requests: RequestStats[] = []
  const toolCounts: Record<string, number> = {}
  const fileVersions: Record<string, FileVersion[]> = {}
  let prompts = 0
  let outputTokens = 0

  for (const row of rows) {
    const content = row.message?.content
    if (row.aiTitle) meta.title = row.aiTitle
    if (row.permissionMode) meta.permissionMode = row.permissionMode
    if (row.gitBranch) meta.branch = row.gitBranch
    if (row.effort) meta.effort = row.effort
    if (row.version && meta.versions.at(-1) !== row.version) meta.versions.push(row.version)

    if (row.type === 'file-history-snapshot') {
      for (const [path, backup] of Object.entries(row.snapshot?.trackedFileBackups ?? {})) addFileVersion(fileVersions, path, backup)
    } else if (row.type === 'file-history-delta' && row.trackingPath && row.backup) {
      addFileVersion(fileVersions, row.trackingPath, row.backup)
    } else if (row.type === 'user' && typeof content === 'string') {
      prompts++
    } else if (row.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        const call = block.type === 'tool_result' ? toolCalls.get(block.tool_use_id ?? '') : undefined
        if (!call) continue
        call.result = clip(textOf(block.content))
        call.isError = block.is_error === true
        call.durationMs = row.timestamp && call.startedAt ? Math.max(0, Date.parse(row.timestamp) - Date.parse(call.startedAt)) : null
      }
    } else if (row.type === 'assistant' && Array.isArray(content)) {
      if (!row.requestId || !seenRequests.has(row.requestId)) {
        if (row.requestId) seenRequests.add(row.requestId)
        const usage = row.message?.usage
        outputTokens += usage?.output_tokens ?? 0
        requests.push({
          time: formatTime(row.timestamp),
          model: row.message?.model ?? '',
          input: usage?.input_tokens ?? 0,
          output: usage?.output_tokens ?? 0,
          cacheRead: usage?.cache_read_input_tokens ?? 0,
          cacheWrite: usage?.cache_creation_input_tokens ?? 0,
        })
      }
      for (const block of content) {
        if (block.type !== 'tool_use' || !block.id) continue
        const name = block.name ?? 'tool'
        toolCounts[name] = (toolCounts[name] ?? 0) + 1
        toolCalls.set(block.id, {
          id: block.id,
          name,
          startedAt: row.timestamp ?? '',
          durationMs: null,
          result: '',
          isError: null,
          ...describeTool(name, block.input ?? {}),
        })
      }
    } else if (row.type === 'system' && row.subtype === 'turn_duration' && row.durationMs !== undefined) {
      turnSeconds.push(row.durationMs / 1000)
    }
  }

  return {
    rows: rows.length,
    prompts,
    outputTokens,
    meta,
    toolCalls: [...toolCalls.values()],
    turnSeconds,
    requests,
    toolCounts,
    fileVersions,
  }
}

export function cacheHitRate(requests: RequestStats[]): number {
  const read = requests.reduce((sum, one) => sum + one.cacheRead, 0)
  const total = requests.reduce((sum, one) => sum + one.input + one.cacheRead + one.cacheWrite, 0)

  return total === 0 ? 0 : (read / total) * 100
}

export type GitFile = { code: string; path: string; added: number; removed: number }

export type GitStatus = { root: string; branch: string; files: GitFile[] }

export function parseGitStatus(root: string, porcelain: string, numstat: string): GitStatus {
  const counts = new Map<string, { added: number; removed: number }>()
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added = '0', removed = '0', path = ''] = line.split('\t')
    counts.set(path, { added: Number(added) || 0, removed: Number(removed) || 0 })
  }
  const lines = porcelain.split('\n').filter(Boolean)
  const branch = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
  const files = lines.map(line => {
    const code = line.slice(0, 2).trim() || '?'
    const path = line.slice(3).split(' -> ').pop() ?? ''

    return { code, path, ...(counts.get(path) ?? { added: 0, removed: 0 }) }
  })

  return { root, branch, files }
}

export function diffCounts(diff: string): { added: number; removed: number } {
  const lines = diff.split('\n').filter(line => !line.startsWith('+++') && !line.startsWith('---'))

  return {
    added: lines.filter(line => line.startsWith('+')).length,
    removed: lines.filter(line => line.startsWith('-')).length,
  }
}
