#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DB_PATH = path.join(__dirname, '../../db/db.json');
const AGENT_NAME = process.env.AGENT_NAME || 'Kian';

// ── Database ──────────────────────────────────────────────────────────────────

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}`);
    console.error('Copy db.example.json to db/db.json to get started.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

function resolveUser(db, nameOrId) {
  if (!nameOrId) return null;
  const needle = nameOrId.toLowerCase();
  return db.users.find(u =>
    u.id === nameOrId ||
    u.name.toLowerCase() === needle ||
    u.name.toLowerCase().includes(needle)
  ) || null;
}

function resolveProject(db, nameOrId) {
  if (!nameOrId) return null;
  const needle = nameOrId.toLowerCase();
  return db.projects.find(p =>
    p.id === nameOrId ||
    p.name.toLowerCase() === needle ||
    p.name.toLowerCase().includes(needle)
  ) || null;
}

function resolveTask(db, idOrSuffix) {
  if (!idOrSuffix) return null;
  return db.tasks.find(t => t.id === idOrSuffix || t.id.endsWith(idOrSuffix)) || null;
}

function getUserName(db, userId) {
  return db.users.find(u => u.id === userId)?.name || userId;
}

function getProjectName(db, projectId) {
  if (!projectId) return null;
  return db.projects.find(p => p.id === projectId)?.name || projectId;
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      flags[key] = (next && !next.startsWith('--')) ? argv[++i] : true;
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, flags };
}

// ── Display ───────────────────────────────────────────────────────────────────

const STATUS_ICON = {
  todo:                '○',
  in_progress:         '◑',
  needs_clarification: '?',
  review:              '◎',
  blocked:             '✗',
  done:                '✓',
  cancelled:           '—',
};

const PRIORITY_LABEL = { low: 'low', medium: 'med', high: 'HIGH' };

function printTask(db, task, { showComments = false } = {}) {
  const icon = STATUS_ICON[task.status] || '·';
  const assigneeNames = task.assignees.map(id => getUserName(db, id)).join(', ');
  const project = getProjectName(db, task.project_id);
  const priority = PRIORITY_LABEL[task.priority] || task.priority;
  const shortId = task.id.slice(-8);

  console.log(`\n  ${icon}  [${shortId}]  ${task.title}`);
  console.log(`     status: ${task.status}  |  priority: ${priority}${project ? `  |  project: ${project}` : ''}`);
  if (assigneeNames) console.log(`     assignees: ${assigneeNames}`);
  if (task.description) console.log(`     description: ${task.description}`);
  if (task.notes) console.log(`     notes: ${task.notes}`);

  if (showComments) {
    const taskComments = (db.comments || []).filter(c => c.task_id === task.id);
    if (taskComments.length > 0) {
      console.log(`     --- comments (${taskComments.length}) ---`);
      for (const c of taskComments) {
        const author = getUserName(db, c.author_id);
        const date = c.created_at.slice(0, 10);
        console.log(`     [${date}] ${author}: ${c.body}`);
      }
    }
  }
}

// ── Task commands ─────────────────────────────────────────────────────────────

const VALID_STATUSES = ['todo', 'in_progress', 'needs_clarification', 'review', 'blocked', 'done', 'cancelled'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

function cmdList(db, flags) {
  // By default, exclude done and cancelled. A --status flag overrides this.
  let tasks = flags.status
    ? db.tasks.filter(t => t.status === flags.status)
    : db.tasks.filter(t => !['done', 'cancelled'].includes(t.status));

  if (flags.assignee) {
    const user = resolveUser(db, flags.assignee);
    if (!user) { console.error(`User not found: ${flags.assignee}`); process.exit(1); }
    tasks = tasks.filter(t => t.assignees.includes(user.id));
  }

  if (flags.project) {
    const project = resolveProject(db, flags.project);
    if (!project) { console.error(`Project not found: ${flags.project}`); process.exit(1); }
    tasks = tasks.filter(t => t.project_id === project.id);
  }

  if (tasks.length === 0) { console.log('No tasks found.'); return; }

  const labelParts = [];
  if (flags.status) labelParts.push(`status: ${flags.status}`);
  if (flags.assignee) labelParts.push(`assignee: ${flags.assignee}`);
  if (flags.project) labelParts.push(`project: ${flags.project}`);
  const label = labelParts.length ? labelParts.join(', ') : 'all active';

  console.log(`\nTasks (${tasks.length}, ${label}):`);
  for (const task of tasks) printTask(db, task);
  console.log('');
}

function cmdGet(db, id) {
  if (!id) { console.error('Task ID required'); process.exit(1); }
  const task = resolveTask(db, id);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
  printTask(db, task, { showComments: true });
  console.log('');
}

function cmdAdd(db, flags) {
  if (!flags.title) { console.error('--title is required'); process.exit(1); }

  const assignees = [];
  if (flags.assignee) {
    const user = resolveUser(db, flags.assignee);
    if (!user) { console.error(`User not found: ${flags.assignee}`); process.exit(1); }
    assignees.push(user.id);
  }

  let project_id = null;
  if (flags.project) {
    const project = resolveProject(db, flags.project);
    if (!project) { console.error(`Project not found: ${flags.project}`); process.exit(1); }
    project_id = project.id;
  }

  let created_by = null;
  if (flags['created-by']) {
    const user = resolveUser(db, flags['created-by']);
    if (!user) { console.error(`User not found: ${flags['created-by']}`); process.exit(1); }
    created_by = user.id;
  }

  if (flags.priority && !VALID_PRIORITIES.includes(flags.priority)) {
    console.error(`Invalid priority. Valid values: ${VALID_PRIORITIES.join(', ')}`);
    process.exit(1);
  }

  const task = {
    id: newId('tsk'),
    title: flags.title,
    description: flags.description || null,
    status: 'todo',
    priority: flags.priority || 'medium',
    project_id,
    assignees,
    created_by,
    notes: null,
    created_at: now(),
    updated_at: now(),
  };

  db.tasks.push(task);
  saveDb(db);
  console.log(`Created: [${task.id.slice(-8)}] ${task.title}`);
}

function cmdUpdate(db, id, flags) {
  if (!id) { console.error('Task ID required'); process.exit(1); }
  const task = resolveTask(db, id);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }

  if (flags.status) {
    if (!VALID_STATUSES.includes(flags.status)) {
      console.error(`Invalid status. Valid values: ${VALID_STATUSES.join(', ')}`);
      process.exit(1);
    }
    task.status = flags.status;
  }
  if (flags.title !== undefined) task.title = flags.title;
  if (flags.description !== undefined) task.description = flags.description;
  if (flags.notes !== undefined) task.notes = flags.notes;
  if (flags.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(flags.priority)) {
      console.error(`Invalid priority. Valid values: ${VALID_PRIORITIES.join(', ')}`);
      process.exit(1);
    }
    task.priority = flags.priority;
  }

  task.updated_at = now();
  saveDb(db);
  console.log(`Updated: [${task.id.slice(-8)}] ${task.title}${flags.status ? `  ->  ${flags.status}` : ''}`);
}

function cmdAssign(db, id, flags) {
  if (!id || !flags.to) { console.error('Usage: tasks.js assign <task-id> --to <user>'); process.exit(1); }
  const task = resolveTask(db, id);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
  const user = resolveUser(db, flags.to);
  if (!user) { console.error(`User not found: ${flags.to}`); process.exit(1); }

  if (!task.assignees.includes(user.id)) {
    task.assignees.push(user.id);
    task.updated_at = now();
    saveDb(db);
  }
  console.log(`Assigned ${user.name} to [${task.id.slice(-8)}] ${task.title}`);
}

function cmdComment(db, id, flags) {
  if (!id || !flags.body) { console.error('Usage: tasks.js comment <task-id> --body "..."'); process.exit(1); }
  const task = resolveTask(db, id);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }

  // --author flag, or fall back to AGENT_NAME from .env
  const authorName = flags.author || AGENT_NAME;
  const user = resolveUser(db, authorName);

  if (!db.comments) db.comments = [];
  db.comments.push({
    id: newId('cmt'),
    task_id: task.id,
    author_id: user?.id || null,
    body: flags.body,
    created_at: now(),
  });
  task.updated_at = now();
  saveDb(db);
  console.log(`Comment added to [${task.id.slice(-8)}] ${task.title}`);
}

// ── User commands ─────────────────────────────────────────────────────────────

function cmdUsersList(db) {
  if (!db.users?.length) { console.log('No users.'); return; }
  console.log('\nUsers:\n');
  for (const u of db.users) {
    console.log(`  [${u.id.slice(-8)}]  ${u.name.padEnd(20)}  ${u.type}${u.email ? `  <${u.email}>` : ''}`);
  }
  console.log('');
}

function cmdUsersAdd(db, flags) {
  if (!flags.name) { console.error('--name is required'); process.exit(1); }
  if (flags.type && !['human', 'agent'].includes(flags.type)) {
    console.error('--type must be "human" or "agent"'); process.exit(1);
  }
  const user = {
    id: newId('usr'),
    name: flags.name,
    type: flags.type || 'human',
    email: flags.email || null,
    created_at: now(),
  };
  db.users.push(user);
  saveDb(db);
  console.log(`User created: [${user.id.slice(-8)}]  ${user.name}  (${user.type})`);
}

// ── Project commands ──────────────────────────────────────────────────────────

function cmdProjectsList(db) {
  if (!db.projects?.length) { console.log('No projects.'); return; }
  console.log('\nProjects:\n');
  for (const p of db.projects) {
    const active = db.tasks.filter(t => t.project_id === p.id && !['done', 'cancelled'].includes(t.status)).length;
    console.log(`  [${p.id.slice(-8)}]  ${p.name.padEnd(25)}  ${active} active tasks${p.description ? `  — ${p.description}` : ''}`);
  }
  console.log('');
}

function cmdProjectsAdd(db, flags) {
  if (!flags.name) { console.error('--name is required'); process.exit(1); }
  const project = {
    id: newId('prj'),
    name: flags.name,
    description: flags.description || null,
    created_at: now(),
  };
  db.projects.push(project);
  saveDb(db);
  console.log(`Project created: [${project.id.slice(-8)}]  ${project.name}`);
}

// ── Poll command ─────────────────────────────────────────────────────────────
//
// Evaluates whether the agent has actionable work without invoking an LLM.
// Exit 0 = work to do (caller should invoke the agent).
// Exit 1 = nothing to do.

function cmdPoll(db, flags) {
  const agentName = flags.assignee || AGENT_NAME;
  const agent = resolveUser(db, agentName);
  if (!agent) { console.error(`Agent user not found: ${agentName}`); process.exit(2); }

  const comments = db.comments || [];
  const actionable = [];

  const candidates = db.tasks.filter(t =>
    t.assignees.includes(agent.id) &&
    ['todo', 'in_progress', 'needs_clarification'].includes(t.status)
  );

  for (const task of candidates) {
    if (task.status === 'needs_clarification') {
      // Only actionable if a human replied after the agent's last comment
      const taskComments = comments
        .filter(c => c.task_id === task.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      const lastAgentCommentIdx = taskComments.map(c => c.author_id).lastIndexOf(agent.id);
      const hasReply = lastAgentCommentIdx !== -1 &&
        taskComments.slice(lastAgentCommentIdx + 1).some(c => c.author_id !== agent.id);

      if (hasReply) {
        actionable.push({ task, reason: 'clarification received' });
      }
      // else: still waiting — skip
    } else {
      actionable.push({ task, reason: task.status });
    }
  }

  if (actionable.length === 0) {
    console.log(`No actionable tasks for ${agent.name}.`);
    process.exit(1);
  }

  console.log(`${actionable.length} task${actionable.length > 1 ? 's' : ''} ready for ${agent.name}:`);
  for (const { task, reason } of actionable) {
    const priority = PRIORITY_LABEL[task.priority] || task.priority;
    console.log(`  [${task.id.slice(-8)}]  ${task.title}  (${reason}, ${priority})`);
  }
  process.exit(0);
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Kian Agent Framework - Task Manager

Usage:
  node tools/tasks.js <command> [options]

Task commands:
  poll                               Check if the agent has actionable work (exit 0 = yes, 1 = no)
  poll --assignee <name|id>          Poll for a specific agent (default: AGENT_NAME from .env)
  list                               List all active tasks
  list --assignee <name|id>          Filter by assignee
  list --status <status>             Filter by status (includes done/cancelled)
  list --project <name|id>           Filter by project
  get <id>                           Show a task with all its comments
  add --title <text> [options]       Create a new task
  update <id> [options]              Update a task
  assign <id> --to <user>            Add a user to task assignees
  comment <id> --body <text>         Add a comment to a task

Add options:
  --title <text>          Task title (required)
  --description <text>    Longer context for the task
  --priority <level>      low | medium | high  (default: medium)
  --project <name|id>     Assign to a project
  --assignee <name|id>    Assign to a user
  --created-by <name|id>  Record who created the task

Update options:
  --status <status>       todo | in_progress | needs_clarification | review | blocked | done | cancelled
  --title <text>
  --description <text>
  --priority <level>      low | medium | high
  --notes <text>          Summary notes (shown in list view)

Comment options:
  --body <text>           Comment text (required)
  --author <name|id>      Author (default: AGENT_NAME from .env)

User commands:
  users list
  users add --name <name> [--type human|agent] [--email <email>]

Project commands:
  projects list
  projects add --name <name> [--description <text>]
`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, sub] = positional;

  if (!command || command === 'help') { printHelp(); return; }

  const db = loadDb();

  switch (command) {
    case 'poll':     cmdPoll(db, flags); break;
    case 'list':     cmdList(db, flags); break;
    case 'get':      cmdGet(db, sub); break;
    case 'add':      cmdAdd(db, flags); break;
    case 'update':   cmdUpdate(db, sub, flags); break;
    case 'assign':   cmdAssign(db, sub, flags); break;
    case 'comment':  cmdComment(db, sub, flags); break;
    case 'users':
      if (!sub || sub === 'list') cmdUsersList(db);
      else if (sub === 'add') cmdUsersAdd(db, flags);
      else { console.error(`Unknown users subcommand: ${sub}`); process.exit(1); }
      break;
    case 'projects':
      if (!sub || sub === 'list') cmdProjectsList(db);
      else if (sub === 'add') cmdProjectsAdd(db, flags);
      else { console.error(`Unknown projects subcommand: ${sub}`); process.exit(1); }
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main();
