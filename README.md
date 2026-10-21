# 💤 Sleepy Coder

**Let your code sleep. We'll handle the boring stuff.**

Sleepy Coder is a local-first AI coding assistant. It analyzes your repositories, finds
repetitive improvements (TODOs, missing tests, outdated docs…) and, once you approve them,
works through them on demand using a local model via [Ollama](https://ollama.com).
No cloud, no paid APIs: your code, your data, your machine.

> Built for the Hacktoberfest **Slow and Steady** challenge.

## Status

🚧 Phase 2 — Ollama integration. The dashboard shows whether Ollama is running, lists your
installed models and can send a test prompt. See the roadmap in [`docs/brief.md`](docs/brief.md).

## Requirements

- Node.js 20 or newer
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
│   ├── ollama/     # Minimal Ollama client (native fetch)
│   └── shared/     # Shared TypeScript types and constants
├── data/           # Local SQLite database (git-ignored)
└── docs/           # Brief and architecture decisions
```

More packages (`git`, `analyzer`, `tasks`, `agent`) will be added in later phases.

## Tech stack

Astro · React · TypeScript · Fastify · Ollama · Vitest · plain CSS

## License

MIT
