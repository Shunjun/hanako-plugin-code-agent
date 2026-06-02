/**
 * plugins/code-agent/tools/code_start.js
 *
 * Start a CLI coding tool task. Non-blocking: returns immediately.
 * Use code_status to check progress, code_abort to cancel.
 */
import { CliProcess } from "../lib/cli-process.js";

export const name = "code_start";
export const description = `Start a local CLI coding tool to execute a coding task.

【How it works】Non-blocking: returns immediately with a taskId. Progress (tool calls, thinking, file changes) is displayed in a card in the chat. Results are pushed automatically when done — no polling needed.

【Supported tools】
- claude: Claude Code CLI (default)
- codex: OpenAI Codex CLI

【Parameters】
- prompt (required): Task description, passed directly to the CLI tool
- tool (optional): CLI tool name, "claude" or "codex", defaults to config defaultTool
- cwd (optional): Working directory, defaults to current session directory
- model (optional): Model name (e.g. sonnet, opus, haiku, gpt-4o), uses tool default if not set
- systemPrompt (optional): Additional system prompt to append
- sessionId (optional): Resume a previous Claude Code session (pass sessionId from a prior task)
- extraArgs (optional): Additional command-line arguments array

【Usage flow】
1. Call code_start to submit a task, get back a taskId
2. No need to wait — continue doing other things
3. Results are pushed automatically when the task completes
4. To check progress manually, use code_status with the taskId
5. To cancel a task, use code_abort with the taskId`;

export const parameters = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "Task description passed to the CLI tool",
    },
    tool: {
      type: "string",
      enum: ["claude", "codex"],
      description: "CLI tool name, defaults to claude",
    },
    cwd: {
      type: "string",
      description: "Working directory, defaults to current session directory",
    },
    model: {
      type: "string",
      description: "Model name (e.g. sonnet, opus, gpt-4o)",
    },
    systemPrompt: {
      type: "string",
      description: "Additional system prompt to append",
    },
    sessionId: {
      type: "string",
      description:
        "Resume a previous Claude Code session (pass sessionId from a prior task)",
    },
    extraArgs: {
      type: "array",
      items: { type: "string" },
      description: "Additional command-line arguments",
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
        text: `Started ${adapter.name} task (${taskId}). No need to wait — results will be pushed automatically when done. `,
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
