/**
 * plugins/code-agent/tools/code_start.js
 *
 * Start a CLI coding tool task. Non-blocking: returns immediately.
 * Use code_status to check progress, code_abort to cancel.
 */
import { CliProcess } from "../lib/cli-process.js";

export const name = "code_start";
export const description = `调用本地 CLI 编码工具执行编码任务。

【工作方式】非阻塞：提交任务后立即返回，后台运行。执行过程中工具调用、思考过程、文件修改会实时显示在聊天窗口的卡片中。任务完成后会自动发消息通知你结果，不需要轮询或等待。

【支持的工具】
- claude：Claude Code CLI（默认）
- codex：OpenAI Codex CLI

【参数说明】
- prompt（必填）：编码任务描述，会完整传递给 CLI 工具
- tool（可选）：CLI 工具名，可选 "claude" 或 "codex"，默认取配置中的 defaultTool
- cwd（可选）：工作目录，默认当前会话目录
- model（可选）：模型名称，如 sonnet、opus、haiku、gpt-4o，不传则使用工具默认模型
- systemPrompt（可选）：追加的系统提示词
- sessionId（可选）：恢复之前的 Claude Code 会话，传入之前任务返回的 sessionId
- extraArgs（可选）：额外的命令行参数数组

【使用流程】
1. 调用 code_start 提交编码任务，获得 taskId
2. 无需等待，继续做其他事情
3. 任务完成后会自动收到通知
4. 如需主动查询进度，使用 code_status 传入 taskId
5. 如需取消任务，使用 code_abort 传入 taskId`;

export const parameters = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "编码任务描述，传递给 CLI 工具的 prompt",
    },
    tool: {
      type: "string",
      enum: ["claude", "codex"],
      description: "CLI 工具，默认 claude",
    },
    cwd: { type: "string", description: "工作目录，默认当前会话目录" },
    model: {
      type: "string",
      description: "模型名称（如 sonnet、opus、gpt-4o）",
    },
    systemPrompt: { type: "string", description: "追加系统提示" },
    sessionId: {
      type: "string",
      description:
        "恢复之前的 Claude Code 会话（传入之前任务返回的 sessionId）",
    },
    extraArgs: {
      type: "array",
      items: { type: "string" },
      description: "额外命令行参数",
    },
  },
  required: ["prompt"],
};

export async function execute(input, ctx) {
  const store = ctx._codeAgent?.store;
  const registry = ctx._codeAgent?.registry;
  if (!store || !registry) {
    return {
      content: [{ type: "text", text: "code-agent plugin not initialized" }],
    };
  }

  const cfg = ctx.config?.getAll?.() || {};
  const toolId = input.tool || cfg.defaultTool || "claude";
  const adapter = registry.get(toolId);
  if (!adapter) {
    const available = registry.listIds().join(", ");
    return {
      content: [
        {
          type: "text",
          text: `Unknown CLI tool: ${toolId}. Available: ${available}`,
        },
      ],
    };
  }

  // Check concurrency limit
  const maxConcurrent = cfg.maxConcurrent || 3;
  const processes = ctx._codeAgent?.processes;
  if (processes && processes.size >= maxConcurrent) {
    return {
      content: [
        {
          type: "text",
          text: `已达到最大并发任务数 (${maxConcurrent})，请等待当前任务完成后再提交。`,
        },
      ],
    };
  }

  const cwd = input.cwd || ctx.sessionManager?.getCwd?.() || process.cwd();
  const sessionPath = ctx.sessionPath || null;

  // Generate taskId
  const taskId = `ca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create task record
  store.add({
    taskId,
    tool: toolId,
    prompt: input.prompt,
    cwd,
    sessionPath,
    status: "pending",
    steps: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });

  // Register deferred result
  ctx.bus
    .request("deferred:register", {
      taskId,
      sessionPath,
      meta: { type: "cli-execution", tool: toolId, prompt: input.prompt },
    })
    .catch(() => {});

  // Register visible task
  ctx.bus
    .request("task:register", {
      taskId,
      type: "cli-execution",
      parentSessionPath: sessionPath,
      meta: { tool: toolId, prompt: input.prompt, cwd },
    })
    .catch(() => {});

  // Spawn process in background
  const proc = new CliProcess({
    taskId,
    adapter,
    prompt: input.prompt,
    cwd,
    opts: {
      model: input.model || cfg.defaultModel,
      systemPrompt: input.systemPrompt,
      sessionId: input.sessionId,
      extraArgs: input.extraArgs,
      timeout: (cfg.defaultTimeout || 900) * 1000,
    },
    store,
    bus: ctx.bus,
    ctx,
  });

  // Track for abort
  if (processes) processes.set(taskId, proc);

  // Start (non-blocking)
  proc.start();

  // Cleanup process reference on exit
  const originalOnExit = proc._onExit.bind(proc);
  proc._onExit = (code, stderr) => {
    if (processes) processes.delete(taskId);
    originalOnExit(code, stderr);
  };

  const taskTitle = `${adapter.name}: ${input.prompt.slice(0, 80)}`;

  return {
    content: [
      {
        type: "text",
        text: `Started ${adapter.name} task (${taskId}). No need to wait — results will be pushed automatically when done. Use code_status to check progress manually.`,
      },
    ],
    details: {
      card: {
        type: "iframe",
        route: `/card/task?taskId=${encodeURIComponent(taskId)}`,
        title: taskTitle,
        description: `正在使用 ${adapter.name} 执行编码任务...`,
        aspectRatio: "8:1",
      },
    },
  };
}
