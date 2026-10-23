# 💤 Sleepy Coder

**Let your code sleep. We'll handle the boring stuff.**

Sleepy Coder is a local-first AI coding assistant. It analyzes your repositories, finds
repetitive improvements (TODOs, missing tests, SEO issues…) and, once you approve them,
shows you exactly where each problem is and how to fix it, using a local model via
[Ollama](https://ollama.com). You stay in control: you make the change, Sleepy Coder checks it.
No cloud, no paid APIs: your code, your data, your machine.

> Built for the Hacktoberfest **Slow and Steady** challenge.

## Status

🚧 Phase 5 — Fix guides. Add a local repository and Sleepy Coder shows its languages,
frameworks, testing tools and Git status, finds tasks (TODO/FIXME comments, missing tests,
README or LICENSE, duplicate `<h1>`, images without `alt`, `<html>` without `lang`) and asks the
local model (Gemma) for improvement ideas. Approve a task and open **How to fix**:

1. **Where** — the exact file and lines, found by rules (no AI, always correct), with an
   *Open in VS Code* link.
2. **How** — Gemma explains the problem, lists the steps and suggests code you can copy.
3. **Check again** — after you fix it, the same rule that found the problem runs again. If it is
   gone, the task moves to **Done**. AI-suggested tasks have no rule, so you mark them as done.

Sleepy Coder never changes your files.
See the roadmap in [`docs/brief.md`](docs/brief.md).

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite`)
- pnpm 10
- [Ollama](https://ollama.com) running locally, with at least one model
  (`ollama pull gemma3:4b` works well on a 16 GB laptop)

## Getting started

```bash
pnpm install
pnpm dev
```

- Dashboard: http://127.0.0.1:4321
- Backend health: http://127.0.0.1:4317/health

Both only listen on `127.0.0.1`: nothing is exposed to your network.

## Configuration

By default Sleepy Coder uses the first Gemma model it finds. To use another one:

```bash
SLEEPY_MODEL=qwen2.5:3b pnpm dev
```

| Variable | Default |
|---|---|
| `SLEEPY_MODEL` | first installed Gemma model |
| `SLEEPY_OLLAMA_URL` | `http://127.0.0.1:11434` |
| `SLEEPY_EXPERIMENTAL_AGENT` | off — set to `1` to show the experimental **Run** button |

## API

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Backend status |
| GET | `/ollama/status` | Ollama running?, version, installed models, selected model |
| POST | `/ollama/test` | Sends a short prompt to the selected model |
| GET | `/repositories` | Saved repositories |
| POST | `/repositories` | Adds a repository: `{ "path": "/abs/path" }` |
| DELETE | `/repositories/:id` | Removes it from the list (never deletes files) |
| GET | `/repositories/:id/analysis` | Read-only analysis: languages, stack, Git status, warnings |
| GET | `/config` | What is turned on (`experimentalAgent`) |
| GET | `/repositories/:id/tasks` | Tasks of a repository (`?status=pending\|approved\|done\|discarded`) |
| POST | `/repositories/:id/tasks/hunt` | Looks for new tasks (no AI) |
| POST | `/repositories/:id/tasks/suggest` | Asks the local model for improvement tasks (can take 1–2 min) |
| PATCH | `/tasks/:id` | Approve, discard, mark as done or reset a task: `{ "status": "approved" }` |
| GET | `/tasks/:id/guide` | Where the problem is (no AI) and the last fix guide |
| POST | `/tasks/:id/guide` | Asks the local model how to fix the task (nothing is changed) |
| POST | `/tasks/:id/check` | Runs the rules again; if the problem is gone the task becomes `done` |
| POST | `/tasks/:id/run` | Experimental: runs the agent on an approved task (202, needs `SLEEPY_EXPERIMENTAL_AGENT=1`) |
| GET | `/runs/:id` | Progress and result of a run: steps, branch, tests, diff |
| GET | `/repositories/:id/runs` | Latest run of each task of a repository |
| POST | `/system/pick-folder` | Opens the native folder dialog (Finder on macOS, zenity on Linux) |

POST, PATCH and DELETE requests must include the header `x-sleepy-client: web`, and every request
must be addressed to `localhost` / `127.0.0.1`. This keeps other websites from triggering actions.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs backend and frontend together |
| `pnpm dev:server` | Backend only |
| `pnpm dev:web` | Frontend only |
| `pnpm test` | Runs all tests (Vitest) |
| `pnpm typecheck` | Type-checks every workspace |
| `pnpm build` | Builds the frontend and type-checks the backend |

## Project structure

```text
sleepy-coder/
├── apps/
│   ├── web/        # Astro + React Islands dashboard (plain CSS)
│   └── server/     # Fastify API, listens on 127.0.0.1
├── packages/
│   ├── agent/      # Experimental agent: sandboxed workspace, test runner, edit pipeline
│   ├── analyzer/   # File scan, languages and stack detection
│   ├── git/        # Git inspection and agent worktrees (simple-git)
│   ├── ollama/     # Minimal Ollama client (native fetch)
│   ├── shared/     # Shared TypeScript types and constants
│   └── tasks/      # Task discovery, problem locations and fix guides
├── data/           # Local SQLite database, git-ignored
└── docs/           # Brief and architecture decisions
```

## Two kinds of tasks

| | **Find tasks** (rules) | **Suggest with AI** (Gemma 4B) |
|---|---|---|
| How | Fixed rules read your files | A small local model reads part of your code |
| Finds | TODO/FIXME, duplicate `<h1>`, `<img>` without `alt`, `<html>` without `lang`, missing README/LICENSE/tests | Refactors, docs, tests… anything |
| Reliable? | Yes: if it says it, it's in the code | No: ideas that can be wrong, so check them |
| Exact location | Yes, file and line | Only when the idea names real code |
| "Check again" | Yes, the rule runs again | No, you mark it as done |

Sleepy Coder labels AI tasks as **AI idea · verify it**. A small model is good at spotting
patterns and explaining fixes, but it sometimes describes code that is not there. When you ask
for a fix guide, Gemma sees the real file first and can say that the task does not apply.

## What I tried first: an autonomous agent

The first plan was for the agent to make the change itself: it created a `git worktree` on a
`sleepy/…` branch, asked Gemma for the edit, ran the tests and committed. The safety side worked
— it never broke anything or committed a bad change — but with a 4B local model the edits
themselves were not reliable. I tried three formats (whole files, search/replace blocks, and
retries with the check's feedback) and kept hitting new failures: the model reformatted code
instead of fixing it, dropped half a file, or "quoted" code that wasn't in the file.

The model was good at the other half: understanding the problem and explaining the fix. So
Sleepy Coder now does what it does reliably — rules find the exact lines, Gemma explains, you
edit, the rule checks — and the agent stays in the code as an **experimental** option
(`SLEEPY_EXPERIMENTAL_AGENT=1`) for bigger models. Details in ADR-023.

## Safety

Sleepy Coder only reads your repository. The experimental agent never touches your checkout: it works in a separate `git worktree` on
its own `sleepy/…` branch, can only read and write files inside it (no `..`, no symlink escapes,
no `.git`), cannot edit `package.json`, lockfiles, `.env` or tool configs, and the only command it
can trigger is your repository's own `test` script. Nothing is merged or pushed for you.
See ADR-018 and ADR-019 in [`docs/decisions.md`](docs/decisions.md).

## Tech stack

Astro · React · TypeScript · Fastify · Ollama · Vitest · plain CSS

## License

MIT
