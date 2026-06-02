---
name: code-agent
description: 调用本地 CLI 编码工具（Claude Code、Codex）执行编码任务。必读：包含工作流、参数、会话恢复。
---

# Code Agent

通过本地 CLI 编码工具（Claude Code、Codex）执行编码任务。

## 工作流

**非阻塞**：提交任务后立即返回，后台运行。完成后自动通知，不需要轮询。

1. 调用 `code_start` 提交任务，获得 `taskId`
2. 告诉用户任务已提交，继续对话
3. 完成后自动收到通知（包含结果和 sessionId）
4. 主动查询进度：`code_status`（传入 taskId）
5. 终止任务：`code_abort`（传入 taskId）

## 工具

### code_start

提交编码任务，非阻塞。

| 参数 | 必填 | 说明 |
|------|------|------|
| prompt | 是 | 编码任务描述，写清楚具体要做什么 |
| tool | 否 | `claude`（默认）或 `codex` |
| cwd | 否 | 工作目录，默认当前会话目录 |
| model | 否 | 模型名称，如 `sonnet`、`opus`、`gpt-4o` |
| systemPrompt | 否 | 追加系统提示，约束 CLI 工具行为 |
| sessionId | 否 | 恢复之前的会话（传入上次任务返回的 sessionId） |
| extraArgs | 否 | 额外命令行参数数组 |

### code_status

查询任务状态。

| 参数 | 必填 | 说明 |
|------|------|------|
| taskId | 是 | code_start 返回的任务 ID |

返回：状态、步骤数、最近步骤摘要、结果或错误。

### code_abort

终止正在运行的任务。

| 参数 | 必填 | 说明 |
|------|------|------|
| taskId | 是 | 要终止的任务 ID |

## 会话恢复

任务完成后，通知消息中包含 `sessionId`。下次调用 `code_start` 时传入该值，CLI 工具会恢复上次的上下文（Claude 用 `--resume`，Codex 用 `thread/resume`）。

适用于连续多轮编码场景：第一次任务的输出作为第二次任务的上下文。

## 任务路由

| 用户意图 | 工具 | 备注 |
|---------|------|------|
| 写代码 / 修 bug / 重构 | code_start | prompt 描述需求 |
| 跑测试 | code_start | prompt 说"运行测试并修复失败的用例" |
| 查看进度 | code_status | 传入 taskId |
| 终止任务 | code_abort | 传入 taskId |
| 非编码任务 | 不调用 | 普通对话 |

## 工具选择

| 工具 | 场景 |
|------|------|
| claude（默认） | 通用编码，支持 thinking、多工具调用 |
| codex | 需要 OpenAI 模型时 |

## 注意

- 同一时刻可运行多个任务（受配置 `maxConcurrent` 限制）
- CLI 工具未安装时 `code_start` 会返回错误
- 不同工具支持的模型和参数不同
