# Skill: check-tasks

Check for actionable tasks and invoke the agent only if there is real work to do.

## Trigger

User says `/check-tasks` or this is called on a schedule.

---

## Instructions

### Step 1 — Poll (no LLM cost)

```bash
node tools/node/tasks.js poll
```

- Exit code `1` → no actionable tasks. Report "No tasks to work on." and stop.
- Exit code `0` → tasks are ready. Continue to Step 2.

The poll command already handles `needs_clarification` correctly — it only flags those tasks as actionable if a human has replied after the agent's last comment.

---

### Step 2 — Invoke the agent

With the poll output showing which tasks are ready, invoke Kian to work on them.

For each actionable task (in priority order: `in_progress` first, then `high` → `medium` → `low`):

1. Read the full task context:
   ```bash
   node tools/node/tasks.js get <task-id>
   ```

2. If the task is a `needs_clarification` with a reply — read the comments, then proceed as `in_progress`.

3. If starting a new task:
   ```bash
   node tools/node/tasks.js update <task-id> --status in_progress
   ```

4. Do the work.

5. When done, run `/update-task`.

Work on one task at a time.
