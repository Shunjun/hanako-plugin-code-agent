/**
 * plugins/code-agent/lib/task-store.js
 *
 * Task store with per-task file persistence.
 * - tasks/index.json — lightweight index (taskId, status, timestamps)
 * - tasks/{taskId}.json — full task data including steps
 */
import fs from "node:fs";
import path from "node:path";

export class TaskStore {
  constructor(dataDir) {
    this._tasks = new Map();
    this._dir = path.join(dataDir, "tasks");
    this._indexPath = path.join(this._dir, "index.json");
    this._dirty = false;
    this._flushTimer = null;
    this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(this._dir)) fs.mkdirSync(this._dir, { recursive: true });
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._indexPath, "utf-8");
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (!entry.taskId) continue;
        // Load full task from individual file
        const taskPath = path.join(this._dir, `${entry.taskId}.json`);
        try {
          const taskRaw = fs.readFileSync(taskPath, "utf-8");
          this._tasks.set(entry.taskId, JSON.parse(taskRaw));
        } catch {
          // Task file missing — use index entry as minimal task
          this._tasks.set(entry.taskId, entry);
        }
      }
    } catch {
      // No existing data — start fresh
    }
  }

  _scheduleFlush() {
    if (this._flushTimer) return;
    this._dirty = true;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flush();
    }, 1000);
  }

  _flush() {
    if (!this._dirty) return;
    this._dirty = false;
    this._ensureDir();

    // Write individual task files
    for (const [taskId, task] of this._tasks) {
      try {
        const taskPath = path.join(this._dir, `${taskId}.json`);
        fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), "utf-8");
      } catch {
        // Best effort per task
      }
    }

    // Write lightweight index
    try {
      const index = [...this._tasks.values()].map((t) => ({
        taskId: t.taskId,
        tool: t.tool,
        prompt: t.prompt,
        cwd: t.cwd,
        sessionPath: t.sessionPath,
        status: t.status,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      }));
      fs.writeFileSync(this._indexPath, JSON.stringify(index, null, 2), "utf-8");
    } catch {
      // Best effort
    }
  }

  add(task) {
    this._tasks.set(task.taskId, task);
    this._scheduleFlush();
  }

  get(taskId) {
    return this._tasks.get(taskId) || null;
  }

  update(taskId, patch) {
    const task = this._tasks.get(taskId);
    if (!task) return null;
    Object.assign(task, patch);
    this._scheduleFlush();
    return task;
  }

  addStep(taskId, event) {
    const task = this._tasks.get(taskId);
    if (!task) return;
    if (!Array.isArray(task.steps)) task.steps = [];
    task.steps.push({ ...event, timestamp: Date.now() });
    this._scheduleFlush();
  }

  remove(taskId) {
    this._tasks.delete(taskId);
    // Delete individual task file
    try {
      const taskPath = path.join(this._dir, `${taskId}.json`);
      fs.unlinkSync(taskPath);
    } catch {}
    this._scheduleFlush();
  }

  listAll() {
    return [...this._tasks.values()];
  }

  listByStatus(status) {
    return [...this._tasks.values()].filter((t) => t.status === status);
  }

  listRunning() {
    return [...this._tasks.values()].filter(
      (t) => t.status === "pending" || t.status === "running",
    );
  }

  destroy() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._flush();
  }
}
