/**
 * plugins/code-agent/tools/code_abort.js
 *
 * Abort a running CLI task. Kills the child process and cleans up.
 */

export const name = "code_abort";
export const description = `Abort a running CLI coding task. Kills the child process and cleans up resources.

【Parameters】
- taskId (required): Task ID returned by code_start

【Notes】
- Only effective for tasks in pending or running status
- Tasks that are already done or failed cannot be aborted
- Aborted tasks will have their status set to "aborted"`;

export const parameters = {
  type: "object",
  properties: {
    taskId: { type: "string", description: "Task ID returned by code_start" },
  },
  required: ["taskId"],
};

export async function execute(input, ctx) {
  const store = ctx._codeAgent?.store;
  const processes = ctx._codeAgent?.processes;
  if (!store || !processes) {
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

  if (task.status !== "pending" && task.status !== "running") {
    return {
      content: [
        {
          type: "text",
          text: `Task ${input.taskId} is already ${task.status}.`,
        },
      ],
    };
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
