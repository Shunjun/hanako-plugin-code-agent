/**
 * plugins/code-agent/tools/code_abort.js
 *
 * Abort a running CLI task. Kills the child process and cleans up.
 */

export const name = "code_abort";
export const description = `终止一个正在运行的 CLI 编码任务，杀死子进程并清理资源。

【参数】
- taskId（必填）：任务 ID，由 code_start 返回

【说明】
- 仅对 pending 或 running 状态的任务有效
- 已完成（done/failed）的任务无法终止
- 终止后任务状态变为 aborted`;

export const parameters = {
  type: "object",
  properties: {
    taskId: { type: "string", description: "任务 ID（code_start 返回的 taskId）" },
  },
  required: ["taskId"],
};

export async function execute(input, ctx) {
  const store = ctx._codeAgent?.store;
  const processes = ctx._codeAgent?.processes;
  if (!store || !processes) {
    return { content: [{ type: "text", text: "code-agent plugin not initialized" }] };
  }

  const task = store.get(input.taskId);
  if (!task) {
    return { content: [{ type: "text", text: `Task ${input.taskId} not found.` }] };
  }

  if (task.status !== "pending" && task.status !== "running") {
    return { content: [{ type: "text", text: `Task ${input.taskId} is already ${task.status}.` }] };
  }

  const proc = processes.get(input.taskId);
  if (proc) {
    proc.abort();
  }

  store.update(input.taskId, {
    status: "aborted",
    completedAt: new Date().toISOString(),
  });

  // Cleanup
  processes.delete(input.taskId);

  return {
    content: [{ type: "text", text: `Task ${input.taskId} aborted.` }],
  };
}
