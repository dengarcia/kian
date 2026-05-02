#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('./db');

const AGENT_NAME = process.env.AGENT_NAME || 'Kian';

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

function printTask(task, { showComments = false } = {}) {
  const icon = STATUS_ICON[task.status] || '·';
  const assigneeNames = (task.assignees || []).map(u => u.name).join(', ');
  const priority = PRIORITY_LABEL[task.priority] || task.priority;
  const shortId = task.id.slice(-8);

  console.log(`\n  ${icon}  [${shortId}]  ${task.title}`);
  console.log(`     status: ${task.status}  |  priority: ${priority}${task.project_name ? `  |  project: ${task.project_name}` : ''}`);
  if (assigneeNames) console.log(`     assignees: ${assigneeNames}`);
  if (task.description) console.log(`     description: ${task.description}`);
  if (task.notes) console.log(`     notes: ${task.notes}`);

  if (showComments && task.comments?.length) {
    console.log(`     --- comments (${task.comments.length}) ---`);
    for (const c of task.comments) {
      const author = c.author_name || '(unknown)';
      const date = c.created_at.slice(0, 10);
      console.log(`     [${date}] ${author}: ${c.body}`);
    }
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_STATUSES = ['todo', 'in_progress', 'needs_clarification', 'review', 'blocked', 'done', 'cancelled'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

// ── Task commands ─────────────────────────────────────────────────────────────

function cmdList(flags) {
  const filters = {};
  if (flags.status) filters.status = flags.status;

  if (flags.assignee) {
    const user = db.getUserByNameOrId(flags.assignee);
    if (!user) { console.error(`User not found: ${flags.assignee}`); process.exit(1); }
    filters.assigneeId = user.id;
  }

  if (flags.project) {
    const project = db.getProjectByNameOrId(flags.project);
    if (!project) { console.error(`Project not found: ${flags.project}`); process.exit(1); }
    filters.projectId = project.id;
  }

  const tasks = db.getTasks(filters);
  if (!tasks.length) { console.log('No tasks found.'); return; }

  const labelParts = [];
  if (flags.status) labelParts.push(`status: ${flags.status}`);
  if (flags.assignee) labelParts.push(`assignee: ${flags.assignee}`);
  if (flags.project) labelParts.push(`project: ${flags.project}`);
  const label = labelParts.length ? labelParts.join(', ') : 'all active';

  console.log(`\nTasks (${tasks.length}, ${label}):`);
  for (const task of tasks) printTask(task);
  console.log('');
}

function cmdGet(id) {
  if (!id) { console.error('Task ID required'); process.exit(1); }
  const task = db.getTask(id);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
  printTask(task, { showComments: true });
  console.log('');
}

function cmdAdd(flags) {
  if (!flags.title) { console.error('--title is required'); process.exit(1); }

  const assignees = [];
  if (flags.assignee) {
    const user = db.getUserByNameOrId(flags.assignee);
    if (!user) { console.error(`User not found: ${flags.assignee}`); process.exit(1); }
    assignees.push(user.id);
  }

  let project_id = null;
  if (flags.project) {
    const project = db.getProjectByNameOrId(flags.project);
    if (!project) { console.error(`Project not found: ${flags.project}`); process.exit(1); }
    project_id = project.id;
  }

  let created_by = null;
  if (flags['created-by']) {
    const user = db.getUserByNameOrId(flags['created-by']);
    if (!user) { console.error(`User not found: ${flags['created-by']}`); process.exit(1); }
    created_by = user.id;
  }

  if (flags.priority && !VALID_PRIORITIES.includes(flags.priority)) {
    console.error(`Invalid priority. Valid values: ${VALID_PRIORITIES.join(', ')}`);
    process.exit(1);
  }

  const task = db.addTask({
    title: flags.title,
    description: flags.description || null,
    priority: flags.priority || 'medium',
    project_id,
    assignees,
    created_by,
  });
  console.log(`Created: [${task.id.slice(-8)}] ${task.title}`);
}

function cmdUpdate(id, flags) {
  if (!id) { console.error('Task ID required'); process.exit(1); }

  const fields = {};
  if (flags.status) {
    if (!VALID_STATUSES.includes(flags.status)) {
      console.error(`Invalid status. Valid values: ${VALID_STATUSES.join(', ')}`);
      process.exit(1);
    }
    fields.status = flags.status;
  }
  if (flags.title !== undefined) fields.title = flags.title;
  if (flags.description !== undefined) fields.description = flags.description;
  if (flags.notes !== undefined) fields.notes = flags.notes;
  if (flags.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(flags.priority)) {
      console.error(`Invalid priority. Valid values: ${VALID_PRIORITIES.join(', ')}`);
      process.exit(1);
    }
    fields.priority = flags.priority;
  }

  const task = db.updateTask(id, fields);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
  console.log(`Updated: [${task.id.slice(-8)}] ${task.title}${flags.status ? `  ->  ${flags.status}` : ''}`);
}

function cmdAssign(id, flags) {
  if (!id || !flags.to) { console.error('Usage: tasks.js assign <task-id> --to <user>'); process.exit(1); }
  const task = db.getTaskByIdOrSuffix(id);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
  const user = db.getUserByNameOrId(flags.to);
  if (!user) { console.error(`User not found: ${flags.to}`); process.exit(1); }
  db.assignUser(id, user.id);
  console.log(`Assigned ${user.name} to [${task.id.slice(-8)}] ${task.title}`);
}

function cmdComment(id, flags) {
  if (!id || !flags.body) { console.error('Usage: tasks.js comment <task-id> --body "..."'); process.exit(1); }
  const task = db.getTaskByIdOrSuffix(id);
  if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }

  const authorName = flags.author || AGENT_NAME;
  const user = db.getUserByNameOrId(authorName);

  db.addComment({ task_id: task.id, author_id: user?.id || null, body: flags.body });
  console.log(`Comment added to [${task.id.slice(-8)}] ${task.title}`);
}

// ── Poll command ──────────────────────────────────────────────────────────────

function cmdPoll(flags) {
  const agentName = flags.assignee || AGENT_NAME;
  const agent = db.getUserByNameOrId(agentName);
  if (!agent) { console.error(`Agent user not found: ${agentName}`); process.exit(2); }

  const tasks = db.getActionableTasks(agent.id);

  if (!tasks.length) {
    console.log(`No actionable tasks for ${agent.name}.`);
    process.exit(1);
  }

  console.log(`${tasks.length} task${tasks.length > 1 ? 's' : ''} ready for ${agent.name}:`);
  for (const task of tasks) {
    const priority = PRIORITY_LABEL[task.priority] || task.priority;
    console.log(`  [${task.id.slice(-8)}]  ${task.title}  (${task.status}, ${priority})`);
  }
  process.exit(0);
}

// ── Seed command ──────────────────────────────────────────────────────────────

function cmdSeed() {
  const examplePath = path.join(__dirname, '../../db.example.json');
  if (!fs.existsSync(examplePath)) {
    console.error('db.example.json not found at project root');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  const counts = db.seed(data);
  console.log(`Seeded: ${counts.users} users, ${counts.projects} projects, ${counts.tasks} tasks, ${counts.comments} comments`);
}

// ── User commands ─────────────────────────────────────────────────────────────

function cmdUsersList() {
  const users = db.getUsers();
  if (!users.length) { console.log('No users.'); return; }
  console.log('\nUsers:\n');
  for (const u of users) {
    console.log(`  [${u.id.slice(-8)}]  ${u.name.padEnd(20)}  ${u.type}${u.email ? `  <${u.email}>` : ''}`);
  }
  console.log('');
}

function cmdUsersAdd(flags) {
  if (!flags.name) { console.error('--name is required'); process.exit(1); }
  if (flags.type && !['human', 'agent'].includes(flags.type)) {
    console.error('--type must be "human" or "agent"'); process.exit(1);
  }
  const user = db.addUser({ name: flags.name, type: flags.type || 'human', email: flags.email });
  console.log(`User created: [${user.id.slice(-8)}]  ${user.name}  (${user.type})`);
}

// ── Project commands ──────────────────────────────────────────────────────────

function cmdProjectsList() {
  const projects = db.getProjects();
  if (!projects.length) { console.log('No projects.'); return; }
  console.log('\nProjects:\n');
  for (const p of projects) {
    console.log(`  [${p.id.slice(-8)}]  ${p.name.padEnd(25)}  ${p.active_task_count} active tasks${p.description ? `  — ${p.description}` : ''}`);
  }
  console.log('');
}

function cmdProjectsAdd(flags) {
  if (!flags.name) { console.error('--name is required'); process.exit(1); }
  const project = db.addProject({ name: flags.name, description: flags.description });
  console.log(`Project created: [${project.id.slice(-8)}]  ${project.name}`);
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Kian — Task Manager

Usage:
  node tools/node/tasks.js <command> [options]

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
  seed                               Initialize the database from db.example.json

Add options:
  --title <text>          Task title (required)
  --description <text>    Longer context for the task
  --priority <level>      low | medium | high  (default: medium)
  --project <name|id>
  --assignee <name|id>
  --created-by <name|id>

Update options:
  --status <status>   todo | in_progress | needs_clarification | review | blocked | done | cancelled
  --title <text>  --description <text>  --priority <level>  --notes <text>

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

  switch (command) {
    case 'poll':     cmdPoll(flags); break;
    case 'list':     cmdList(flags); break;
    case 'get':      cmdGet(sub); break;
    case 'add':      cmdAdd(flags); break;
    case 'update':   cmdUpdate(sub, flags); break;
    case 'assign':   cmdAssign(sub, flags); break;
    case 'comment':  cmdComment(sub, flags); break;
    case 'seed':     cmdSeed(); break;
    case 'users':
      if (!sub || sub === 'list') cmdUsersList();
      else if (sub === 'add') cmdUsersAdd(flags);
      else { console.error(`Unknown users subcommand: ${sub}`); process.exit(1); }
      break;
    case 'projects':
      if (!sub || sub === 'list') cmdProjectsList();
      else if (sub === 'add') cmdProjectsAdd(flags);
      else { console.error(`Unknown projects subcommand: ${sub}`); process.exit(1); }
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main();
