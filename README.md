# claude-plugins

Claude Code mods (function-hook plugins).

| Mod | What it does |
| --- | --- |
| [`limits-status`](limits-status/) | Colored bars above the prompt with remaining rate limits and time to reset |

## Requirements

Claude Code with function-hook plugin support. Validated and tested with Claude Code 2.1.294.
These mods use the `claude-code` runtime APIs, not shell hooks.

## Install

Run in Claude Code:

```text
/plugin install limits-status --marketplace mlopian/claude-plugins
```

From the root of a local clone, run in a terminal:

```sh
claude plugin install limits-status --marketplace .
```

Start a new Claude Code session after installing.

## Validate and test

Run from the repository root:

```sh
claude plugin validate .
claude plugin validate limits-status
claude plugin test limits-status
```

Tests use the built-in `claude-code/testing` runtime; no separate npm installation is needed.
