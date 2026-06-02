---
name: code-agent-guide
description: 使用 CLI 编码工具（Claude Code、Codex）时必读。包含工具参数、非阻塞工作流、任务路由。
---

# Code Agent 工具指南

## 非阻塞工作流

调用 `code_start` 后任务在后台运行，你**不需要等待结果**。执行过程中的工具调用、思考过程、文件修改会实时显示在聊天中。任务完成后会自动通知你。

1. 调用 `code_start`，传入 prompt 和参数
2. **告诉用户任务已提交，正在后台执行**
3. **继续对话**，不要等待
4. 完成后结果会自动送达；如需主动查询，调用 `code_status`
5. 如需终止，调用 `code_abort`

## 工具参数

### code_start

- `prompt`（必填）：编码任务描述，传递给 CLI 工具。写清楚具体要做什么
- `tool`：CLI 工具（`claude` 或 `codex`），默认 `claude`
- `cwd`：工作目录，默认当前会话目录
- `model`：模型名称（如 `sonnet`、`opus`、`gpt-4o`）
- `systemPrompt`：追加系统提示，用于约束 CLI 工具的行为
- `maxBudgetUsd`：最大 API 花费限制（美元）

### code_status

- `taskId`（必填）：`code_start` 返回的任务 ID

返回当前状态、已执行步骤数、最近 5 个步骤摘要、最终结果（如已完成）。

### code_abort

- `taskId`（必填）：要终止的任务 ID

## 任务路由

| 用户意图 | 示例 | 工具 | 备注 |
|---------|------|------|------|
| 让 AI 写代码 | "帮我写一个登录页面" | code_start | prompt 描述需求 |
| 修复 bug | "修复 auth.ts 的类型错误" | code_start | prompt 说明问题和期望 |
| 代码重构 | "把 utils.ts 里的函数拆分成独立模块" | code_start | prompt 描述重构规则 |
| 运行测试 | "跑一下测试看看有没有问题" | code_start | prompt 说"运行测试并修复失败的用例" |
| 代码审查 | "帮我 review 这个 PR" | code_start | prompt 描述审查范围 |
| 查看进度 | "那个代码任务做完了吗" | code_status | 传入 taskId |
| 终止任务 | "停掉那个任务" | code_abort | 传入 taskId |
| 不是编码任务 | "帮我写个文档" | 不调用 | 只是普通对话 |

## 选择 CLI 工具

| 工具 | 适合场景 | 说明 |
|------|---------|------|
| `claude`（默认） | 通用编码任务 | Claude Code CLI，支持 thinking、多工具调用 |
| `codex` | 需要 OpenAI 模型时 | OpenAI Codex CLI，JSON-RPC 通信 |

## 注意

- 不同 CLI 工具支持的模型和参数不同
- 大型任务可能需要较长时间，建议设置合理的 `maxBudgetUsd`
- 一个会话可以同时运行多个 CLI 任务（受 `maxConcurrent` 限制）
- 如果 CLI 工具未安装或路径不对，`code_start` 会返回错误信息
