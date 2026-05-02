# Kian Agent Framework

A lightweight framework for running AI agents with a shared task board. Agents pick up assigned tasks, ask clarifying questions via task comments, and report back when done.

## Concepts

- **Users** — humans and agents are both users in the database
- **Projects** — optional groupings for tasks
- **Tasks** — assigned to one or more users; tracked through a clear status lifecycle
- **Comments** — the communication channel between humans and agents on a task

### Task statuses

| Status | Meaning |
|---|---|
| `todo` | Not started |
| `in_progress` | Agent is working on it |
| `needs_clarification` | Agent asked a question, waiting for reply |
| `review` | Work done, human should check |
| `blocked` | Waiting on an external dependency |
| `done` | Confirmed complete (human sets this) |
| `cancelled` | Dropped |

## Setup

**1. Install dependencies**
```bash
cd tools/node && npm install && cd ../..
```

**2. Configure environment**
```bash
cp .env.example .env
# Edit .env — set AGENT_NAME if you want a different name than Kian
```

**3. Set up the database**
```bash
mkdir -p db
cp db.example.json db/db.json
# Edit db/db.json — update the example users with real names/emails
```

**4. Verify**
```bash
node tools/node/tasks.js users list
node tools/node/tasks.js list
```

## Using the task manager

```bash
# Tasks
node tools/node/tasks.js list
node tools/node/tasks.js list --assignee Kian
node tools/node/tasks.js list --status needs_clarification
node tools/node/tasks.js get <task-id>
node tools/node/tasks.js add --title "Write product review" --assignee Kian --priority high
node tools/node/tasks.js update <task-id> --status in_progress
node tools/node/tasks.js assign <task-id> --to Kian
node tools/node/tasks.js comment <task-id> --body "Needs more context on the target audience"

# Users
node tools/node/tasks.js users list
node tools/node/tasks.js users add --name "Alice" --type human --email alice@example.com

# Projects
node tools/node/tasks.js projects list
node tools/node/tasks.js projects add --name "Blog" --description "Content production"
```

Task IDs can be specified as the full ID or as a suffix (last 8 characters shown in list output).

## Agent skills

Two skills are included for the agent:

- **`/check-tasks`** — polls for assigned tasks, starts working or asks questions
- **`/update-task`** — marks a task as complete after work is done

The agent definition is in `.claude/agents/kian.md`.

## Database adapters

The current backend is a local JSON file at `db/db.json`. The data model is designed to be portable — a Notion adapter or any other backend can replace it by implementing the same read/write interface used in `tools/tasks.js`.
