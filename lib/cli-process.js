/**
 * plugins/code-agent/lib/cli-process.js
 *
 * Manages a single CLI child process: spawn, stdout/stdin handling,
 * abort, timeout, and confirmation flow. Delegates to an adapter for
 * command building and output parsing.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import { ProgressEmitter } from "./progress-emitter.js";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const CONFIRM_WINDOW_MS = 30 * 1000; // 30 seconds

export class CliProcess {
  constructor({ taskId, adapter, prompt, cwd, opts, store, bus, ctx }) {
    this.taskId = taskId;
    this.adapter = adapter;
    this.prompt = prompt;
    this.cwd = cwd;
    this.opts = opts;
    this.store = store;
    this.bus = bus;
    this.ctx = ctx;
    this.child = null;
    this.emitter = new ProgressEmitter({ taskId, bus, ctx });
    this.aborted = false;
    this.steps = [];
    this._timeout = null;
    this._nextStdinRequestId = 1;

    // Confirmation state
    this._pendingConfirmation = null; // { confirmationId, toolUseId, question, level }
    this._confirmTimer = null; // 30s confirm window timer
    this._confirmSocketServer = null; // Unix socket server for MCP

    // Timeout tracking for pause/resume
    this._timeoutStart = null;
    this._timeoutDuration = null;
    this._timeoutRemaining = null;
  }

  start() {
    const spawnConfig = this.adapter.buildSpawnConfig(
      this.prompt,
      this.cwd,
      this.opts,
    );
    const { bin, args, stdinMode } = spawnConfig;
    this._spawnConfig = spawnConfig;

    this.child = spawn(bin, args, {
      cwd: this.cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Handle stdin mode (e.g., Codex JSON-RPC)
    if (stdinMode === "jsonrpc" && this.adapter.initStdin) {
      const initResult = this.adapter.initStdin(this.child, {
        cwd: this.cwd,
        systemPrompt: this.opts.systemPrompt,
        model: this.opts.model,
        _nextRequestId: this._nextStdinRequestId,
      });
      this._nextStdinRequestId = initResult.nextRequestId;

      // Send the prompt after initialization
      if (this.adapter.writePrompt) {
        const promptResult = this.adapter.writePrompt(this.child, this.prompt, {
          _nextRequestId: this._nextStdinRequestId,
        });
        this._nextStdinRequestId = promptResult.nextRequestId;
      }
    } else if (stdinMode === "stream-json" && spawnConfig.prompt) {
      const msg = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: spawnConfig.prompt }],
        },
        ...(spawnConfig.sessionId ? { session_id: spawnConfig.sessionId } : {}),
      });
      this.child.stdin.write(msg + "\n");
      // Keep stdin open for potential tool_result writes
    }

    // Start confirmation socket server (if socket path provided)
    if (spawnConfig.socketPath) {
      this._startConfirmSocketServer(spawnConfig.socketPath);
    }

    // Parse stdout
    let stdoutBuf = "";
    this.child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        if (!line.trim()) continue;
        this._handleParsedLine(line);
      }
    });

    // Collect stderr
    let stderrBuf = "";
    this.child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    // Process exit
    this.child.on("exit", (code) => {
      this._clearTimeout();
      this._clearConfirmTimer();
      this._closeStdin();
      // Flush remaining stdout
      if (stdoutBuf.trim()) {
        this._handleParsedLine(stdoutBuf);
      }
      this._onExit(code, stderrBuf);
    });

    this.child.on("error", (err) => {
      this._clearTimeout();
      this._clearConfirmTimer();
      this._closeStdin();
      this._onError(err);
    });

    // Set timeout
    this._timeoutDuration = this.opts.timeout || DEFAULT_TIMEOUT_MS;
    this._timeoutStart = Date.now();
    this._timeout = setTimeout(() => {
      if (!this.aborted && this.child && !this.child.killed) {
        this._onError(
          new Error(`Timeout after ${Math.round(this._timeoutDuration / 1000)}s`),
        );
        this.abort();
      }
    }, this._timeoutDuration);

    this.store.update(this.taskId, { status: "running" });
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this._clearTimeout();
    this._clearConfirmTimer();
    this._closeStdin();
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (this.child && !this.child.killed) this.child.kill("SIGKILL");
      }, 5000);
    }
  }

  // ── Timeout pause/resume ──

  pauseTimeout() {
    if (!this._timeout) return;
    const elapsed = Date.now() - this._timeoutStart;
    this._timeoutRemaining = Math.max(0, this._timeoutDuration - elapsed);
    clearTimeout(this._timeout);
    this._timeout = null;
  }

  resumeTimeout() {
    if (this._timeoutRemaining == null || this._timeoutRemaining <= 0) return;
    this._timeoutStart = Date.now();
    this._timeoutDuration = this._timeoutRemaining;
    this._timeoutRemaining = null;
    this._timeout = setTimeout(() => {
      if (!this.aborted && this.child && !this.child.killed) {
        this._onError(
          new Error(`Timeout after ${Math.round(this._timeoutDuration / 1000)}s`),
        );
        this.abort();
      }
    }, this._timeoutDuration);
  }

  // ── Confirmation window ──

  startConfirmWindow() {
    this._confirmTimer = setTimeout(() => {
      // 30s elapsed, kill process but keep pending confirmation
      this._confirmTimer = null;
      if (this.child && !this.child.killed) {
        this.abort();
      }
    }, CONFIRM_WINDOW_MS);
  }

  _clearConfirmTimer() {
    if (this._confirmTimer) {
      clearTimeout(this._confirmTimer);
      this._confirmTimer = null;
    }
  }

  // ── Stdin management ──

  _closeStdin() {
    if (this.child?.stdin && !this.child.stdin.destroyed) {
      try {
        this.child.stdin.end();
      } catch {}
    }
  }

  writeToolResult(toolUseId, result) {
    if (!this.child?.stdin || this.child.stdin.destroyed) return false;
    const msg = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: result,
          },
        ],
      },
    });
    this.child.stdin.write(msg + "\n");
    return true;
  }

  // ── Confirmation socket server (plugin ← MCP server) ──

  _startConfirmSocketServer(socketPath) {
    // Clean up stale socket file
    try {
      fs.unlinkSync(socketPath);
    } catch {}

    const server = createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "confirmation_request") {
              this._handleMcpConfirmationRequest(msg, conn);
            }
          } catch {}
        }
      });
    });

    server.listen(socketPath, () => {
      // Socket ready
    });

    server.on("error", (err) => {
      console.error(`[code-agent] confirm socket error: ${err.message}`);
    });

    this._confirmSocketServer = server;
    this._confirmSocketPath = socketPath;
  }

  _handleMcpConfirmationRequest(msg, conn) {
    // MCP server connects via socket when Claude calls request_confirmation.
    // Store the connection for sending the response back later.
    // The actual confirmation flow is triggered by _handleParsedLine
    // when it sees the tool_use on stdout (which has the toolUseId).
    this._confirmSocketConn = conn;
  }

  _sendConfirmSocketResponse(approved, message) {
    if (this._confirmSocketConn && !this._confirmSocketConn.destroyed) {
      try {
        this._confirmSocketConn.write(
          JSON.stringify({
            type: "confirmation_response",
            approved,
            message: message || "",
          }) + "\n",
        );
        this._confirmSocketConn.end();
      } catch {}
      this._confirmSocketConn = null;
    }
  }

  _cleanupConfirmSocket() {
    if (this._confirmSocketServer) {
      this._confirmSocketServer.close();
      this._confirmSocketServer = null;
    }
    if (this._confirmSocketPath) {
      try {
        fs.unlinkSync(this._confirmSocketPath);
      } catch {}
      this._confirmSocketPath = null;
    }
    // Clean up MCP config file
    if (this.adapter?.cleanupSpawnConfig && this._spawnConfig) {
      this.adapter.cleanupSpawnConfig(this._spawnConfig);
    }
  }

  // ── Core ──

  _clearTimeout() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
  }

  _handleParsedLine(line) {
    const event = this.adapter.parseLine(line);
    if (!event) return;

    // Track session ID from init events
    if (event.type === "session_init" && event.data?.sessionId) {
      this.store.update(this.taskId, { sessionId: event.data.sessionId });
    }

    // Handle confirmation request from Claude
    if (event.type === "confirmation_request") {
      this._handleConfirmationRequest(event);
      return;
    }

    // Skip streaming deltas for steps (they'd be too many)
    if (event.streaming) {
      // Still emit progress for text deltas (shows something is happening)
      this.emitter.emitProgress(this.steps, event);
      return;
    }

    this.steps.push(event);
    this.store.addStep(this.taskId, event);
    this.emitter.emitProgress(this.steps, event);

    // Close stdin on final result/error if no pending confirmation
    if (
      (event.type === "result" || event.type === "error") &&
      !this._pendingConfirmation
    ) {
      this._closeStdin();
      this._cleanupConfirmSocket();
    }
  }

  _handleConfirmationRequest(event) {
    const confirmationId = `conf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const confirmation = {
      confirmationId,
      toolUseId: event.data.toolUseId,
      question: event.data.question,
      level: event.data.level || "user",
      status: "pending",
      createdAt: now,
      resolvedAt: null,
    };

    this._pendingConfirmation = confirmation;

    // Store in TaskStore
    this.store.addConfirmation(this.taskId, confirmation);

    // Pause timeout and start confirm window
    this.pauseTimeout();
    this.startConfirmWindow();

    // Notify parent agent via progress emitter
    this.emitter.emitConfirmationRequired(this.taskId, confirmation);
  }

  /**
   * Called by code_confirm tool when parent agent responds.
   */
  resolveConfirmation(confirmationId, approved, message) {
    if (!this._pendingConfirmation || this._pendingConfirmation.confirmationId !== confirmationId) {
      return false;
    }

    const now = new Date().toISOString();

    // Update TaskStore
    this.store.updateConfirmation(this.taskId, confirmationId, {
      status: approved ? "confirmed" : "rejected",
      resolvedAt: now,
      approved,
      responseMessage: message || "",
    });

    // Clear confirm window
    this._clearConfirmTimer();

    // Send response to MCP server (which returns it to Claude)
    this._sendConfirmSocketResponse(approved, message || "");

    const toolUseId = this._pendingConfirmation.toolUseId;
    this._pendingConfirmation = null;

    if (this.child && !this.child.killed) {
      // Process still alive — write tool_result and resume
      this.writeToolResult(
        toolUseId,
        approved ? "User confirmed the action." : `User rejected: ${message || "no reason"}`,
      );
      this.resumeTimeout();
    } else {
      // Process dead — need --resume
      // Return info so code_confirm can spawn a new process
      return {
        needsResume: true,
        toolUseId,
        approved,
        message,
      };
    }

    return true;
  }

  _onExit(code, stderr) {
    if (this.aborted) return;

    // Clean up confirmation socket
    this._cleanupConfirmSocket();

    const summary = this.adapter.getSummary(this.steps);
    // Fall back to sessionId captured from init event if result event didn't include one
    if (!summary.sessionId) {
      const initStep = this.steps.find((s) => s.type === "session_init");
      if (initStep?.data?.sessionId) summary.sessionId = initStep.data.sessionId;
    }

    if (code === 0) {
      this.store.update(this.taskId, {
        status: "done",
        result: summary,
        completedAt: new Date().toISOString(),
      });
      this.emitter.emitDone(summary);
    } else {
      const error = {
        message: summary.error?.message || `CLI exited with code ${code}`,
        stderr: (stderr || "").slice(-2000),
        subtype: summary.error?.subtype,
      };
      this.store.update(this.taskId, {
        status: "failed",
        error,
        completedAt: new Date().toISOString(),
      });
      this.emitter.emitFailed(error);
    }
  }

  _onError(err) {
    if (this.aborted) return;

    let error;
    if (err.code === "ENOENT") {
      const toolId = this.adapter?.id || "claude";
      const installHint =
        toolId === "claude"
          ? "npm install -g @anthropic-ai/claude-code"
          : "npm install -g @openai/codex";
      error = {
        message: `找不到 ${toolId} CLI 可执行文件（${err.path || err.syscall || "spawn"}）`,
        hint: `请先安装：${installHint}\n安装后重启应用即可。`,
        code: "BINARY_NOT_FOUND",
      };
    } else {
      error = { message: err.message || String(err) };
    }

    this.store.update(this.taskId, {
      status: "failed",
      error,
      completedAt: new Date().toISOString(),
    });
    this.emitter.emitFailed(error);
  }
}
