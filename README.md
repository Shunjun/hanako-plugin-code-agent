# hanako-code-agent

HanaAgent 插件：让 Agent 调用本地 CLI 编码工具执行编码任务，实时展示执行进度。

## 支持的工具

| 工具 | 说明 |
|------|------|
| Claude Code | `claude` CLI，支持 thinking、多工具调用 |
| Codex | OpenAI Codex CLI，JSON-RPC 通信 |

## 功能

- `code_start` — 启动 CLI 编码任务（非阻塞，后台运行）
- `code_status` — 查询任务状态和进度
- `code_abort` — 终止正在运行的任务
- 实时进度展示（iframe 卡片轮询）
- 任务完成后自动通知 Agent

## 安装

将本目录复制到 HanaAgent 插件目录：

```bash
# 社区插件目录
cp -r . ~/.hanako-dev/plugins/code-agent

# 或内置插件目录
cp -r . <hanako-src>/plugins/code-agent
```

重启 HanaAgent 即可。

## 前置要求

- 已安装对应 CLI 工具（`claude` 或 `codex`），且在 PATH 中可用
- HanaAgent v0.82.0+

## 配置

插件支持以下配置项（在 manifest.json 中声明）：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `defaultTool` | string | `claude` | 默认 CLI 工具 |
| `defaultModel` | string | — | 默认模型 |
| `maxConcurrent` | number | `3` | 最大并发任务数 |
| `defaultTimeout` | number | `900` | 默认超时（秒） |

## 开发

```bash
# 安装到开发目录
cp -r . ~/.hanako-dev/plugins/code-agent

# 修改代码后，在 HanaAgent 设置 → 插件 中禁用再启用，或重启 app
```

## License

MIT
