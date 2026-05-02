'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Response helpers ──────────────────────────────────────────────────────────

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function notFound(res) { send(res, 404, { error: 'Not found' }); }

function parseBody(req, res, cb) {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try { cb(JSON.parse(raw || '{}')); }
    catch (err) { send(res, 400, { error: 'Invalid JSON' }); }
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Serve UI
  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
    send(res, 200, html.toString(), 'text/html; charset=utf-8');
    return;
  }

  // API routes
  try {
    // POST /api/tasks — create task
    if (p === '/api/tasks' && req.method === 'POST') {
      parseBody(req, res, ({ title, description, priority, project_id, assignees, created_by }) => {
        if (!title?.trim()) { send(res, 400, { error: 'title is required' }); return; }
        const task = db.addTask({ title: title.trim(), description, priority, project_id, assignees: assignees || [], created_by });
        send(res, 201, task);
      });
      return;
    }

    // GET /api/tasks
    if (p === '/api/tasks' && req.method === 'GET') {
      const filters = {};
      const status   = url.searchParams.get('status');
      const assignee = url.searchParams.get('assignee');
      const project  = url.searchParams.get('project');

      if (status) filters.status = status;
      if (assignee) {
        const user = db.getUserByNameOrId(assignee);
        if (user) filters.assigneeId = user.id;
      }
      if (project) {
        const proj = db.getProjectByNameOrId(project);
        if (proj) filters.projectId = proj.id;
      }
      send(res, 200, db.getTasks(filters));
      return;
    }

    // POST /api/tasks/:id/comments
    const commentMatch = p.match(/^\/api\/tasks\/(.+)\/comments$/);
    if (commentMatch && req.method === 'POST') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        try {
          const { author_id, body } = JSON.parse(raw);
          if (!body?.trim()) { send(res, 400, { error: 'body is required' }); return; }
          const task = db.getTaskByIdOrSuffix(commentMatch[1]);
          if (!task) { notFound(res); return; }
          const comment = db.addComment({ task_id: task.id, author_id: author_id || null, body: body.trim() });
          send(res, 201, comment);
        } catch (err) {
          send(res, 500, { error: err.message });
        }
      });
      return;
    }

    // GET | PATCH | DELETE /api/tasks/:id
    const taskMatch = p.match(/^\/api\/tasks\/(.+)$/);
    if (taskMatch) {
      const id = taskMatch[1];
      if (req.method === 'GET') {
        const task = db.getTask(id);
        if (!task) { notFound(res); return; }
        send(res, 200, task);
      } else if (req.method === 'PATCH') {
        parseBody(req, res, ({ title, description, status, priority, notes, project_id, assignees }) => {
          const task = db.updateTask(id, { title, description, status, priority, notes, project_id });
          if (!task) { notFound(res); return; }
          if (assignees !== undefined) db.setAssignees(task.id, assignees);
          send(res, 200, db.getTask(task.id));
        });
      } else if (req.method === 'DELETE') {
        const ok = db.deleteTask(id);
        if (!ok) { notFound(res); return; }
        send(res, 200, { ok: true });
      } else {
        send(res, 405, { error: 'Method not allowed' });
      }
      return;
    }

    // GET /api/users
    if (p === '/api/users') {
      send(res, 200, db.getUsers());
      return;
    }

    // GET /api/projects
    if (p === '/api/projects') {
      send(res, 200, db.getProjects());
      return;
    }

    // GET /api/poll?assignee=<nameOrId>[&project=<nameOrId>]
    if (p === '/api/poll' && req.method === 'GET') {
      const agentName = url.searchParams.get('assignee');
      if (!agentName) { send(res, 400, { error: 'assignee is required' }); return; }
      const agent = db.getUserByNameOrId(agentName);
      if (!agent) { send(res, 404, { error: `Agent not found: ${agentName}` }); return; }
      const projectParam = url.searchParams.get('project');
      let projectId = null;
      if (projectParam) {
        const proj = db.getProjectByNameOrId(projectParam);
        if (proj) projectId = proj.id;
      }
      send(res, 200, db.getActionableTasks(agent.id, projectId));
      return;
    }

    // GET /api/activity
    if (p === '/api/activity') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      send(res, 200, db.getRecentActivity(limit));
      return;
    }

    notFound(res);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Kian UI  →  http://localhost:${PORT}`);
});
