# 💤 Sleepy Coder

**Let your code sleep. We'll handle the boring stuff.**

Sleepy Coder is a local-first AI coding assistant. It analyzes your repositories, finds
repetitive improvements (TODOs, missing tests, outdated docs…) and, once you approve them,
works through them on demand using a local model via [Ollama](https://ollama.com).
No cloud, no paid APIs: your code, your data, your machine.

> Built for the Hacktoberfest **Slow and Steady** challenge.

## Status

🚧 Phase 4 — Task Hunter. Add a local repository and Sleepy Coder shows its languages,
frameworks, testing tools and Git status, then finds tasks (TODO/FIXME comments, missing
tests, README or LICENSE) and asks the local model (Gemma) for improvement ideas. You approve
or discard each task. Next: the agent that carries out approved tasks.
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
| GET | `/repositories/:id/tasks` | Tasks of a repository (`?status=pending\|approved\|discarded`) |
| POST | `/repositories/:id/tasks/hunt` | Looks for new tasks (no AI) |
| POST | `/repositories/:id/tasks/suggest` | Asks the local model for improvement tasks (can take 1–2 min) |
| PATCH | `/tasks/:id` | Approve, discard or reset a task: `{ "status": "approved" }` |
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
│   ├── analyzer/   # File scan, languages and stack detection
│   ├── git/        # Read-only Git inspection (simple-git)
│   ├── ollama/     # Minimal Ollama client (native fetch)
│   ├── shared/     # Shared TypeScript types and constants
│   └── tasks/      # Task discovery (TODO/FIXME, missing tests/docs)
├── data/           # Local SQLite database, git-ignored
└── docs/           # Brief and architecture decisions
```

The `agent` package will be added in Phase 5.

## Tech stack

Astro · React · TypeScript · Fastify · Ollama · Vitest · plain CSS

## License

MIT
