# Toolcall prettify

Redraws Bash, Read and Edit tool calls in the transcript so it is clear what is the call and what is its output.

- Bash: the description, then the command with bash syntax colouring on a dark block.
- Read: the file path and line range, then the file content with syntax colouring and line numbers.
- Edit: the file path; the diff stays as Claude Code draws it.
- Output sits in its own tinted block below the call. JSON and diffs are coloured, and so is a file printed with `cat`, `head`, `tail`, `bat` or `sed -n`. Stderr is red. Long output is cut at 40 lines.

Groups made only of these tools (`Ran 3 shell commands`, `Read 2 files`) are drawn expanded. Groups with other tools are left to Claude Code.

## Install

Requires Claude Code with function-hook plugin support. Validated and tested with Claude Code 2.1.296.

Run in Claude Code:

```text
/plugin install toolcall-prettify --marketplace mlopian/claude-plugins
```

For installation from a local clone, see the [repository README](../README.md#install).
Start a new Claude Code session after installing.

## Transparent terminals

Terminals draw cell backgrounds opaque even when the window is translucent. In Ghostty, `background-opacity-cells = true` applies `background-opacity` to them too.
