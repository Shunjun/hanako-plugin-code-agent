/**
 * plugins/code-agent/tools/code_confirm.js
 *
 * Respond to a pending confirmation request from a CLI coding task.
 * Called by the parent agent after deciding (autonomously or via user input).
 */
import { CliProcess } from "../lib/cli-process.js";

export const name = "code_confirm";
export const description = `Respond to a pending confirmation request from a CLI coding task.

【How it works】When a CLI tool (Claude/Codex) calls request_confirmation during execution, the task pauses and waits for a response. Use this tool to approve or reject the confirmation.

【Parameters】
- taskId (required): The task ID that has a pending confirmation
- confirmationId (required): The confirmation ID from the confirmation request
- approved (required): true to approve, false to reject
- message (optional): Reason for rejection (only needed when approved=false)

【Usage】
- The confirmation request is delivered via <hana-background-result> message
- For "agent" level: you can decide autonomously and call this tool directly
- For "user" level: ask the user first, then call this tool with their decision`;

export const parameters = {
  type: "object",
  properties: {
    taskId: {
      type: "string",
      description: "The task ID that has a pending confirmation",
    },
    confirmationId: {
      type: "string",
      description: "The confirmation ID from the confirmation request",
    },
    approved: {
      type: "boolean",
      description: "true to approve, false to reject",
    },
    message: {
      type: "string",
      description: "Reason for rejection (only needed when approved=false)",
    },
  },
  required: ["taskId", "confirmationId", "approved"],
};

export async function execute(input, ctx) {
  const store = ctx._codeAgent?.store;
  const registry = ctx._codeAgent?.registry;
  const processes = ctx._codeAgent?.processes;
  if (!store || !registry) {
    return {
      content: [{ type: "text", text: "code-agent plugin not initialized" }],
    };
  }

  const { taskId, confirmationId, approved, message } = input;

  if (!taskId || !confirmationId) {
    return {
      content: [
        { type: "text", text: "taskId and confirmationId are required." },
      ],
    };
  }

  const task = store.get(taskId);
  if (!task) {
    return {
      content: [{ type: "text", text: `Task not found: ${taskId}` }],
    };
  }

  // Find the pending confirmation
  const confirmation = (task.confirmations || []).find(
    (c) => c.confirmationId === confirmationId,
  );
  if (!confirmation) {
    return {
      content: [
        { type: "text", text: `Confirmation not found: ${confirmationId}` },
      ],
    };
  }
  if (confirmation.status !== "pending") {
    return {
      content: [
        { type: "text", text: `Confirmation already ${confirmation.status}` },
      ],
    };
  }

  const now = new Date().toISOString();

  // Try to resolve on the existing process
  const proc = processes?.get(taskId);
  if (proc) {
    const result = proc.resolveConfirmation(confirmationId, approved, message);
    if (result === true) {
      // Successfully resolved on existing process
      return {
        content: [
          {
            type: "text",
            text: `Confirmation ${approved ? "approved" : "rejected"}. Task continues.`,
          },
        ],
      };
    }
    if (result?.needsResume) {
      // Process was dead, need to resume
      return resumeAndRespond(task, result, store, registry, processes, ctx);
    }
  }

  // Process not found — need to resume from TaskStore session
  return resumeAndRespond(
    task,
    { toolUseId: confirmation.toolUseId, approved, message },
    store,
    registry,
    processes,
    ctx,
  );
}

function resumeAndRespond(task, result, store, registry, processes, ctx) {
  const sessionId = task.sessionId;
  if (!sessionId) {
    // Update confirmation status anyway
    store.updateConfirmation(
      task.taskId,
      task.confirmations?.find((c) => c.status === "pending")?.confirmationId,
      {
        status: result.approved ? "confirmed" : "rejected",
        resolvedAt: new Date().toISOString(),
        approved: result.approved,
        responseMessage: result.message || "",
      },
    );
    return {
      content: [
        {
          type: "text",
          text: "No sessionId available for resume. Confirmation recorded but cannot continue.",
        },
      ],
    };
  }

  // Build the tool_result prompt for resume
  const toolResultText = result.approved
    ? "User confirmed the action."
    : `User rejected: ${result.message || "no reason"}`;

  const toolResultMsg = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: result.toolUseId,
          content: toolResultText,
        },
      ],
    },
  });

  // Spawn a new process with --resume and write the tool_result
  const adapter = registry.get(task.tool);
  if (!adapter) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${task.tool}` }],
    };
  }

  const cfg = ctx.config?.getAll?.() || {};
  const cwd = task.cwd || process.cwd();
  const sessionPath = task.sessionPath || ctx.sessionPath || null;

  const newProc = new CliProcess({
    taskId: task.taskId,
    adapter,
    prompt: toolResultText, // Not really used since we're resuming
    cwd,
    opts: {
      model: cfg.defaultModel,
      sessionId,
      timeout: cfg.defaultTimeout ? cfg.defaultTimeout * 1000 : undefined,
    },
    store,
    bus: ctx.bus,
    ctx,
  });

  // Track the new process
  if (processes) processes.set(task.taskId, newProc);

  // Start the process
  newProc.start();

  // Write the tool_result after process starts
  // The start() call writes the initial prompt via stdin, but for resume
  // we need to write the tool_result instead. Since start() already wrote
  // the prompt, we write the tool_result after a short delay.
  setTimeout(() => {
    newProc.writeToolResult(result.toolUseId, toolResultText);
  }, 100);

  // Cleanup process reference on exit
  const originalOnExit = newProc._onExit.bind(newProc);
  newProc._onExit = (code, stderr) => {
    if (processes) processes.delete(task.taskId);
    originalOnExit(code, stderr);
  };

  // Update confirmation status
  const pendingConf = (task.confirmations || []).find(
    (c) => c.status === "pending",
  );
  if (pendingConf) {
    store.updateConfirmation(task.taskId, pendingConf.confirmationId, {
      status: result.approved ? "confirmed" : "rejected",
      resolvedAt: new Date().toISOString(),
      approved: result.approved,
      responseMessage: result.message || "",
    });
  }

  return {
    content: [
      {
        type: "text",
        text: `Confirmation ${result.approved ? "approved" : "rejected"}. Resuming task with sessionId: ${sessionId}`,
      },
    ],
  };
}
