/**
 * code-agent/routes/card.js
 *
 * Serves the iframe HTML page for task progress display.
 * The iframe polls /tasks/:taskId for real-time updates.
 */

export default function (app) {
  app.get("/card/task", (c) => {
    const taskId = c.req.query("taskId");
    if (!taskId) return c.text("Missing taskId", 400);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    color: var(--hana-text, #e0e0e0);
    background: var(--hana-bg, #1a1a2e);
    padding: 12px;
    overflow-x: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.running { background: #4ade80; animation: pulse 1.5s infinite; }
  .status-dot.done { background: #60a5fa; }
  .status-dot.failed { background: #f87171; }
  .status-dot.pending { background: #9ca3af; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    color: var(--hana-text-secondary, #9ca3af);
    font-size: 12px;
    margin-bottom: 8px;
  }
  .steps {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--hana-border, #333);
    border-radius: 6px;
    background: var(--hana-bg-secondary, #111);
  }
  .step {
    padding: 6px 10px;
    border-bottom: 1px solid var(--hana-border, #333);
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .step:last-child { border-bottom: none; }
  .step-icon { flex-shrink: 0; width: 16px; text-align: center; }
  .step-text { flex: 1; word-break: break-all; }
  .step-time {
    color: var(--hana-text-secondary, #666);
    font-size: 11px;
    flex-shrink: 0;
  }
  .result {
    margin-top: 8px;
    padding: 10px;
    border-radius: 6px;
    background: var(--hana-bg-secondary, #111);
    border: 1px solid var(--hana-border, #333);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    font-size: 12px;
  }
  .error { color: #f87171; }
  .summary { margin-top: 8px; font-size: 12px; color: var(--hana-text-secondary, #9ca3af); }
</style>
</head>
<body>
  <div class="header">
    <div class="status-dot pending" id="dot"></div>
    <div class="title" id="title">Loading...</div>
  </div>
  <div class="meta" id="meta"></div>
  <div class="steps" id="steps"></div>
  <div class="result" id="result" style="display:none"></div>
  <div class="summary" id="summary"></div>
<script>
(function() {
  const taskId = ${JSON.stringify(taskId)};
  const dot = document.getElementById('dot');
  const title = document.getElementById('title');
  const meta = document.getElementById('meta');
  const stepsEl = document.getElementById('steps');
  const resultEl = document.getElementById('result');
  const summaryEl = document.getElementById('summary');
  let lastStepCount = 0;

  function iconForType(type) {
    switch(type) {
      case 'thinking': return '\\u{1F9E0}';
      case 'tool_call': return '\\u{1F527}';
      case 'tool_result': return '\\u{2705}';
      case 'file_change': return '\\u{1F4DD}';
      case 'text': return '\\u{1F4AC}';
      case 'session_init': return '\\u{1F680}';
      case 'error': return '\\u{274C}';
      case 'result': return '\\u{1F3C1}';
      default: return '\\u{2022}';
    }
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return Math.round(ms/1000) + 's';
    return Math.round(ms/60000) + 'm';
  }

  function renderSteps(steps) {
    if (!steps || steps.length === lastStepCount) return;
    lastStepCount = steps.length;
    const recent = steps.slice(-20);
    stepsEl.innerHTML = recent.map(s => {
      const data = s.data || {};
      let text = '';
      if (s.type === 'tool_call') text = data.summary || data.tool || '';
      else if (s.type === 'file_change') text = (data.action === 'write' ? 'Created: ' : 'Modified: ') + (data.path || '');
      else if (s.type === 'thinking') text = 'Thinking...';
      else if (s.type === 'text') text = (data.text || '').slice(0, 120);
      else if (s.type === 'result') text = 'Done';
      else if (s.type === 'error') text = data.message || 'Error';
      else text = s.type || '';
      return '<div class="step"><span class="step-icon">' + iconForType(s.type) + '</span>'
        + '<span class="step-text">' + text.replace(/</g,'&lt;') + '</span>'
        + '<span class="step-time">' + timeAgo(s.ts) + '</span></div>';
    }).join('');
    stepsEl.scrollTop = stepsEl.scrollHeight;
  }

  function update(task) {
    if (!task) return;
    dot.className = 'status-dot ' + (task.status || 'pending');
    title.textContent = task.tool + ': ' + (task.prompt || '').slice(0, 60);
    const elapsed = task.createdAt ? timeAgo(task.createdAt) : '';
    meta.textContent = (task.cwd || '') + (elapsed ? ' \\u00b7 ' + elapsed + ' ago' : '');
    renderSteps(task.steps);
    if (task.status === 'done' && task.result) {
      resultEl.style.display = 'block';
      resultEl.textContent = task.result.text || JSON.stringify(task.result, null, 2);
      summaryEl.textContent = task.result.fileChanges?.length
        ? task.result.fileChanges.length + ' file(s) modified, ' + (task.result.toolCallCount || 0) + ' tool calls'
        : (task.result.toolCallCount || 0) + ' tool calls';
    } else if (task.status === 'failed' && task.error) {
      resultEl.style.display = 'block';
      resultEl.className = 'result error';
      resultEl.textContent = task.error.message || 'Failed';
    }
    if (task.status === 'running' || task.status === 'pending') {
      setTimeout(poll, 1500);
    }
  }

  // Extract auth token from iframe URL (hanaUrl injects ?token=xxx)
  const urlParams = new URLSearchParams(window.location.search);
  const authToken = urlParams.get('token') || '';

  function poll() {
    const url = '/api/plugins/code-agent/tasks/' + encodeURIComponent(taskId)
      + (authToken ? '?token=' + encodeURIComponent(authToken) : '');
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.task) update(d.task); else setTimeout(poll, 3000); })
      .catch(() => setTimeout(poll, 3000));
  }

  // Notify parent we're ready
  window.parent.postMessage({ type: 'ready' }, '*');
  poll();
})();
</script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}
