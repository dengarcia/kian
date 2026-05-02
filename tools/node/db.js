'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../../db/kian.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  applySchema(_db);
  return _db;
}

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL CHECK(type IN ('human', 'agent')),
      email      TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'todo',
      priority    TEXT NOT NULL DEFAULT 'medium',
      project_id  TEXT REFERENCES projects(id),
      created_by  TEXT REFERENCES users(id),
      notes       TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id TEXT NOT NULL REFERENCES tasks(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id),
      author_id  TEXT REFERENCES users(id),
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

function getUserByNameOrId(nameOrId) {
  if (!nameOrId) return null;
  const db = getDb();
  const needle = nameOrId.toLowerCase();
  return (
    db.prepare('SELECT * FROM users WHERE id = ? OR LOWER(name) = ?').get(nameOrId, needle) ||
    db.prepare('SELECT * FROM users WHERE LOWER(name) LIKE ?').get(`%${needle}%`) ||
    null
  );
}

function getProjectByNameOrId(nameOrId) {
  if (!nameOrId) return null;
  const db = getDb();
  const needle = nameOrId.toLowerCase();
  return (
    db.prepare('SELECT * FROM projects WHERE id = ? OR LOWER(name) = ?').get(nameOrId, needle) ||
    db.prepare('SELECT * FROM projects WHERE LOWER(name) LIKE ?').get(`%${needle}%`) ||
    null
  );
}

function getTaskByIdOrSuffix(idOrSuffix) {
  if (!idOrSuffix) return null;
  return getDb().prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(idOrSuffix, `%${idOrSuffix}`) || null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function withAssignees(db, tasks) {
  const stmt = db.prepare(`
    SELECT u.id, u.name, u.type
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id = ?
  `);
  return tasks.map(t => ({ ...t, assignees: stmt.all(t.id) }));
}

// ── Users ─────────────────────────────────────────────────────────────────────

function getUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY name').all();
}

function addUser({ name, type = 'human', email = null }) {
  const db = getDb();
  const user = { id: newId('usr'), name, type, email, created_at: now() };
  db.prepare('INSERT INTO users (id, name, type, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
    user.id, user.name, user.type, user.email, user.created_at
  );
  return user;
}

// ── Projects ──────────────────────────────────────────────────────────────────

function getProjects() {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY name').all().map(p => ({
    ...p,
    active_task_count: db.prepare(
      "SELECT COUNT(*) as n FROM tasks WHERE project_id = ? AND status NOT IN ('done','cancelled')"
    ).get(p.id).n,
  }));
}

function addProject({ name, description = null }) {
  const db = getDb();
  const project = { id: newId('prj'), name, description, created_at: now() };
  db.prepare('INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
    project.id, project.name, project.description, project.created_at
  );
  return project;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

function getTasks(filters = {}) {
  const db = getDb();
  const where = [];
  const params = [];

  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  } else {
    where.push("t.status NOT IN ('done', 'cancelled')");
  }
  if (filters.projectId) {
    where.push('t.project_id = ?');
    params.push(filters.projectId);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  let tasks = db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    ${whereClause}
    ORDER BY
      CASE t.status
        WHEN 'in_progress'         THEN 0
        WHEN 'needs_clarification' THEN 1
        WHEN 'review'              THEN 2
        WHEN 'blocked'             THEN 3
        WHEN 'todo'                THEN 4
        ELSE 5
      END,
      CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      t.updated_at DESC
  `).all(...params);

  tasks = withAssignees(db, tasks);

  if (filters.assigneeId) {
    tasks = tasks.filter(t => t.assignees.some(a => a.id === filters.assigneeId));
  }

  return tasks;
}

function getTask(idOrSuffix) {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = ? OR t.id LIKE ?
  `).get(idOrSuffix, `%${idOrSuffix}`);

  if (!row) return null;

  const task = withAssignees(db, [row])[0];

  task.comments = db.prepare(`
    SELECT c.*, u.name AS author_name, u.type AS author_type
    FROM comments c
    LEFT JOIN users u ON u.id = c.author_id
    WHERE c.task_id = ?
    ORDER BY c.created_at ASC
  `).all(task.id);

  return task;
}

function addTask({ title, description = null, priority = 'medium', project_id = null, assignees = [], created_by = null }) {
  const db = getDb();
  const task = {
    id: newId('tsk'), title, description, status: 'todo', priority,
    project_id, created_by, notes: null, created_at: now(), updated_at: now(),
  };

  db.prepare(`
    INSERT INTO tasks (id, title, description, status, priority, project_id, created_by, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, task.title, task.description, task.status, task.priority, task.project_id, task.created_by, task.notes, task.created_at, task.updated_at);

  const insertAssignee = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)');
  for (const uid of assignees) insertAssignee.run(task.id, uid);

  return task;
}

function updateTask(idOrSuffix, fields) {
  const db = getDb();
  const task = getTaskByIdOrSuffix(idOrSuffix);
  if (!task) return null;

  const allowed = ['status', 'title', 'description', 'priority', 'notes', 'project_id'];
  const updates = {};
  for (const k of allowed) {
    if (fields[k] !== undefined) updates[k] = fields[k];
  }
  if (!Object.keys(updates).length) return task;

  updates.updated_at = now();
  const set = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${set} WHERE id = ?`).run(...Object.values(updates), task.id);

  return { ...task, ...updates };
}

function assignUser(idOrSuffix, userId) {
  const db = getDb();
  const task = getTaskByIdOrSuffix(idOrSuffix);
  if (!task) return null;
  db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(task.id, userId);
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now(), task.id);
  return task;
}

// ── Comments ──────────────────────────────────────────────────────────────────

function addComment({ task_id, author_id, body }) {
  const db = getDb();
  const comment = { id: newId('cmt'), task_id, author_id, body, created_at: now() };
  db.prepare('INSERT INTO comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
    comment.id, comment.task_id, comment.author_id, comment.body, comment.created_at
  );
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(comment.created_at, task_id);
  return comment;
}

// ── Poll ──────────────────────────────────────────────────────────────────────

function getActionableTasks(agentId) {
  const db = getDb();
  const candidates = db.prepare(`
    SELECT t.*
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id
    WHERE ta.user_id = ? AND t.status IN ('todo', 'in_progress', 'needs_clarification')
    ORDER BY
      CASE t.status WHEN 'in_progress' THEN 0 ELSE 1 END,
      CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
  `).all(agentId);

  return candidates.filter(task => {
    if (task.status !== 'needs_clarification') return true;

    const comments = db.prepare(
      'SELECT author_id FROM comments WHERE task_id = ? ORDER BY created_at ASC'
    ).all(task.id);

    const lastAgentIdx = comments.map(c => c.author_id).lastIndexOf(agentId);
    if (lastAgentIdx === -1) return false;

    return comments.slice(lastAgentIdx + 1).some(c => c.author_id !== agentId);
  });
}

// ── Activity ──────────────────────────────────────────────────────────────────

function getRecentActivity(limit = 50) {
  return getDb().prepare(`
    SELECT c.id, c.body, c.created_at, c.task_id,
           u.name AS author_name, u.type AS author_type,
           t.title AS task_title, t.status AS task_status
    FROM comments c
    LEFT JOIN users u ON u.id = c.author_id
    JOIN tasks t ON t.id = c.task_id
    ORDER BY c.created_at DESC
    LIMIT ?
  `).all(limit);
}

// ── Seed ─────────────────────────────────────────────────────────────────────

function seed(data) {
  const db = getDb();

  db.transaction(() => {
    for (const u of data.users || []) {
      db.prepare('INSERT OR REPLACE INTO users (id, name, type, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
        u.id, u.name, u.type, u.email || null, u.created_at
      );
    }
    for (const p of data.projects || []) {
      db.prepare('INSERT OR REPLACE INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
        p.id, p.name, p.description || null, p.created_at
      );
    }
    for (const t of data.tasks || []) {
      db.prepare(`
        INSERT OR REPLACE INTO tasks (id, title, description, status, priority, project_id, created_by, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(t.id, t.title, t.description || null, t.status, t.priority, t.project_id || null, t.created_by || null, t.notes || null, t.created_at, t.updated_at);
      for (const uid of t.assignees || []) {
        db.prepare('INSERT OR REPLACE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(t.id, uid);
      }
    }
    for (const c of data.comments || []) {
      db.prepare('INSERT OR REPLACE INTO comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
        c.id, c.task_id, c.author_id || null, c.body, c.created_at
      );
    }
  })();

  return {
    users: (data.users || []).length,
    projects: (data.projects || []).length,
    tasks: (data.tasks || []).length,
    comments: (data.comments || []).length,
  };
}

function setAssignees(taskId, userIds) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
    const insert = db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
    for (const uid of userIds) insert.run(taskId, uid);
  })();
}

function deleteTask(idOrSuffix) {
  const db = getDb();
  const task = getTaskByIdOrSuffix(idOrSuffix);
  if (!task) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM comments WHERE task_id = ?').run(task.id);
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(task.id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  })();
  return true;
}

module.exports = {
  getUserByNameOrId,
  getProjectByNameOrId,
  getTaskByIdOrSuffix,
  getUsers,
  addUser,
  getProjects,
  addProject,
  getTasks,
  getTask,
  addTask,
  updateTask,
  assignUser,
  setAssignees,
  deleteTask,
  addComment,
  getActionableTasks,
  getRecentActivity,
  seed,
};
