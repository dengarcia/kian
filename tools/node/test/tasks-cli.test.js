'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { db, resetDb, seedBasic, cleanup } = require('./helpers/fixture');
const tasks = require('../tasks');

after(cleanup);

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

// Runs fn with process.exit/console.log/console.error mocked, and returns the
// captured exit code (or null if fn returned without exiting) plus captured output.
function run(t, fn) {
  const logs = [];
  const errors = [];
  t.mock.method(console, 'log', (...args) => { logs.push(args.join(' ')); });
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  const exitMock = t.mock.method(process, 'exit', (code) => { throw new ExitSignal(code); });

  let exitCode = null;
  try {
    fn();
  } catch (err) {
    if (err instanceof ExitSignal) exitCode = err.code;
    else throw err;
  }
  return { exitCode, logs, errors, exitCalls: exitMock.mock.calls.length };
}

describe('cmdPoll exit-code contract', () => {
  let human, agent, project;

  beforeEach(() => {
    resetDb();
    ({ human, agent, project } = seedBasic()); // agent is named 'Kian', matching default AGENT_NAME
  });

  it('exits 2 when the agent user is not found', (t) => {
    const { exitCode, errors } = run(t, () => tasks.cmdPoll({ assignee: 'NoSuchAgent' }));
    assert.equal(exitCode, 2);
    assert.match(errors.join('\n'), /Agent user not found/);
  });

  it('exits 1 and prints a message when there are no actionable tasks', (t) => {
    const { exitCode, logs } = run(t, () => tasks.cmdPoll({}));
    assert.equal(exitCode, 1);
    assert.match(logs.join('\n'), /No actionable tasks/);
  });

  it('exits 1 with no output when --quiet and there are no actionable tasks', (t) => {
    const { exitCode, logs, errors } = run(t, () => tasks.cmdPoll({ quiet: true }));
    assert.equal(exitCode, 1);
    assert.equal(logs.length, 0);
    assert.equal(errors.length, 0);
  });

  it('exits 0 and prints a summary when there are actionable tasks', (t) => {
    const task = db.addTask({ title: 'Write tests', project_id: project.id, assignees: [agent.id] });

    const { exitCode, logs } = run(t, () => tasks.cmdPoll({}));

    assert.equal(exitCode, 0);
    assert.match(logs.join('\n'), /Write tests/);
  });

  it('exits 0 with no output when --quiet and there are actionable tasks', (t) => {
    db.addTask({ title: 'Write tests', project_id: project.id, assignees: [agent.id] });

    const { exitCode, logs, errors } = run(t, () => tasks.cmdPoll({ quiet: true }));

    assert.equal(exitCode, 0);
    assert.equal(logs.length, 0);
    assert.equal(errors.length, 0);
  });

  it('respects --assignee to poll a different agent', (t) => {
    const other = db.addUser({ name: 'Other Agent', type: 'agent' });
    db.addTask({ title: 'For other', project_id: project.id, assignees: [other.id] });

    const { exitCode: kianExit } = run(t, () => tasks.cmdPoll({}));
    assert.equal(kianExit, 1);

    const { exitCode: otherExit } = run(t, () => tasks.cmdPoll({ assignee: 'Other Agent' }));
    assert.equal(otherExit, 0);
  });
});

describe('parseArgs', () => {
  it('parses a flag followed by a value', () => {
    const { flags } = tasks.parseArgs(['--title', 'Hello world']);
    assert.equal(flags.title, 'Hello world');
  });

  it('treats a flag followed by another flag as boolean true', () => {
    const { flags } = tasks.parseArgs(['--quiet', '--status', 'todo']);
    assert.equal(flags.quiet, true);
    assert.equal(flags.status, 'todo');
  });

  it('treats a trailing flag with no value as boolean true', () => {
    const { flags } = tasks.parseArgs(['--all']);
    assert.equal(flags.all, true);
  });

  it('collects positional args interspersed with flags', () => {
    const { positional, flags } = tasks.parseArgs(['update', 'tsk_abc123', '--status', 'done']);
    assert.deepEqual(positional, ['update', 'tsk_abc123']);
    assert.equal(flags.status, 'done');
  });
});

describe('validation paths', () => {
  beforeEach(() => {
    resetDb();
    seedBasic();
  });

  it('cmdAdd exits 1 when --title is missing', (t) => {
    const { exitCode, errors } = run(t, () => tasks.cmdAdd({}));
    assert.equal(exitCode, 1);
    assert.match(errors.join('\n'), /--title is required/);
  });

  it('cmdUpdate exits 1 when the task id is missing', (t) => {
    const { exitCode, errors } = run(t, () => tasks.cmdUpdate(undefined, {}));
    assert.equal(exitCode, 1);
    assert.match(errors.join('\n'), /Task ID required/);
  });

  it('cmdUpdate exits 1 for an invalid status', (t) => {
    const task = db.addTask({ title: 'T' });
    const { exitCode, errors } = run(t, () => tasks.cmdUpdate(task.id, { status: 'not-a-status' }));
    assert.equal(exitCode, 1);
    assert.match(errors.join('\n'), /Invalid status/);
  });

  it('cmdComment exits 1 when --body is missing', (t) => {
    const task = db.addTask({ title: 'T' });
    const { exitCode, errors } = run(t, () => tasks.cmdComment(task.id, {}));
    assert.equal(exitCode, 1);
    assert.match(errors.join('\n'), /Usage: tasks.js comment/);
  });

  it('cmdComment exits 1 for a missing task', (t) => {
    const { exitCode, errors } = run(t, () => tasks.cmdComment('tsk_missing', { body: 'hi' }));
    assert.equal(exitCode, 1);
    assert.match(errors.join('\n'), /Task not found/);
  });
});
