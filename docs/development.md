# Development

Notes for people who want to work on Sleepy Coder itself. To use it, see the [README](../README.md).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs backend and frontend together |
| `pnpm dev:server` | Backend only (Fastify, port 4317) |
| `pnpm dev:web` | Frontend only (Astro, port 4321) |
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
│   └── tasks/      # Rules, AI suggestions, problem locations and fix guides
├── data/           # Local SQLite database (node:sqlite), git-ignored
└── docs/           # Brief, architecture decisions and these notes
```

Architecture decisions, and the reasons behind them, are in [`decisions.md`](decisions.md).
The original project brief is in [`brief.md`](brief.md).

## API

The web app talks to the backend over HTTP on `127.0.0.1:4317`.

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Backend status |
| GET | `/config` | What is turned on (`experimentalAgent`) |
| GET | `/ollama/status` | Ollama running?, version, installed models, selected model |
| POST | `/ollama/test` | Sends a short prompt to the selected model |
| GET | `/repositories` | Saved repositories |
| POST | `/repositories` | Adds a repository: `{ "path": "/abs/path" }` |
| DELETE | `/repositories/:id` | Removes it from the list (never deletes files) |
| GET | `/repositories/:id/analysis` | Read-only analysis: languages, stack, Git status, warnings |
| GET | `/repositories/:id/tasks` | Tasks of a repository (`?status=pending\|approved\|done\|discarded`) |
| POST | `/repositories/:id/tasks/hunt` | Looks for new tasks with rules (no AI) |
| POST | `/repositories/:id/tasks/suggest` | Asks the local model for improvement ideas (1–2 min) |
| PATCH | `/tasks/:id` | Approve, discard, mark as done or reset a task: `{ "status": "approved" }` |
| GET | `/tasks/:id/guide` | Where the problem is (no AI) and the last fix guide |
| POST | `/tasks/:id/guide` | Asks the local model how to fix the task (nothing is changed) |
| POST | `/tasks/:id/check` | Runs the rules again; if the problem is gone the task becomes `done` |
| POST | `/system/pick-folder` | Opens the native folder dialog (Finder on macOS, zenity on Linux) |
| POST | `/tasks/:id/run` | Experimental agent (202, needs `SLEEPY_EXPERIMENTAL_AGENT=1`) |
| GET | `/runs/:id` | Experimental: progress and result of a run |
| GET | `/repositories/:id/runs` | Experimental: latest run of each task |

POST, PATCH and DELETE requests must include the header `x-sleepy-client: web`, and every request
must be addressed to `localhost` / `127.0.0.1`. This keeps other websites from triggering actions.

## The experimental agent

The first plan was for an agent to make the changes itself. It works in a separate `git worktree`
on its own `sleepy/…` branch, can only read and write files inside it (no `..`, no symlink
escapes, no `.git`), cannot edit `package.json`, lockfiles, `.env` or tool configs, and the only
command it can run is the repository's own `test` script. Nothing is merged or pushed.

With a 4B local model the edits were not reliable, so it is off by default
(`SLEEPY_EXPERIMENTAL_AGENT=1` turns it on). See ADR-018 to ADR-023 in
[`decisions.md`](decisions.md).