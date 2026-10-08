import { expect, test } from 'claude-code/testing'

import { cacheHitRate, describeTool, diffCounts, formatDuration, meter, parseGitStatus, parseTranscript, previewLines } from './format'

const rows = [
  { type: 'ai-title', aiTitle: 'Session panel' },
  { type: 'permission-mode', permissionMode: 'auto' },
  { type: 'user', timestamp: '2026-10-08T19:46:00.000Z', message: { content: 'where is the session data?' } },
  {
    type: 'assistant',
    requestId: 'r1',
    timestamp: '2026-10-08T19:46:01.000Z',
    gitBranch: 'main',
    effort: 'medium',
    version: '2.1.294',
    message: {
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 1285, cache_read_input_tokens: 30 },
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls\npwd', description: 'List files' } }],
    },
  },
  {
    type: 'user',
    timestamp: '2026-10-08T19:46:03.500Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt', is_error: true }] },
  },
  {
    type: 'assistant',
    requestId: 'r2',
    timestamp: '2026-10-08T19:46:05.000Z',
    version: '2.1.295',
    message: {
      usage: { input_tokens: 10, cache_creation_input_tokens: 50 },
      content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/a.ts' } }],
    },
  },
  { type: 'system', subtype: 'turn_duration', durationMs: 4083 },
  {
    type: 'file-history-snapshot',
    snapshot: { trackedFileBackups: { '/repo/a.ts': { backupFileName: 'h@v2', version: 2, backupTime: '2026-10-08T20:00:00Z' } } },
  },
  {
    type: 'file-history-delta',
    trackingPath: '/repo/a.ts',
    backup: { backupFileName: 'h@v1', version: 1, backupTime: '2026-10-08T19:00:00Z' },
  },
  'not json',
]
  .map(row => (typeof row === 'string' ? row : JSON.stringify(row)))
  .join('\n')

test('collects tool calls with their timing, status and result', async () => {
  const [bash, read] = parseTranscript(rows).toolCalls
  expect(bash).toMatchObject({
    id: 't1',
    name: 'Bash',
    startedAt: '2026-10-08T19:46:01.000Z',
    durationMs: 2500,
    summary: 'List files',
    source: 'ls\npwd',
    language: 'sh',
    result: 'a.txt',
    isError: true,
  })
  expect(read).toMatchObject({ name: 'Read', summary: '/repo/a.ts', durationMs: null, isError: null })
})

test('collects session metadata, request usage and file versions', async () => {
  const transcript = parseTranscript(rows)
  expect(transcript.prompts).toBe(1)
  expect(transcript.outputTokens).toBe(1285)
  expect(transcript.turnSeconds).toEqual([4.083])
  expect(transcript.toolCounts).toEqual({ Bash: 1, Read: 1 })
  expect(transcript.meta).toEqual({
    title: 'Session panel',
    branch: 'main',
    permissionMode: 'auto',
    effort: 'medium',
    versions: ['2.1.294', '2.1.295'],
  })
  expect(transcript.fileVersions['/repo/a.ts']?.map(one => one.backupFileName)).toEqual(['h@v1', 'h@v2'])
  expect(cacheHitRate(transcript.requests)).toBe(30)
})

test('describeTool turns an Edit into a diff in the file language', async () => {
  const edit = describeTool('Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  expect(edit).toEqual({
    summary: '/repo/a.ts',
    source: '--- /repo/a.ts\n+++ /repo/a.ts\n@@ -1,1 +1,1 @@\n-a\n+b',
    language: 'typescript',
    format: 'diff',
  })
  expect(describeTool('Grep', { pattern: 'x' }).language).toBe('json')
})

test('previewLines skips blank lines and pads to a fixed height', async () => {
  expect(previewLines('a\n\nb\nc\nd', 3)).toEqual(['a', 'b', 'c'])
  expect(previewLines('a', 3)).toEqual(['a', '', ''])
})

test('formatDuration reads as ms, seconds or minutes', async () => {
  expect(formatDuration(null)).toBe('running')
  expect(formatDuration(450)).toBe('450 ms')
  expect(formatDuration(2500)).toBe('2.5 s')
  expect(formatDuration(125_000)).toBe('2 m 5 s')
})

test('meter fills proportionally and clamps', async () => {
  expect(meter(50, 4)).toBe('██░░')
  expect(meter(150, 4)).toBe('████')
})

test('parseGitStatus reads the branch, codes, renames and line counts', async () => {
  const porcelain = '## main...origin/main [ahead 1]\n M src/a.ts\n?? notes.md\nR  old.ts -> new.ts\n'
  const numstat = '3\t1\tsrc/a.ts\n0\t0\tnew.ts\n'
  expect(parseGitStatus('/repo', porcelain, numstat)).toEqual({
    root: '/repo',
    branch: 'main...origin/main [ahead 1]',
    files: [
      { code: 'M', path: 'src/a.ts', added: 3, removed: 1 },
      { code: '??', path: 'notes.md', added: 0, removed: 0 },
      { code: 'R', path: 'new.ts', added: 0, removed: 0 },
    ],
  })
})

test('diffCounts counts added and removed lines, not file headers', async () => {
  expect(diffCounts('--- a\n+++ b\n@@ -1,2 +1,2 @@\n-x\n+y\n+z\n same')).toEqual({ added: 2, removed: 1 })
})
