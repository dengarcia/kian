# Introduction to Agent Frameworks

*Target audience: developers*

---

## What is an agent framework?

An **agent framework** is a system that lets an AI model do real work autonomously — not just answer a question, but take a sequence of actions, make decisions, and interact with tools and data to complete a goal.

The key word is *framework*: it's the scaffolding that connects the model to the world. Without it, you have a chatbot. With it, you have a teammate.

A typical agent framework provides:

- **A way to give the agent work** — a task, a prompt, a trigger
- **Tools the agent can use** — read/write files, call APIs, run code, query databases
- **A feedback loop** — the agent observes results and adjusts its next action
- **A communication channel** — how the agent reports back and asks for help

---

## Why they matter

Developers have used LLMs for autocomplete and Q&A for years. Agent frameworks push this further: instead of the human driving every step, the model can take initiative on multi-step work.

This matters because most real tasks aren't one-shot. Writing a blog post, triaging a bug, updating a document — these require reading context, making decisions, producing output, and handing off for review. An agent framework gives an AI model the structure to participate in that kind of work.

The practical benefit: your team gets an AI that works *with* you on the task board, not just *for* you in a chat window.

---

## How most agent frameworks are built

Most frameworks share a common shape:

```
[Task / Goal]
      ↓
[Agent loop]
  - Observe current state
  - Choose next action (tool call, message, etc.)
  - Execute action
  - Observe result
  - Repeat until done
      ↓
[Report outcome]
```

The agent loop is the core. The model is called once per iteration, given a system prompt that describes its role and tools, the task description, and any results from prior steps. It decides what to do next. The framework executes that action and feeds the result back in.

This loop continues until the agent decides the task is complete — or until it hits an edge case it can't resolve on its own and asks a human.

---

## How Kian works

Kian is a minimal agent framework built around a shared task board. The design philosophy is that an AI agent should be a *participant in your existing workflow*, not a separate system you manage.

### The task board as shared space

Instead of a custom UI or dedicated API, Kian uses a simple task board that both humans and agents read and write. Tasks have a title, description, status, priority, and comments. The agent is just another user — `type: "agent"` in the database, but otherwise no different from a human team member.

```
Users: Alice (human), Bob (human), Kian (agent)
Tasks: assigned to any of them
```

### The status lifecycle

Tasks move through a defined set of statuses:

| Status | Who sets it | What it means |
|--------|-------------|---------------|
| `todo` | human | Ready to be picked up |
| `in_progress` | Kian | Kian is actively working |
| `needs_clarification` | Kian | Kian asked a question and is waiting |
| `review` | Kian | Work is done, human should check |
| `blocked` | human | External dependency, not actionable |
| `done` | human | Confirmed complete |

One design principle is clear here: **Kian never marks its own work as `done`.** That confirmation belongs to the human. This keeps the agent in its lane — it can complete work, but not close the loop unilaterally.

### Comments as the communication channel

When Kian needs clarification, it posts a comment on the task and sets the status to `needs_clarification`. When a human replies, the status automatically resets to `todo` so Kian knows to pick it back up. No out-of-band messages, no separate thread — everything lives on the task.

This makes the agent's communication auditable by default. You can review every question it asked, every answer it got, and every summary it left.

### The poll/work split

Kian separates two phases:

1. **Poll** (cheap): A fast database query that checks whether any actionable tasks exist. No LLM call. Exits with code `0` if work exists, `1` if not.
2. **Work** (costly): If and only if there is actionable work, invoke the LLM to read context and do the task.

This matters for scheduled automation. If you run Kian every 30 seconds, you don't want to pay for an LLM call on every tick. The poll is a zero-cost gatekeeper.

### A real interaction

Here's what a typical Kian task looks like end to end:

```
Human assigns task:
  Title: "Write product comparison table"
  Description: "Compare our three pricing tiers for the docs site."

Kian picks it up (next poll cycle):
  → Sets status: in_progress
  → Reads task description
  → Produces the comparison table
  → Posts comment: "Done — added comparison table. Covered features,
     limits, and support level for each tier. Let me know if you
     want pricing added too."
  → Sets status: review

Human reviews:
  → Sets status: done
```

If the task had been unclear:

```
Human assigns task:
  Title: "Update the comparison table"
  Description: (empty)

Kian:
  → Posts comment: "Which table should I update, and what changes
     are needed? I can see the pricing tier table in the docs —
     is that the one?"
  → Sets status: needs_clarification

Human replies:
  "Yes, the pricing table. Add an 'API access' row."
  → Status auto-resets to: todo

Kian picks it up again:
  → Reads the comment thread for context
  → Makes the update
  → Posts summary, sets status: review
```

---

## What makes a good agent framework

A few principles that hold up across implementations:

**1. Clear scope.** The agent should know what it can and can't do. Kian can write and update content, ask questions, and report back. It doesn't merge PRs or send emails. Bounded scope means fewer surprises.

**2. Human confirmation at the right points.** Agents should complete work autonomously but hand off decisions with real consequences. Kian never sets `done` — the human does.

**3. Cheap signal before expensive action.** The poll/work split is one example. Generally: before doing costly or irreversible things, check whether they're needed.

**4. Auditable communication.** If you can't see what the agent did and why, you can't trust it. Comments on tasks, status transitions, and summary notes give you a full record without building a separate audit log.

**5. The agent as a participant, not a silo.** The best agent integrations don't require a separate app or workflow. They fit into what the team already uses.

---

## Getting started with Kian

```bash
git clone https://github.com/dengarcia/kian
cd kian
./setup.sh
cp .env.example .env
kian seed
kian list
```

Assign a task to Kian:

```bash
kian add --title "Write a product FAQ" --assignee Kian --priority high
```

Then run a check:

```bash
kian poll          # See if there's work
/check-tasks       # Let Kian pick it up (in Claude Code)
```

The task board UI is available at `http://localhost:3000` after running `kian dashboard`.

---

Agent frameworks are still early. The patterns are settling. But the core idea — give an AI model a clear role, bounded tools, and a way to communicate — is proving out in production teams today. Kian is one minimal, practical implementation of that idea.
