/**
 * plugins/code-agent/index.js
 *
 * Code Agent plugin lifecycle. Registers bus handlers, task abort handler,
 * and manages plugin resources.
 */
import { AdapterRegistry } from "./lib/adapter-registry.js";
import { TaskStore } from "./lib/task-store.js";
import { claudeAdapter } from "./lib/adapters/claude.js";
import { codexAdapter } from "./lib/adapters/codex.js";

export default class CodeAgentPlugin {
  async onload() {
    const { dataDir, bus, log } = this.ctx;

    // Infrastructure
    const registry = new AdapterRegistry();
    const store = new TaskStore(dataDir);

    // Built-in adapters
    registry.register(claudeAdapter);
    registry.register(codexAdapter);

    // Track running processes for abort
    const processes = new Map();

    // Attach to ctx for tool access
    this.ctx._codeAgent = { registry, store, processes };

    // Bus handlers — adapter registration (for external plugins)
    this.register(bus.handle("code-agent:register-adapter", ({ adapter }) => {
      if (!adapter?.id) return { ok: false, error: "adapter.id is required" };
      registry.register(adapter);
      log.info(`adapter registered: ${adapter.id}`);
      return { ok: true };
    }));

    this.register(bus.handle("code-agent:unregister-adapter", ({ adapterId }) => {
      registry.unregister(adapterId);
      log.info(`adapter unregistered: ${adapterId}`);
      return { ok: true };
    }));

    this.register(bus.handle("code-agent:list-adapters", () => {
      return { adapters: registry.list().map((a) => ({ id: a.id, name: a.name })) };
    }));

    // Bus handlers — task queries
    this.register(bus.handle("code-agent:list-tasks", ({ status } = {}) => {
      const tasks = status ? store.listByStatus(status) : store.listAll();
      return { tasks };
    }));

    this.register(bus.handle("code-agent:get-task", ({ taskId }) => {
      return { task: store.get(taskId) };
    }));

    // Register task abort handler for TaskRegistry integration
    bus.request("task:register-handler", {
      type: "cli-execution",
      abort: (taskId) => {
        const proc = processes.get(taskId);
        if (proc) proc.abort();
        store.update(taskId, { status: "aborted", completedAt: new Date().toISOString() });
        bus.request("deferred:abort", { taskId, reason: "user cancelled" }).catch(() => {});
        bus.request("task:remove", { taskId }).catch(() => {});
        processes.delete(taskId);
      },
    }).catch(() => {});

    // Cleanup
    this.register(() => {
      // Kill all running processes
      for (const [, proc] of processes) {
        proc.abort();
      }
      processes.clear();
      store.destroy();
      bus.request("task:unregister-handler", { type: "cli-execution" }).catch(() => {});
      log.info("code-agent plugin unloaded");
    });

    log.info("code-agent plugin loaded");
  }
}
