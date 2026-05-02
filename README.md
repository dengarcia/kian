# Kian

**An AI teammate that works from your task board.**

Assign tasks to Kian alongside your human team. It picks up work, asks a question when something is unclear, and marks tasks ready for review when done — no prompting, no babysitting.

Kian is a participant in your workflow, not a chat window. The task board is the shared space. Comments are how it communicates.

## How it works

You create tasks and assign them to Kian. On its next check-in:

- **Clear task** → Kian sets it to `in_progress`, does the work, leaves a summary comment, marks it `review`
- **Unclear task** → Kian asks one focused question as a comment, sets status to `needs_clarification`, moves on
- **Nothing to do** → Kian doesn't wake up at all (the poll check costs no LLM tokens)

You review, confirm, and set tasks to `done`. That confirmation is yours — Kian never closes its own work.

## Concepts

- **Users** — humans and agents are both users; Kian is just another team member with `type: "agent"`
- **Projects** — optional groupings for tasks
- **Tasks** — owned by assignees, tracked through a clear status lifecycle
- **Comments** — how the team communicates on a task; Kian reads and writes them

### Task statuses

| Status | Set by | Meaning |
|---|---|---|
| `todo` | human | Ready to be picked up |
| `in_progress` | Kian | Kian is working on it |
| `needs_clarification` | Kian | Kian asked a question, waiting for reply |
| `review` | Kian | Work done, human should check |
| `blocked` | human | Waiting on an external dependency |
| `done` | human | Confirmed complete |
| `cancelled` | either | Dropped |

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
./kian seed
# Seeds from db.example.json — edit it first to set your team's names/emails
```

**4. Verify**
```bash
./kian users list
./kian list
```

## Task board CLI

```bash
# See what Kian has to work on
./kian poll
./kian list --assignee Kian

# Manage tasks
./kian list
./kian get <task-id>
./kian add --title "Write product review" --assignee Kian --priority high
./kian update <task-id> --status done
./kian assign <task-id> --to Kian
./kian comment <task-id> --body "Target audience is first-time buyers"

# Users and projects
./kian users list
./kian users add --name "Alice" --type human --email alice@example.com
./kian projects list
./kian projects add --name "Blog" --description "Content production"
```

Task IDs can be the full ID or the 8-character suffix shown in `list` output.

## Agent skills

- **`/check-tasks`** — polls first (no LLM cost), then invokes Kian only if there is actionable work
- **`/update-task`** — marks a task complete with a summary comment after work is done

The agent definition is in `.claude/agents/kian.md`.

## UI

A local web interface for viewing tasks and agent activity:

```bash
./kian dashboard
# open http://localhost:3000
```

- **Tasks tab** — filterable task list with expandable detail and comment thread
- **Activity tab** — reverse-chronological feed of all comments, useful for reviewing what Kian did and why

## Database

The backend is SQLite (`db/kian.db`, gitignored). Schema is created automatically on first run. Seed data lives in `db.example.json` — edit it to set up your team, then run `./kian seed`.

The data model is designed to be portable — a Notion adapter or any other backend can replace `tools/node/db.js` by implementing the same interface.
