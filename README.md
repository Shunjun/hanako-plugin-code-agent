# hanako-plugin-code-agent

HanaAgent 插件：将编码任务委托给本地 CLI 工具（Claude Code、Codex），实时展示执行进度。

## 支持的工具

| 工具 | 说明 |
|------|------|
| Claude Code | `claude` CLI — thinking、多工具调用、文件编辑 |
| Codex | OpenAI Codex CLI — JSON-RPC 通信 |

## 功能

- `code_start` — 启动 CLI 编码任务（非阻塞，后台运行）
- `code_status` — 查询任务状态和进度
- `code_abort` — 终止正在运行的任务
- 实时进度卡片（可展开，显示步骤和结果）
- 任务完成后自动通知 Agent（通过 deferred result 系统）
- 支持会话恢复（传入 `sessionId` 继续之前的会话）

## 安装

1. 下载或压缩本插件目录
2. 打开 Hanako → 设置 → 插件
3. 将压缩包或文件夹拖入插件区域

重启 Hanako 即可生效。

## 前置要求

- 已安装对应 CLI 工具（`claude` 或 `codex`），且在 PATH 中可用
- Hanako v0.268.6+

## 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `defaultTool` | string | `claude` | 默认 CLI 工具 |
| `defaultModel` | string | `sonnet` | 默认模型 |
| `maxConcurrent` | number | `3` | 最大并发任务数 |
| `defaultTimeout` | number | `900` | 默认超时（秒） |

## 开发

```bash
# 安装到开发目录
cp -r . ~/.hanako-dev/plugins/code-agent

# 修改代码后，设置 → 插件 → 禁用再启用，或重启 app
```

## License

Apache-2.0
