/**
 * plugins/code-agent/lib/task-store.js
 *
 * In-memory task store with debounced JSON persistence.
 * Simplified from image-gen TaskStore pattern.
 */
import fs from "node:fs";
import path from "node:path";

export class TaskStore {
  constructor(dataDir) {
    this._tasks = new Map();
    this._persistPath = path.join(dataDir, "tasks.json");
    this._dirty = false;
    this._flushTimer = null;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._persistPath, "utf-8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (t.taskId) this._tasks.set(t.taskId, t);
        }
      }
    } catch {
      // No existing data or corrupt file — start fresh
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
    try {
      const arr = [...this._tasks.values()];
      fs.writeFileSync(this._persistPath, JSON.stringify(arr, null, 2), "utf-8");
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
