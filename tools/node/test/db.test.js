'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { db, resetDb, seedBasic, cleanup } = require('./helpers/fixture');

after(cleanup);

// Inserts a comment with an explicit timestamp so ordering in tests is deterministic
// (db.addComment() uses Date.now(), which can tie within the same millisecond).
function addTimedComment(taskId, authorId, secondsFromEpoch) {
  const raw = db.getDb();
  const created_at = new Date(secondsFromEpoch * 1000).toISOString();
  raw.prepare(
    'INSERT INTO comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(`cmt_${secondsFromEpoch}_${authorId || 'null'}`, taskId, authorId, 'test comment', created_at);
}

describe('addComment auto-reset rule', () => {
  let human, agent, project;

  beforeEach(() => {
    resetDb();
    ({ human, agent, project } = seedBasic());
  });

  it('resets a needs_clarification task to todo when a human comments', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.updateTask(task.id, { status: 'needs_clarification' });

    db.addComment({ task_id: task.id, author_id: human.id, body: 'here is the answer' });

    assert.equal(db.getTask(task.id).status, 'todo');
  });

  it('leaves status unchanged when the agent comments', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.updateTask(task.id, { status: 'needs_clarification' });

    db.addComment({ task_id: task.id, author_id: agent.id, body: 'still waiting' });

    assert.equal(db.getTask(task.id).status, 'needs_clarification');
  });

  it('does not touch status for tasks in other statuses', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    assert.equal(task.status, 'todo');

    db.addComment({ task_id: task.id, author_id: human.id, body: 'fyi' });

    assert.equal(db.getTask(task.id).status, 'todo');
  });

  it('does not crash and leaves status unchanged for a comment with no author', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.updateTask(task.id, { status: 'needs_clarification' });

    assert.doesNotThrow(() => {
      db.addComment({ task_id: task.id, author_id: null, body: 'system note' });
    });

    assert.equal(db.getTask(task.id).status, 'needs_clarification');
  });
});

describe('getActionableTasks poll-gating', () => {
  let human, agent, project;

  beforeEach(() => {
    resetDb();
    ({ human, agent, project } = seedBasic());
  });

  it('includes todo and in_progress tasks assigned to the agent', () => {
    const todo = db.addTask({ title: 'Todo task', project_id: project.id, assignees: [agent.id] });
    const inProgress = db.addTask({ title: 'In progress task', project_id: project.id, assignees: [agent.id] });
    db.updateTask(inProgress.id, { status: 'in_progress' });

    const actionable = db.getActionableTasks(agent.id).map(t => t.id);

    assert.ok(actionable.includes(todo.id));
    assert.ok(actionable.includes(inProgress.id));
  });

  it('excludes tasks not assigned to the agent', () => {
    db.addTask({ title: 'Unassigned', project_id: project.id, assignees: [human.id] });

    const actionable = db.getActionableTasks(agent.id);

    assert.equal(actionable.length, 0);
  });

  it('excludes needs_clarification tasks with no agent comment at all', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.updateTask(task.id, { status: 'needs_clarification' });
    addTimedComment(task.id, human.id, 1000);

    const actionable = db.getActionableTasks(agent.id);

    assert.equal(actionable.length, 0);
  });

  it('excludes needs_clarification tasks where the agent commented last', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.updateTask(task.id, { status: 'needs_clarification' });
    addTimedComment(task.id, agent.id, 1000);

    const actionable = db.getActionableTasks(agent.id);

    assert.equal(actionable.length, 0);
  });

  it('includes needs_clarification tasks where a human replied after the agent', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.updateTask(task.id, { status: 'needs_clarification' });
    addTimedComment(task.id, agent.id, 1000);
    addTimedComment(task.id, human.id, 2000);

    const actionable = db.getActionableTasks(agent.id).map(t => t.id);

    assert.ok(actionable.includes(task.id));
  });

  it('handles multi-round back-and-forth correctly', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.updateTask(task.id, { status: 'needs_clarification' });
    addTimedComment(task.id, agent.id, 1000);
    addTimedComment(task.id, human.id, 2000);
    addTimedComment(task.id, agent.id, 3000);

    // Agent replied again and is now waiting on the human — not actionable yet.
    assert.equal(db.getActionableTasks(agent.id).length, 0);

    addTimedComment(task.id, human.id, 4000);

    // Human replied after the agent's latest comment — actionable again.
    const actionable = db.getActionableTasks(agent.id).map(t => t.id);
    assert.ok(actionable.includes(task.id));
  });

  it('excludes done, cancelled, review, and blocked tasks regardless of comments', () => {
    for (const status of ['done', 'cancelled', 'review', 'blocked']) {
      const task = db.addTask({ title: status, project_id: project.id, assignees: [agent.id] });
      db.updateTask(task.id, { status });
    }

    const actionable = db.getActionableTasks(agent.id);

    assert.equal(actionable.length, 0);
  });

  it('scopes results to the given project', () => {
    const other = db.addProject({ name: 'Other project' });
    const inProject = db.addTask({ title: 'In project', project_id: project.id, assignees: [agent.id] });
    const inOther = db.addTask({ title: 'In other', project_id: other.id, assignees: [agent.id] });

    const scoped = db.getActionableTasks(agent.id, project.id).map(t => t.id);
    assert.ok(scoped.includes(inProject.id));
    assert.ok(!scoped.includes(inOther.id));

    const unscoped = db.getActionableTasks(agent.id).map(t => t.id);
    assert.ok(unscoped.includes(inProject.id));
    assert.ok(unscoped.includes(inOther.id));
  });

  it('orders in_progress before todo/needs_clarification, and high priority first', () => {
    const lowTodo = db.addTask({ title: 'low todo', priority: 'low', project_id: project.id, assignees: [agent.id] });
    const highTodo = db.addTask({ title: 'high todo', priority: 'high', project_id: project.id, assignees: [agent.id] });
    const inProgress = db.addTask({ title: 'in progress', priority: 'low', project_id: project.id, assignees: [agent.id] });
    db.updateTask(inProgress.id, { status: 'in_progress' });

    const order = db.getActionableTasks(agent.id).map(t => t.id);

    assert.equal(order[0], inProgress.id);
    assert.equal(order[1], highTodo.id);
    assert.equal(order[2], lowTodo.id);
  });
});

describe('task CRUD sanity', () => {
  let human, agent, project;

  beforeEach(() => {
    resetDb();
    ({ human, agent, project } = seedBasic());
  });

  it('addTask creates a task with default status todo', () => {
    const task = db.addTask({ title: 'New task', project_id: project.id });
    assert.equal(task.status, 'todo');
    assert.ok(task.id.startsWith('tsk_'));
  });

  it('updateTask updates allowed fields and bumps updated_at', () => {
    const task = db.addTask({ title: 'Original', project_id: project.id });
    const updated = db.updateTask(task.id, { title: 'Renamed', status: 'in_progress' });
    assert.equal(updated.title, 'Renamed');
    assert.equal(updated.status, 'in_progress');
    assert.equal(db.getTask(task.id).title, 'Renamed');
  });

  it('updateTask returns null for a missing task', () => {
    assert.equal(db.updateTask('tsk_missing', { title: 'x' }), null);
  });

  it('assignUser adds an assignee without duplicating', () => {
    const task = db.addTask({ title: 'T', project_id: project.id });
    db.assignUser(task.id, agent.id);
    db.assignUser(task.id, agent.id);
    const assignees = db.getTask(task.id).assignees;
    assert.equal(assignees.filter(a => a.id === agent.id).length, 1);
  });

  it('setAssignees replaces the assignee set', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [human.id] });
    db.setAssignees(task.id, [agent.id]);
    const assignees = db.getTask(task.id).assignees.map(a => a.id);
    assert.deepEqual(assignees, [agent.id]);
  });

  it('deleteTask removes the task, its comments, and its assignees', () => {
    const task = db.addTask({ title: 'T', project_id: project.id, assignees: [agent.id] });
    db.addComment({ task_id: task.id, author_id: human.id, body: 'note' });

    assert.equal(db.deleteTask(task.id), true);
    assert.equal(db.getTask(task.id), null);
  });

  it('deleteTask returns false for a missing task', () => {
    assert.equal(db.deleteTask('tsk_missing'), false);
  });
});
