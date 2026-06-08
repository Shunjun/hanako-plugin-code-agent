/**
 * plugins/code-agent/lib/adapters/claude.js
 *
 * Claude Code CLI adapter. Uses interactive mode with stream-json
 * input/output for structured communication via stdin/stdout.
 *
 * Reference: slock-daemon dist/chunk-7ZOPGUXT.js:2505-2730
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { findBinary } from "../binary-finder.js";
import { fileURLToPath } from "node:url";
import { CONFIRMATION_SYSTEM_PROMPT } from "./confirmation-prompt.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable tools that require interactive user input or are not useful
// in non-interactive mode.  Mirrors slock-daemon CLAUDE_DISALLOWED_TOOLS.
const defaultDisallowed = [
  "EnterPlanMode",
  "ExitPlanMode",
  "ScheduleWakeup",
  "CronCreate",
  "CronList",
  "CronDelete",
];

export const claudeAdapter = {
  id: "claude",
  name: "Claude Code",
  aliases: ["claude-code"],

  buildSpawnConfig(prompt, _cwd, opts = {}) {
    const args = [
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      "--allow-dangerously-skip-permissions",
      "--dangerously-skip-permissions",
      "--verbose",
      "--model",
      opts.model || "sonnet",
    ];
    // Merge confirmation system prompt with user-provided one
    const systemParts = [CONFIRMATION_SYSTEM_PROMPT];
    if (opts.systemPrompt) {
      systemParts.push(opts.systemPrompt);
    }
    args.push("--append-system-prompt", systemParts.join("\n\n"));

    const extra = opts.disallowedTools
      ? opts.disallowedTools.split(",").map((s) => s.trim())
      : [];
    const disallowed = [...defaultDisallowed, ...extra].join(",");
    args.push("--disallowed-tools", disallowed);
    if (opts.maxBudgetUsd) {
      args.push("--max-budget-usd", String(opts.maxBudgetUsd));
    }
    if (opts.sessionId) {
      args.push("--resume", opts.sessionId);
    }
    if (Array.isArray(opts.extraArgs)) {
      args.push(...opts.extraArgs);
    }

    // Confirmation MCP server setup
    const socketPath = path.join(
      os.tmpdir(),
      `code-agent-confirm-${crypto.randomUUID().slice(0, 8)}.sock`,
    );
    const mcpServerPath = path.join(__dirname, "confirmation-mcp-server.js");
    const mcpConfigPath = path.join(
      os.tmpdir(),
      `code-agent-mcp-${crypto.randomUUID().slice(0, 8)}.json`,
    );

    const mcpConfig = {
      mcpServers: {
        "code-agent-confirmation": {
          command: "node",
          args: [mcpServerPath],
          env: {
            CODE_AGENT_SOCKET_PATH: socketPath,
          },
        },
      },
    };

    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    args.push("--mcp-config", mcpConfigPath);

    const bin = findBinary("claude") || "claude";
    return {
      bin,
      args,
      stdinMode: "stream-json",
      prompt,
      sessionId: opts.sessionId,
      socketPath,
      mcpConfigPath,
    };
  },

  /**
   * Clean up temporary MCP config file.
   */
  cleanupSpawnConfig(spawnConfig) {
    if (spawnConfig?.mcpConfigPath) {
      try {
        fs.unlinkSync(spawnConfig.mcpConfigPath);
      } catch {}
    }
  },

  parseLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }

    switch (event.type) {
      case "system":
        if (event.subtype === "init" && event.session_id) {
          return {
            type: "session_init",
            data: { sessionId: event.session_id },
          };
        }
        if (event.subtype === "status" && event.status === "compacting") {
          return { type: "thinking", data: { text: "" } };
        }
        return null;

      case "assistant": {
        const content = event.message?.content;
        if (!Array.isArray(content)) return null;
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            return { type: "thinking", data: { text: block.thinking } };
          }
          if (block.type === "text" && block.text) {
            return { type: "text", data: { text: block.text } };
          }
          if (block.type === "tool_use") {
            const name = block.name || "unknown";
            const input = block.input || {};
            // Detect confirmation tool call
            if (name === "request_confirmation") {
              return {
                type: "confirmation_request",
                data: {
                  toolUseId: block.id,
                  question: input.question || "Confirm?",
                  level: input.level || "user",
                  tool: name,
                },
              };
            }

            const isFileChange = [
              "Write",
              "Edit",
              "create_file",
              "edit_file",
            ].includes(name);
            if (isFileChange) {
              return {
                type: "file_change",
                data: {
                  path: input.file_path || input.path || "",
                  action: name.toLowerCase().includes("write")
                    ? "write"
                    : "edit",
                  tool: name,
                },
              };
            }
            return {
              type: "tool_call",
              data: {
                tool: name,
                summary: summarizeToolCall(name, input),
                input,
              },
            };
          }
        }
        return null;
      }

      case "user": {
        const content = event.message?.content;
        if (!Array.isArray(content)) return null;
        for (const block of content) {
          if (block.type === "tool_result") {
            return {
              type: "tool_result",
              data: { tool: block.name || block.tool_use_id || "tool" },
            };
          }
        }
        return null;
      }

      case "result": {
        const subtype =
          typeof event.subtype === "string" ? event.subtype : "success";
        if (event.is_error || subtype !== "success") {
          const errors = Array.isArray(event.errors) ? event.errors : [];
          const message =
            errors.filter((e) => typeof e === "string").join(" | ") ||
            event.result ||
            "Execution failed";
          return { type: "error", data: { message, subtype } };
        }
        return {
          type: "result",
          data: { text: event.result || "", sessionId: event.session_id },
        };
      }

      default:
        return null;
    }
  },

  getSummary(steps) {
    const textSteps = steps.filter((s) => s.type === "text");
    const fileChanges = steps.filter((s) => s.type === "file_change");
    const toolCalls = steps.filter((s) => s.type === "tool_call");
    const resultStep = steps.find((s) => s.type === "result");
    const errorStep = steps.find((s) => s.type === "error");
    return {
      text:
        resultStep?.data?.text ||
        textSteps.map((s) => s.data?.text || "").join("\n"),
      fileChanges: fileChanges.map((s) => s.data?.path),
      toolCallCount: toolCalls.length,
      sessionId: resultStep?.data?.sessionId || null,
      error: errorStep?.data || null,
    };
  },
};

function summarizeToolCall(name, input) {
  if (name === "Read" || name === "read_file")
    return `Reading ${input.file_path || input.path || "file"}`;
  if (name === "Write" || name === "write_file")
    return `Writing ${input.file_path || input.path || "file"}`;
  if (name === "Edit" || name === "edit_file")
    return `Editing ${input.file_path || input.path || "file"}`;
  if (name === "Bash" || name === "shell")
    return `Running: ${(input.command || "").slice(0, 80)}`;
  if (name === "Glob") return `Searching: ${input.pattern || ""}`;
  if (name === "Grep") return `Grepping: ${input.pattern || ""}`;
  if (name === "mcp__chat__web_search")
    return `Web search: ${input.query || ""}`;
  return name;
}
