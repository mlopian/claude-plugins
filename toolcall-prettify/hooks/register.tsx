import type { Color, EngineInterface, Register, RenderChildren, RenderElement } from 'claude-code'

import { clip, outputLanguage } from './format'

type BashInput = { command?: string; description?: string }
type BashOutput = { stdout?: string; stderr?: string; interrupted?: boolean }
type ReadInput = { file_path?: string; offset?: number; limit?: number }
type ReadOutput = { file?: { filePath: string; content: string; startLine: number; totalLines: number } }
type EditInput = { file_path?: string; replace_all?: boolean }
type Elements = ReturnType<EngineInterface['ui']['resolve']>
type Call = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean }

const TINT = '#1c1c22'
const TOOLS = new Set(['Bash', 'Read', 'Edit'])

function readRange(input: ReadInput): string {
  if (!input.offset && !input.limit) return ''
  const from = input.offset ?? 1

  return input.limit ? `:${from}-${from + input.limit - 1}` : `:${from}-`
}

function drawCall({ Box, Text, Code }: Elements, call: Call, width: number | undefined): RenderElement {
  const status: Color | undefined = call.isErrored ? 'error' : call.isRunning ? 'warning' : undefined
  const card = (color: Color, icon: string, title: string, detail: string, body?: RenderChildren) => (
    <Box flexDirection="column" width={width} backgroundColor="#000000" paddingX={1}>
      <Box flexDirection="row" columnGap={1} marginBottom={body ? 1 : 0}>
        <Text bold color={status ?? color}>
          {icon}
        </Text>
        <Text bold>{title}</Text>
        <Text dimColor>{detail}</Text>
      </Box>
      {body}
    </Box>
  )

  if (call.tool === 'Read') {
    const input = call.input as ReadInput
    return card('ide', '▤', 'Read', `${input.file_path ?? ''}${readRange(input)}`)
  }
  if (call.tool === 'Edit') {
    const input = call.input as EditInput
    return card('permission', '✎', 'Edit', `${input.file_path ?? ''}${input.replace_all ? ' (all)' : ''}`)
  }
  const input = call.input as BashInput

  return card('bashBorder', call.isRunning ? '◌' : '❯', '$', input.description ?? '', <Code source={input.command ?? ''} language="bash" />)
}

function drawOutput({ Box, Text, Code }: Elements, tool: string, output: unknown, command: string, width: number | undefined): RenderElement | null {
  const panel = (label: string, body: RenderChildren) => (
    <Box flexDirection="column" width={width && width - 2} backgroundColor={TINT} paddingX={1} marginLeft={2} marginTop={1}>
      <Box marginBottom={1}>
        <Text dimColor>{label}</Text>
      </Box>
      {body}
    </Box>
  )
  const more = (hidden: number, what: string) => (hidden > 0 ? <Text dimColor>{`… +${hidden} ${what}`}</Text> : null)

  if (tool === 'Read') {
    const file = (output as ReadOutput | undefined)?.file
    if (!file) return null
    const shown = clip(file.content)

    return panel(
      `${file.totalLines} lines`,
      <Box flexDirection="column">
        <Code source={shown.text} path={file.filePath} startLine={file.startLine} />
        {more(shown.hidden, 'lines')}
      </Box>,
    )
  }
  if (tool !== 'Bash') return null
  const result = (output ?? {}) as BashOutput
  const stdout = clip(result.stdout ?? '')
  const stderr = clip(result.stderr ?? '')
  if (!stdout.text && !stderr.text) return null

  return panel(
    result.interrupted ? 'output (interrupted)' : 'output',
    <Box flexDirection="column">
      {stdout.text ? <Code source={stdout.text} {...outputLanguage(command, stdout.text)} /> : null}
      {more(stdout.hidden, 'lines')}
      {stderr.text ? <Text color="error">{stderr.text}</Text> : null}
      {more(stderr.hidden, 'stderr lines')}
    </Box>,
  )
}

function rowWidth(viewport: { columns: number } | undefined): number | undefined {
  return viewport && viewport.columns - 4
}

export const register: Register = on => {
  const commands = new Map<string, string>()

  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (!TOOLS.has(e.props.tool)) return next(e)
    if (e.props.tool === 'Bash') commands.set(e.props.tool_use_id, (e.props.input as BashInput).command ?? '')

    return drawCall($.ui.resolve(e), e.props, rowWidth(e.viewport))
  })

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (e.props.isErrored) return next(e)

    return drawOutput($.ui.resolve(e), e.props.tool, e.props.output, commands.get(e.props.tool_use_id) ?? '', rowWidth(e.viewport)) ?? next(e)
  })

  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    if (!e.props.calls.every(call => TOOLS.has(call.tool))) return next(e)
    const elements = $.ui.resolve(e)
    const width = rowWidth(e.viewport)
    const { Box } = elements

    return (
      <Box flexDirection="column" rowGap={1}>
        {e.props.calls.map((call, index) => (
          <Box key={call.tool_use_id ?? String(index)} flexDirection="column">
            {drawCall(elements, call, width)}
            {call.isErrored ? null : drawOutput(elements, call.tool, call.output, (call.input as BashInput).command ?? '', width)}
          </Box>
        ))}
      </Box>
    )
  })
}
