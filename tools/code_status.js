/**
 * plugins/code-agent/tools/code_status.js
 *
 * Check the status and progress of a running CLI task.
 */

export const name = "code_status";
export const description = `查询 CLI 编码任务的运行状态、已执行步骤和进度。

【参数】
- taskId（必填）：任务 ID，由 code_start 返回

【返回信息】
- taskId、tool（使用的工具）、status（pending/running/done/failed/aborted）
- stepCount：已执行步骤数
- lastSteps：最近 5 个步骤摘要
- createdAt / completedAt：创建和完成时间
- result：任务成功时的执行结果摘要（text、fileChanges、toolCallCount）
- error：任务失败时的错误信息

【状态值说明】
- pending：已提交，等待执行
- running：正在执行中
- done：执行完成
- failed：执行失败
- aborted：已被终止`;

export const parameters = {
  type: "object",
  properties: {
    taskId: {
      type: "string",
      description: "任务 ID（code_start 返回的 taskId）",
    },
  },
  required: ["taskId"],
};

export async function execute(input, ctx) {
  const store = ctx._codeAgent?.store;
  if (!store) {
    return {
      content: [{ type: "text", text: "code-agent plugin not initialized" }],
    };
  }

  const task = store.get(input.taskId);
  if (!task) {
    return {
      content: [{ type: "text", text: `Task ${input.taskId} not found.` }],
    };
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
      summary:
        s.data?.summary ||
        s.data?.text?.slice(0, 100) ||
        s.data?.path ||
        s.type,
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
