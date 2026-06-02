/**
 * plugins/code-agent/lib/adapters/codex.js
 *
 * OpenAI Codex CLI adapter. Uses JSON-RPC over stdio for persistent
 * session communication with structured event streaming.
 *
 * Reference: slock-daemon dist/chunk-7ZOPGUXT.js:3232-3380
 */

export const codexAdapter = {
  id: "codex",
  name: "OpenAI Codex",
  aliases: ["openai-codex"],

  buildSpawnConfig(_prompt, _cwd, opts = {}) {
    const args = ["app-server", "--listen", "stdio://"];
    if (Array.isArray(opts.extraArgs)) {
      args.push(...opts.extraArgs);
    }
    return { bin: "codex", args, stdinMode: "jsonrpc" };
  },

  /**
   * Write initialization and thread/start JSON-RPC requests to stdin.
   */
  initStdin(proc, opts = {}) {
    const requestId = opts._nextRequestId || 1;
    const threadParams = {
      cwd: opts.cwd || process.cwd(),
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      developerInstructions: opts.systemPrompt || "",
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.reasoningEffort
        ? { config: { model_reasoning_effort: opts.reasoningEffort } }
        : {}),
    };
    const requests = [
      {
        jsonrpc: "2.0",
        id: requestId,
        method: "initialize",
        params: {
          clientInfo: { name: "code-agent", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
      },
      {
        jsonrpc: "2.0",
        id: requestId + 1,
        method: opts.sessionId ? "thread/resume" : "thread/start",
        params: opts.sessionId
          ? { threadId: opts.sessionId, ...threadParams }
          : threadParams,
      },
    ];
    for (const req of requests) {
      proc.stdin?.write(JSON.stringify(req) + "\n");
    }
    return { nextRequestId: requestId + 2 };
  },

  /**
   * Send the user prompt via thread/send JSON-RPC request.
   */
  writePrompt(proc, prompt, opts = {}) {
    const requestId = opts._nextRequestId || 3;
    const msg = {
      jsonrpc: "2.0",
      id: requestId,
      method: "thread/send",
      params: { message: prompt },
    };
    proc.stdin?.write(JSON.stringify(msg) + "\n");
    return { nextRequestId: requestId + 1 };
  },

  /**
   * Parse a single line from Codex stdout (JSON-RPC notification/request).
   * Returns an event or null.
   */
  parseLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return null;
    }

    // Skip responses (result/error) — we only care about notifications
    if (message.result || message.error) return null;

    const method = message.method;
    const params = message.params;
    if (!method || !params) return null;

    switch (method) {
      case "thread/started":
        return {
          type: "session_init",
          data: { sessionId: params.thread?.id || null },
        };

      case "turn/started":
        return { type: "thinking", data: { text: "" } };

      case "item/agentMessage/delta":
        return {
          type: "text",
          data: { text: params.delta || "" },
          streaming: true,
        };

      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        return {
          type: "thinking",
          data: { text: params.delta || "" },
          streaming: true,
        };

      case "item/started": {
        const item = params.item;
        if (!item || typeof item.type !== "string") return null;
        switch (item.type) {
          case "commandExecution":
            return {
              type: "tool_call",
              data: {
                tool: "shell",
                summary: `Running: ${(item.command || "").slice(0, 80)}`,
                input: { command: item.command },
              },
            };
          case "fileChange":
            return {
              type: "file_change",
              data: {
                path: item.changes?.[0]?.path || "",
                action: item.changes?.[0]?.kind || "edit",
                tool: "file_change",
              },
            };
          case "mcpToolCall": {
            const toolName =
              item.server === "chat"
                ? `mcp__chat__${item.tool}`
                : `${item.server}_${item.tool}`;
            return {
              type: "tool_call",
              data: {
                tool: toolName,
                summary: toolName,
                input: item.arguments,
              },
            };
          }
          case "webSearch":
            return {
              type: "tool_call",
              data: {
                tool: "web_search",
                summary: `Web search: ${item.query || ""}`,
                input: { query: item.query },
              },
            };
          case "reasoning":
            return null; // Already handled by reasoning/delta events
          default:
            return null;
        }
      }

      case "item/completed": {
        const item = params.item;
        if (!item || typeof item.type !== "string") return null;
        if (item.type === "commandExecution") {
          return { type: "tool_result", data: { tool: "shell" } };
        }
        return null;
      }

      case "turn/completed":
        return { type: "turn_end", data: {} };

      default:
        return null;
    }
  },

  getSummary(steps) {
    const textSteps = steps.filter((s) => s.type === "text" && !s.streaming);
    const fileChanges = steps.filter((s) => s.type === "file_change");
    const toolCalls = steps.filter((s) => s.type === "tool_call");
    const errorStep = steps.find((s) => s.type === "error");
    const sessionInit = steps.find((s) => s.type === "session_init");
    return {
      text: textSteps.map((s) => s.data?.text || "").join("\n"),
      fileChanges: fileChanges.map((s) => s.data?.path),
      toolCallCount: toolCalls.length,
      sessionId: sessionInit?.data?.sessionId || null,
      error: errorStep?.data || null,
    };
  },
};
