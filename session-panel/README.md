# Session panel

A side panel for browsing everything Claude Code knows about the current session: context and rate limits, every tool call with its full input and result, edited files with diffs, background activity, the session's scratch directory and usage statistics.

Open it with `/session-panel`.

## Install

Requires Claude Code with function-hook plugin support. Validated and tested with Claude Code 2.1.295.

Run in Claude Code:

```text
/plugin install session-panel --marketplace mlopian/claude-plugins
```

For installation from a local clone, see the [repository README](../README.md#install).
Start a new Claude Code session after installing.

## Tabs

| Key | Tab | Shows |
| --- | --- | --- |
| `u` | Usage | Session facts (title, ID, model, effort, permission mode, versions, branch, cost), rate limits, context fill with the `/context` grid, categories, memory files and tokens left before auto-compact, session paths, `session-env` contents |
| `t` | Tool calls | One card per tool call, newest first: tool, status, start time, duration, description or file and the first three lines of input. `Enter` opens the call in full with syntax colouring |
| `c` | Changes | `git status` of the session's repository with line counts, and the files Claude edited in this session with their backup versions. `Enter` opens a coloured diff |
| `a` | Activity | Subagents and teammates with their status, and background task output files |
| `f` | Files | Browser of the session's scratch directory, including pasted images |
| `s` | Stats | Token totals, cache hit rate, turn durations, tool usage and the heaviest requests |
| `h` | `?` | All keyboard shortcuts |

## Keyboard

| Key | Action |
| --- | --- |
| `ctrl+x tab` | Move the keyboard from the prompt to the panel (Claude Code) |
| `esc` | Give the keyboard back to the prompt (Claude Code) |
| `ctrl+x x` | Close the panel (Claude Code) |
| `enter` | Open the focused tool call, diff, file or folder |
| `b` | Back from a tool call or diff to its list, or to the parent folder in Files |
| `j` / `k` | Scroll the tool call list by half a page of cards |
| `e` | Tool calls: show only failed calls, or all of them |
| `r` | Tool calls: refresh |

The tool call list keeps the tab bar pinned and scrolls card by card. The other tabs and the full views scroll with the arrows, page keys and mouse wheel.

## Behavior

- Reads the transcript from `~/.claude/projects/<project>/<session>.jsonl`, the edit backups from `~/.claude/file-history/<session>/`, `session-env` from `~/.claude/session-env/<session>/` and the scratch directory from `/tmp/claude-<uid>/<project>/<session>/`.
- Tool calls refresh after every turn and with `r`. Usage, Activity and Files refresh every 2 seconds while the panel is shown. Changes reruns `git status` every 2 seconds while it is shown, and redraws only when the result changed.
- The context breakdown uses Claude Code's local estimate (`summary`), so it sends no token-count requests.
- Changes lists only files edited with Claude's Edit and Write tools. Files changed through Bash have no backups; the git section shows them when they are inside the repository.
- `enter` on a file opens it in `$VISUAL` or `$EDITOR` in a new herdr pane, or a new tmux window. Outside herdr and tmux the path is copied to the clipboard instead. PNG files open in the system viewer with `open`.

## Troubleshooting

- If `/session-panel` is unknown, check `/plugin` to confirm `session-panel` is installed and enabled, then start a new session.
- If no tab is highlighted after an update, the panel remembers a tab that no longer exists. Pick any tab.
- If the editor does not open, check that `$EDITOR` is set and that the session runs inside herdr or tmux.
- `open` for PNG files is macOS only.

## Validate and test

Run from the repository root:

```sh
claude plugin validate session-panel
claude plugin test session-panel
```

Tests cover transcript parsing, tool call descriptions and timing, session metadata, file history, git status parsing, diff counts and formatting.
