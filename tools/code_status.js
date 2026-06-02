/**
 * plugins/code-agent/tools/code_status.js
 *
 * Check the status and progress of a running CLI task.
 */

export const name = "code_status";
export const description = `Check the status and progress of a CLI coding task.

【Parameters】
- taskId (required): Task ID returned by code_start

【Return info】
- taskId, tool (which CLI tool), status (pending/running/done/failed/aborted)
- stepCount: Number of steps executed
- lastSteps: Summary of the last 5 steps
- createdAt / completedAt: Creation and completion timestamps
- result: Execution result summary when done (text, fileChanges, toolCallCount)
- error: Error details when failed

【Status values】
- pending: Submitted, waiting to execute
- running: Currently executing
- done: Execution completed
- failed: Execution failed
- aborted: Was cancelled`;

export const parameters = {
  type: "object",
  properties: {
    taskId: {
      type: "string",
      description: "Task ID returned by code_start",
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
