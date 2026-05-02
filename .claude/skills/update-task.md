# Skill: update-task

Update a task status and add a comment after completing work.

## Trigger

User says `/update-task` or called at the end of completing a task.

---

## Instructions

### After completing work

1. Add a comment summarizing what was done:
   ```bash
   ./kian comment <task-id> --body "Done: [brief summary of what was completed and any relevant details]"
   ```

2. Set status to `review`:
   ```bash
   ./kian update <task-id> --status review --notes "[one-line summary]"
   ```

### If you hit an external blocker

```bash
./kian comment <task-id> --body "Blocked: [what is blocking this and what is needed to unblock]"
./kian update <task-id> --status blocked
```

### Rules

- **Never set `done` directly.** Use `review` — the human sets `done` after confirming.
- **Always comment before changing status** — the comment is the record of what happened.
- The `--notes` flag on `update` is for a short summary visible in list view. Put detail in comments.
