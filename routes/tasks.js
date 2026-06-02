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
}
