/**
 * plugins/code-agent/lib/cli-process.js
 *
 * Manages a single CLI child process: spawn, stdout/stdin handling,
 * abort, and timeout. Delegates to an adapter for command building
 * and output parsing.
 */
import { spawn } from "node:child_process";
import { ProgressEmitter } from "./progress-emitter.js";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

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
  }

  start() {
    const spawnConfig = this.adapter.buildSpawnConfig(this.prompt, this.cwd, this.opts);
    const { bin, args, stdinMode } = spawnConfig;

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
      // Flush remaining stdout
      if (stdoutBuf.trim()) {
        this._handleParsedLine(stdoutBuf);
      }
      this._onExit(code, stderrBuf);
    });

    this.child.on("error", (err) => {
      this._clearTimeout();
      this._onError(err);
    });

    // Set timeout
    const timeout = this.opts.timeout || DEFAULT_TIMEOUT_MS;
    this._timeout = setTimeout(() => {
      if (!this.aborted && this.child && !this.child.killed) {
        this._onError(new Error(`Timeout after ${Math.round(timeout / 1000)}s`));
        this.abort();
      }
    }, timeout);

    this.store.update(this.taskId, { status: "running" });
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this._clearTimeout();
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (this.child && !this.child.killed) this.child.kill("SIGKILL");
      }, 5000);
    }
  }

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

    // Skip streaming deltas for steps (they'd be too many)
    if (event.streaming) {
      // Still emit progress for text deltas (shows something is happening)
      this.emitter.emitProgress(this.steps, event);
      return;
    }

    this.steps.push(event);
    this.store.addStep(this.taskId, event);
    this.emitter.emitProgress(this.steps, event);
  }

  _onExit(code, stderr) {
    if (this.aborted) return;

    const summary = this.adapter.getSummary(this.steps);

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

    const error = { message: err.message || String(err) };
    this.store.update(this.taskId, {
      status: "failed",
      error,
      completedAt: new Date().toISOString(),
    });
    this.emitter.emitFailed(error);
  }
}
