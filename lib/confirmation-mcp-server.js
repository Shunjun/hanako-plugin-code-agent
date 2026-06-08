#!/usr/bin/env node
/**
 * confirmation-mcp-server.js
 *
 * Lightweight MCP server (stdio mode) that provides the `request_confirmation` tool.
 * When Claude calls this tool, the server notifies the plugin via Unix socket
 * and waits for the plugin to send back the user's response.
 *
 * Communication with plugin: Unix socket at CODE_AGENT_SOCKET_PATH
 */

import { createConnection } from "node:net";

const SOCKET_PATH = process.env.CODE_AGENT_SOCKET_PATH;
if (!SOCKET_PATH) {
  process.stderr.write("CODE_AGENT_SOCKET_PATH not set\n");
  process.exit(1);
}

const TOOL_DEFINITION = {
  name: "request_confirmation",
  description:
    "Request confirmation from the user before performing a potentially dangerous or irreversible action. " +
    "Use this when you need explicit approval before proceeding.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user for confirmation",
      },
      level: {
        type: "string",
        enum: ["agent", "user"],
        description:
          '"agent" = the parent agent can decide autonomously; "user" = requires explicit user confirmation',
      },
    },
    required: ["question"],
  },
};

// ── MCP protocol handlers ──

function handleInitialize(_params) {
  return {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "code-agent-confirmation", version: "0.1.0" },
  };
}

function handleToolsList() {
  return { tools: [TOOL_DEFINITION] };
}

async function handleToolsCall(params) {
  if (params.name !== "request_confirmation") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${params.name}` }],
      isError: true,
    };
  }

  const question = params.arguments?.question || "Confirm?";
  const level = params.arguments?.level || "user";

  try {
    const result = await requestConfirmationViaSocket({ question, level });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Confirmation failed: ${err.message}` }],
      isError: true,
    };
  }
}

// ── Socket communication with plugin ──

function requestConfirmationViaSocket(payload) {
  return new Promise((resolve, reject) => {
    const conn = createConnection(SOCKET_PATH);

    conn.on("connect", () => {
      conn.write(
        JSON.stringify({ type: "confirmation_request", ...payload }) + "\n",
      );
    });

    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "confirmation_response") {
            conn.destroy();
            resolve({ approved: msg.approved, message: msg.message || "" });
            return;
          }
        } catch {
          // ignore malformed lines
        }
      }
    });

    conn.on("error", (err) => {
      reject(new Error(`Socket error: ${err.message}`));
    });

    // Timeout after 5 minutes (the plugin has its own 30s window)
    setTimeout(
      () => {
        conn.destroy();
        reject(new Error("Confirmation socket timeout"));
      },
      5 * 60 * 1000,
    );
  });
}

// ── Stdio JSON-RPC transport ──

let stdinBuf = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  stdinBuf += chunk;
  const lines = stdinBuf.split("\n");
  stdinBuf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    processLine(line);
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

async function processLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = request;

  try {
    let result;
    switch (method) {
      case "initialize":
        result = handleInitialize(params);
        break;
      case "notifications/initialized":
        return; // no response needed
      case "tools/list":
        result = handleToolsList();
        break;
      case "tools/call":
        result = await handleToolsCall(params);
        break;
      default:
        sendError(id, -32601, `Method not found: ${method}`);
        return;
    }
    sendResult(id, result);
  } catch (err) {
    sendError(id, -32000, err.message);
  }
}

function sendResult(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id, code, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
  );
}
