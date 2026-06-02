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

    // Wake Agent with summary
    const parts = [`[Code Agent] 任务完成 (${this.taskId})`];
    if (result.sessionId) {
      parts.push(`sessionId: ${result.sessionId}`);
    }
    if (result.fileChanges?.length) {
      parts.push(
        `修改了 ${result.fileChanges.length} 个文件: ${result.fileChanges.join(", ")}`,
      );
    }
    if (result.toolCallCount) {
      parts.push(`执行了 ${result.toolCallCount} 次工具调用`);
    }
    if (result.text) {
      parts.push(`结果: ${result.text.slice(0, 500)}`);
    }
    const msg = parts.join("\n");
    console.log(
      `[code-agent] session:send (done) → sessionPath=${this.sessionPath}`,
    );
    console.log(`[code-agent] message content:\n${msg}`);
    this.bus
      .request("session:send", {
        text: msg,
        sessionPath: this.sessionPath,
      })
      .catch((err) => console.error(`[code-agent] session:send failed:`, err));
  }

  emitFailed(error) {
    this.bus
      .request("task:fail", {
        taskId: this.taskId,
        error,
      })
      .catch(() => {});

    // Wake Agent with error
    const msg = `[Code Agent] 任务失败 (${this.taskId}): ${error.message || "unknown error"}`;
    console.log(
      `[code-agent] session:send (failed) → sessionPath=${this.sessionPath}`,
    );
    console.log(`[code-agent] message content:\n${msg}`);
    this.bus
      .request("session:send", {
        text: msg,
        sessionPath: this.sessionPath,
      })
      .catch((err) => console.error(`[code-agent] session:send failed:`, err));
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
