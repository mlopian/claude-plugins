# claude-plugins

Claude Code mods (function-hook plugins).

| Mod | What it does |
| --- | --- |
| [`limits-status`](limits-status/) | Colored bars above the prompt with remaining rate limits and time to reset |
| [`session-panel`](session-panel/) | Side panel with the session's usage, tool calls, changes, activity, scratch files and stats |
| [`toolcall-prettify`](toolcall-prettify/) | Readable Bash, Read and Edit tool calls with syntax colouring and a separate output block |
| [`blast-radius`](blast-radius/) | Holds risky shell commands (`rm -rf`, `find -delete`, `git reset --hard`, force push, migrations) and shows what they would change, with Proceed and Cancel |

## Requirements

Claude Code with function-hook plugin support. Validated and tested with Claude Code 2.1.294 (`limits-status`) 2.1.295 (`session-panel`), 2.1.296 (`toolcall-prettify` and `blast-radius`).
These mods use the `claude-code` runtime APIs, not shell hooks.

## Install

Run in Claude Code:

```text
/plugin install limits-status --marketplace mlopian/claude-plugins
/plugin install session-panel --marketplace mlopian/claude-plugins
/plugin install toolcall-prettify --marketplace mlopian/claude-plugins
/plugin install blast-radius --marketplace mlopian/claude-plugins
```

From the root of a local clone, run in a terminal:

```sh
claude plugin install limits-status --marketplace .
claude plugin install session-panel --marketplace .
claude plugin install toolcall-prettify --marketplace .
claude plugin install blast-radius --marketplace .
```

Start a new Claude Code session after installing.

## Validate and test

Run from the repository root:

```sh
claude plugin validate .
claude plugin validate limits-status
claude plugin test limits-status
claude plugin validate session-panel
claude plugin test session-panel
claude plugin validate toolcall-prettify
claude plugin test toolcall-prettify
claude plugin validate blast-radius
claude plugin test blast-radius
```

Tests use the built-in `claude-code/testing` runtime; no separate npm installation is needed.
