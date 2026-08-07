'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), `kian-test-${crypto.randomBytes(6).toString('hex')}.db`);
process.env.KIAN_DB_PATH = dbPath;

const db = require('../../db');

function resetDb() {
  const raw = db.getDb();
  raw.exec(`
    DELETE FROM comments;
    DELETE FROM task_assignees;
    DELETE FROM tasks;
    DELETE FROM projects;
    DELETE FROM users;
  `);
}

function seedBasic() {
  const human = db.addUser({ name: 'Denis', type: 'human', email: 'denis@example.com' });
  const agent = db.addUser({ name: 'Kian', type: 'agent' });
  const project = db.addProject({ name: 'Blog', description: 'Test project' });
  return { human, agent, project };
}

function cleanup() {
  for (const suffix of ['', '-shm', '-wal']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

module.exports = { db, dbPath, resetDb, seedBasic, cleanup };
