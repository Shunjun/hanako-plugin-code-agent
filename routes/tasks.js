/**
 * code-agent/routes/tasks.js
 *
 * REST API for task data. Used by card iframe for polling progress.
 */

export default function (app, ctx) {
  const store = () => ctx._codeAgent?.store;

  // Get task by ID
  app.get("/tasks/:taskId", (c) => {
    const s = store();
    if (!s) return c.json({ error: "not initialized" }, 503);
    const task = s.get(c.req.param("taskId"));
    if (!task) return c.json({ error: "not found" }, 404);
    return c.json({ task });
  });

  // List tasks
  app.get("/tasks", (c) => {
    const s = store();
    if (!s) return c.json({ error: "not initialized" }, 503);
    const status = c.req.query("status");
    const tasks = status ? s.listByStatus(status) : s.listAll();
    return c.json({ tasks });
  });

  // Abort task
  app.post("/tasks/:taskId/abort", (c) => {
    const s = store();
    if (!s) return c.json({ error: "not initialized" }, 503);
    const taskId = c.req.param("taskId");
    const task = s.get(taskId);
    if (!task) return c.json({ error: "not found" }, 404);
    if (task.status !== "pending" && task.status !== "running") {
      return c.json({ error: `Task is already ${task.status}` }, 400);
    }
    const processes = ctx._codeAgent?.processes;
    if (processes) {
      const proc = processes.get(taskId);
      if (proc) proc.abort();
      processes.delete(taskId);
    }
    s.update(taskId, { status: "aborted", completedAt: new Date().toISOString() });
    return c.json({ ok: true });
  });

  // Confirm/reject a pending confirmation
  app.post("/confirm", async (c) => {
    const s = store();
    if (!s) return c.json({ error: "not initialized" }, 503);

    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    const { taskId, confirmationId, approved } = body;
    if (!taskId || !confirmationId || typeof approved !== "boolean") {
      return c.json({ error: "taskId, confirmationId, and approved are required" }, 400);
    }

    const task = s.get(taskId);
    if (!task) return c.json({ error: "task not found" }, 404);

    const confirmation = (task.confirmations || []).find(
      (conf) => conf.confirmationId === confirmationId,
    );
    if (!confirmation) return c.json({ error: "confirmation not found" }, 404);
    if (confirmation.status !== "pending") {
      return c.json({ error: `confirmation already ${confirmation.status}` }, 400);
    }

    // Resolve on the process if alive
    const processes = ctx._codeAgent?.processes;
    const proc = processes?.get(taskId);
    if (proc) {
      proc.resolveConfirmation(confirmationId, approved, body.message || "");
    } else {
      // Process dead — just update the store
      s.updateConfirmation(taskId, confirmationId, {
        status: approved ? "confirmed" : "rejected",
        resolvedAt: new Date().toISOString(),
        approved,
        responseMessage: body.message || "",
      });
    }

    return c.json({ ok: true });
  });
}
