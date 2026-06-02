/**
 * plugins/code-agent/tools/code_status.js
 *
 * Check the status and progress of a running CLI task.
 */

export const name = "code_status";
export const description = "查询 CLI 编码任务的运行状态、已执行步骤和进度。";

export const parameters = {
  type: "object",
  properties: {
    taskId: { type: "string", description: "任务 ID（code_start 返回的 taskId）" },
  },
  required: ["taskId"],
};

export async function execute(input, ctx) {
  const store = ctx._codeAgent?.store;
  if (!store) {
    return { content: [{ type: "text", text: "code-agent plugin not initialized" }] };
  }

  const task = store.get(input.taskId);
  if (!task) {
    return { content: [{ type: "text", text: `Task ${input.taskId} not found.` }] };
  }

  const statusInfo = {
    taskId: task.taskId,
    tool: task.tool,
    status: task.status,
    prompt: task.prompt,
    cwd: task.cwd,
    stepCount: (task.steps || []).length,
    lastSteps: (task.steps || []).slice(-5).map((s) => ({
      type: s.type,
      summary: s.data?.summary || s.data?.text?.slice(0, 100) || s.data?.path || s.type,
      timestamp: s.timestamp,
    })),
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  };

  if (task.status === "done" && task.result) {
    statusInfo.result = {
      text: task.result.text?.slice(0, 500),
      fileChanges: task.result.fileChanges,
      toolCallCount: task.result.toolCallCount,
    };
  }
  if (task.status === "failed" && task.error) {
    statusInfo.error = task.error;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(statusInfo, null, 2) }],
  };
}
