/**
 * plugins/code-agent/lib/progress-emitter.js
 *
 * Emits progress events to the task panel and chat detail messages.
 * Task progress is displayed via iframe card polling the TaskStore.
 */
export class ProgressEmitter {
  constructor({ taskId, bus, ctx, toolName }) {
    this.taskId = taskId;
    this.bus = bus;
    this.sessionPath = ctx.sessionPath || null;
    this.toolName = toolName || "cli";
    this.stepCount = 0;
  }

  emitProgress(steps, lastEvent) {
    this.stepCount++;

    // Update task panel only — iframe card handles chat display
    this.bus
      .request("task:update", {
        taskId: this.taskId,
        progress: {
          current: this.stepCount,
          message: this._progressMessage(lastEvent),
        },
        meta: {
          lastStepType: lastEvent.type,
          lastTool: lastEvent.data?.tool || null,
          lastPath: lastEvent.data?.path || null,
        },
      })
      .catch(() => {});
  }

  emitDone(result) {
    this.bus
      .request("task:complete", {
        taskId: this.taskId,
        result,
      })
      .catch(() => {});

    // Wake Agent via deferred:resolve (steer delivery, not a user message)
    const parts = [`[Code Agent] Task completed (${this.taskId})`];
    if (result.sessionId) {
      parts.push(`sessionId: ${result.sessionId}`);
    }
    if (result.fileChanges?.length) {
      parts.push(
        `Modified ${result.fileChanges.length} file(s): ${result.fileChanges.join(", ")}`,
      );
    }
    if (result.toolCallCount) {
      parts.push(`${result.toolCallCount} tool call(s)`);
    }
    if (result.text) {
      parts.push(`Result: ${result.text.slice(0, 500)}`);
    }
    const msg = parts.join("\n");
    this.bus
      .request("deferred:resolve", {
        taskId: this.taskId,
        result: { text: msg },
      })
      .catch((err) => console.error(`[code-agent] deferred:resolve failed:`, err));
  }

  emitFailed(error) {
    this.bus
      .request("task:fail", {
        taskId: this.taskId,
        error,
      })
      .catch(() => {});

    // Wake Agent via deferred:fail (steer delivery, not a user message)
    let reason = `[Code Agent] Task failed (${this.taskId}): ${error.message || "unknown error"}`;
    if (error.hint) {
      reason += `\n${error.hint}`;
    }
    this.bus
      .request("deferred:fail", {
        taskId: this.taskId,
        reason,
      })
      .catch((err) => console.error(`[code-agent] deferred:fail failed:`, err));
  }

  _progressMessage(event) {
    if (!event?.data) return "Processing...";
    switch (event.type) {
      case "thinking":
        return "Thinking...";
      case "tool_call":
        return event.data.summary || `Calling ${event.data.tool}`;
      case "tool_result":
        return `${event.data.tool} done`;
      case "file_change":
        return `Modified: ${event.data.path}`;
      case "text":
        return "Writing...";
      case "session_init":
        return "Starting session...";
      default:
        return "Processing...";
    }
  }
}
