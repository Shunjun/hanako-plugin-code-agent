/**
 * plugins/code-agent/tools/code_start.js
 *
 * Start a CLI coding tool task. Non-blocking: returns immediately.
 * Use code_status to check progress, code_abort to cancel.
 */
import { CliProcess } from "../lib/cli-process.js";

export const name = "code_start";
export const description =
  "调用本地 CLI 编码工具执行编码任务。非阻塞：提交后立即返回，后台运行。执行过程中的工具调用、思考过程、文件修改会实时显示。完成后自动通知。支持的工具：claude（Claude Code CLI）、codex（OpenAI Codex CLI）。";

export const parameters = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "编码任务描述，传递给 CLI 工具的 prompt" },
    tool: { type: "string", enum: ["claude", "codex"], description: "CLI 工具，默认 claude" },
    cwd: { type: "string", description: "工作目录，默认当前会话目录" },
    model: { type: "string", description: "模型名称（如 sonnet、opus、gpt-4o）" },
    systemPrompt: { type: "string", description: "追加系统提示" },
    maxBudgetUsd: { type: "number", description: "最大 API 花费限制（美元）" },
    extraArgs: { type: "array", items: { type: "string" }, description: "额外命令行参数" },
  },
  required: ["prompt"],
};

export async function execute(input, ctx) {
  const store = ctx._codeAgent?.store;
  const registry = ctx._codeAgent?.registry;
  if (!store || !registry) {
    return { content: [{ type: "text", text: "code-agent plugin not initialized" }] };
  }

  const toolId = input.tool || "claude";
  const adapter = registry.get(toolId);
  if (!adapter) {
    const available = registry.listIds().join(", ");
    return {
      content: [{ type: "text", text: `Unknown CLI tool: ${toolId}. Available: ${available}` }],
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
  ctx.bus.request("deferred:register", {
    taskId,
    sessionPath,
    meta: { type: "cli-execution", tool: toolId, prompt: input.prompt },
  }).catch(() => {});

  // Register visible task
  ctx.bus.request("task:register", {
    taskId,
    type: "cli-execution",
    parentSessionPath: sessionPath,
    meta: { tool: toolId, prompt: input.prompt, cwd },
  }).catch(() => {});

  // Spawn process in background
  const proc = new CliProcess({
    taskId,
    adapter,
    prompt: input.prompt,
    cwd,
    opts: {
      model: input.model,
      systemPrompt: input.systemPrompt,
      maxBudgetUsd: input.maxBudgetUsd,
      timeout: 15 * 60 * 1000,
    },
    store,
    bus: ctx.bus,
    ctx,
  });

  // Track for abort
  const processes = ctx._codeAgent?.processes;
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
    content: [{ type: "text", text: `Started ${adapter.name} task (${taskId}). Use code_status to check progress.` }],
    details: {
      card: {
        type: "iframe",
        route: `/card/task?taskId=${encodeURIComponent(taskId)}`,
        title: taskTitle,
        description: `正在使用 ${adapter.name} 执行编码任务...`,
      },
    },
  };
}
