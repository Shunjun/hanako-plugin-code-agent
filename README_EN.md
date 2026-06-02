# hanako-plugin-code-agent

HanaAgent plugin: delegate coding tasks to local CLI tools (Claude Code, Codex) with real-time progress display.

## Supported Tools

| Tool | Description |
|------|-------------|
| Claude Code | `claude` CLI — thinking, multi-tool calls, file editing |
| Codex | OpenAI Codex CLI — JSON-RPC communication |

## Features

- `code_start` — Start a CLI coding task (non-blocking, runs in background)
- `code_status` — Query task status and progress
- `code_abort` — Cancel a running task
- Real-time progress card (collapsible, shows steps and results)
- Automatic Agent notification on completion (via deferred result system)
- Session resume support (pass `sessionId` to continue previous sessions)

## Installation

1. Download or zip this plugin directory
2. Open Hanako → Settings → Plugins
3. Drag the zip file or folder into the plugin area

Restart Hanako after installation.

## Prerequisites

- CLI tool installed and available in PATH (`claude` or `codex`)
- Hanako v0.82.0+

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `defaultTool` | string | `claude` | Default CLI tool |
| `defaultModel` | string | `sonnet` | Default model |
| `maxConcurrent` | number | `3` | Max concurrent tasks |
| `defaultTimeout` | number | `900` | Default timeout (seconds) |

## Development

```bash
# Install to dev directory
cp -r . ~/.hanako-dev/plugins/code-agent

# After code changes: Settings → Plugins → disable then re-enable, or restart app
```

## License

Apache-2.0
