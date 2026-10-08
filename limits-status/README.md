# Limits status

Shows remaining Claude Code rate limits above the prompt as colored, 10-cell bars with reset countdowns.

## Install

Requires Claude Code with function-hook plugin support. Validated and tested with Claude Code 2.1.294.

Run in Claude Code:

```text
/plugin install limits-status --marketplace mlopian/claude-plugins
```

For installation from a local clone, see the [repository README](../README.md#install).
Start a new Claude Code session after installing.

## Behavior

- Reads the initial limits from Claude Code's session usage and updates them when Claude Code reports changed rate limits.
- Updates reset countdowns every minute. This timer does not fetch new limits.
- Labels the five-hour window as `5h`, the seven-day window as `7d`, and the spend limit as `$`. Other limit kinds retain their names.
- Green: more than 50% remaining. Yellow: more than 20%. Red: 20% or less.
- Shows reset countdowns only when Claude Code provides a reset time.
- Hides the widget when no rate limits are available or when a survey occupies the prompt area.
- Uses the account and limits reported by the current Claude Code session. No additional usage CLI, API key or separate login is required.

## Troubleshooting

- If installation fails, check `claude --version` and whether `claude plugin install --help` lists `--marketplace`. Use a Claude Code release with function-hook plugin support.
- If the widget is missing, check `/plugin` to confirm `limits-status` is installed and enabled, then start a new session.
- An empty limits response means there is nothing to display. The plugin does not invent limits for accounts or authentication modes that do not report them.
- If a reset countdown changes but the percentage does not, the timer is working; percentages change only when Claude Code reports updated usage.

## Validate and test

Run from the repository root:

```sh
claude plugin validate limits-status
claude plugin test limits-status
```

Tests cover formatting, color thresholds, countdowns and rendering in terminal and desktop surfaces.
