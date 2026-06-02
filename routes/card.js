/**
 * code-agent/routes/card.js
 *
 * Serves the iframe HTML page for task progress display.
 * TaskId is read from URL query by the client-side JS.
 */
import fs from "fs";
import path from "path";

export default function (app, ctx) {
  const cardPath = path.join(ctx.pluginDir, "public", "task-card.html");

  app.get("/card/task", (c) => {
    const html = fs.readFileSync(cardPath, "utf-8");
    return c.html(html);
  });
}
