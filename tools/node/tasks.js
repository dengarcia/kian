#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('./db');

const AGENT_NAME = process.env.AGENT_NAME || 'Kian';

// ── Project detection ─────────────────────────────────────────────────────────

function realCwd() {
  try { return fs.realpathSync(process.cwd()); } catch { return process.cwd(); }
}

function detectProject() {
  const projects = db.getProjectsWithRootFolders();
  if (!projects.length) return null;
  const root = path.parse(process.cwd()).root;
  let dir = realCwd();
  while (true) {
    const match = projects.find(p => p.root_folder === dir);
    if (match) return match;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

// Returns { projectId, projectName, projectFolder, detected } or null.
// null means no project scope (global view).
function resolveProjectContext(flags) {
  if (flags.all) return null;

  if (flags.project) {
    const project = db.getProjectByNameOrId(flags.project);
    if (!project) { console.error(`Project not found: ${flags.project}`); process.exit(1); }
    return { projectId: project.id, projectName: project.name, detected: false };
  }

  const detected = detectProject();
  if (detected) return { projectId: detected.id, projectName: detected.name, projectFolder: detected.root_folder, detected: true };

  return null;
}

function printDetectionFeedback(ctx) {
  if (ctx?.detected) {
    const folder = ctx.projectFolder ? ` (${ctx.projectFolder})` : '';
    process.stderr.write(`» project: ${ctx.projectName}${folder}\n`);
  }
}

// ── Interactive prompt ────────────────────────────────────────────────────────

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
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
  const ctx = resolveProjectContext(flags);
  printDetectionFeedback(ctx);

  const filters = {};
  if (flags.status) filters.status = flags.status;

  if (flags.assignee) {
    const user = db.getUserByNameOrId(flags.assignee);
    if (!user) { console.error(`User not found: ${flags.assignee}`); process.exit(1); }
    filters.assigneeId = user.id;
  }

  if (ctx) filters.projectId = ctx.projectId;

  const tasks = db.getTasks(filters);
  if (!tasks.length) { console.log('No tasks found.'); return; }

  const labelParts = [];
  if (flags.status) labelParts.push(`status: ${flags.status}`);
  if (flags.assignee) labelParts.push(`assignee: ${flags.assignee}`);
  if (ctx) labelParts.push(`project: ${ctx.projectName}`);
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
  const projectCtx = resolveProjectContext(flags);
  if (projectCtx) {
    project_id = projectCtx.projectId;
    printDetectionFeedback(projectCtx);
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

  const ctx = resolveProjectContext(flags);
  printDetectionFeedback(ctx);

  const tasks = db.getActionableTasks(agent.id, ctx?.projectId || null);

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
    const folder = p.root_folder ? `  -> ${p.root_folder}` : '';
    console.log(`  [${p.id.slice(-8)}]  ${p.name.padEnd(25)}  ${p.active_task_count} active tasks${p.description ? `  — ${p.description}` : ''}${folder}`);
  }
  console.log('');
}

function cmdProjectsAdd(flags) {
  if (!flags.name) { console.error('--name is required'); process.exit(1); }
  const project = db.addProject({ name: flags.name, description: flags.description });
  console.log(`Project created: [${project.id.slice(-8)}]  ${project.name}`);
}

// ── Init command ──────────────────────────────────────────────────────────────

async function cmdInit(flags) {
  const cwd = realCwd();

  if (flags.status) {
    const project = detectProject();
    if (project) {
      console.log(`\nLinked: ${project.name}  (${project.root_folder})\n`);
    } else {
      console.log('\nNo project linked to this directory.\n');
    }
    return;
  }

  // Non-interactive: --project or --name provided
  if (flags.project) {
    const project = db.getProjectByNameOrId(flags.project);
    if (!project) { console.error(`Project not found: ${flags.project}`); process.exit(1); }
    db.setProjectRootFolder(project.id, cwd);
    console.log(`Linked: ${project.name}  ->  ${cwd}`);
    return;
  }

  if (flags.name) {
    const project = db.addProject({ name: flags.name, description: flags.description || null });
    db.setProjectRootFolder(project.id, cwd);
    console.log(`Created and linked: ${project.name}  ->  ${cwd}`);
    return;
  }

  // Check if already linked (exact match on this directory)
  const existing = detectProject();
  if (existing && existing.root_folder === cwd) {
    console.log(`\nThis directory is already linked to: ${existing.name}\n`);
    return;
  }

  // Interactive
  const projects = db.getProjects();

  console.log('\nLink this directory to a project:\n');
  projects.forEach((p, i) => {
    const linked = p.root_folder ? `  (linked: ${p.root_folder})` : '';
    console.log(`  ${i + 1}. ${p.name}${linked}`);
  });
  console.log(`  ${projects.length + 1}. Create new project`);
  console.log('');

  const answer = await prompt('Select: ');
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > projects.length + 1) {
    console.error('Invalid selection.');
    process.exit(1);
  }

  if (choice <= projects.length) {
    const project = projects[choice - 1];
    db.setProjectRootFolder(project.id, cwd);
    console.log(`\nLinked: ${project.name}  ->  ${cwd}\n`);
  } else {
    const name = await prompt('Project name: ');
    if (!name) { console.error('Name is required.'); process.exit(1); }
    const description = await prompt('Description (optional): ');
    const project = db.addProject({ name, description: description || null });
    db.setProjectRootFolder(project.id, cwd);
    console.log(`\nCreated and linked: ${project.name}  ->  ${cwd}\n`);
  }
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Kian — Task Manager

Usage:
  kian <command> [options]

Setup:
  init                               Link current directory to a project (interactive)
  init --project <name|id>           Link to an existing project
  init --name <name>                 Create a new project and link current directory
  init --status                      Show which project the current directory is linked to

Task commands:
  poll                               Check if the agent has actionable work (exit 0 = yes, 1 = no)
  poll --assignee <name|id>          Poll for a specific agent (default: AGENT_NAME from .env)
  list                               List tasks (auto-scoped to project if in a linked directory)
  list --assignee <name|id>          Filter by assignee
  list --status <status>             Filter by status (includes done/cancelled)
  list --project <name|id>           Filter by project (overrides detection)
  list --all                         Show all tasks regardless of current directory
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
  --project <name|id>     Overrides auto-detection
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

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, sub] = positional;

  if (!command || command === 'help') { printHelp(); return; }

  switch (command) {
    case 'init':     await cmdInit(flags); break;
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

main().catch(err => { console.error(err.message); process.exit(1); });
