# Architecture decisions

Short records of the important choices and why they were made.

## ADR-001 — Astro and Fastify as separate apps

**Decision:** The frontend (`apps/web`, Astro) and the backend (`apps/server`, Fastify)
are independent applications. Astro API routes are not used.

**Why:** The backend needs long-running work (agent sessions), filesystem and Git access,
Ollama calls and SSE streaming. Keeping it separate makes those responsibilities clear and
lets the frontend stay a static site.

## ADR-002 — Static Astro output (SSG) + React Islands

**Decision:** Astro builds static pages. Dynamic data is fetched by React Islands from the
backend over HTTP; live progress will use SSE.

**Why:** SSR would add a second server with no real benefit, since all logic and data live
in Fastify.

## ADR-003 — Loopback-only backend with strict CORS

**Decision:** The backend binds to `127.0.0.1:4317`. CORS only allows the local Astro origins
(`localhost:4321` and `127.0.0.1:4321`).

**Why:** Sleepy Coder will be able to read repositories and run commands. It must never be
reachable from the network, and random websites open in the browser must not be able to call it.

## ADR-004 — Plain CSS with custom properties

**Decision:** No CSS framework. Theme tokens are CSS custom properties on `:root`.

**Why:** Easier to read and learn from at this stage. Tokens keep the dark/violet theme in
one place, and a later move to a framework stays simple.

## ADR-005 — Shared packages export TypeScript source

**Decision:** Workspace packages (e.g. `@sleepy-coder/shared`) export `src/index.ts`
directly instead of a compiled `dist`.

**Why:** No build step between packages. Both `tsx` (server) and Vite (web) compile TS
on the fly. The server therefore runs with `tsx` instead of plain `node`.

## ADR-006 — On-demand execution only

**Decision:** No schedulers, cron jobs or background daemons. Work Sessions are always
started by the user and only run while the backend is running.

**Why:** Keeps the user in control and avoids needing an always-on machine.
See "Execution Philosophy" in `docs/brief.md`.

## ADR-007 — Own Ollama client on native fetch

**Decision:** `packages/ollama` talks to the Ollama REST API with the built-in `fetch`
instead of the `ollama` npm library. It exposes a small `OllamaClient` interface
(`getVersion`, `listModels`, `chat`) and typed errors (`unreachable`, `timeout`,
`model-not-found`, `bad-response`).

**Why:** We only need three endpoints. Owning the client means no extra dependency, explicit
timeouts (the first prompt loads the model and can be slow on a laptop), and an interface
that is trivial to fake in tests. Swapping the provider later only means implementing the
same interface.

## ADR-008 — Model selection

**Decision:** If `SLEEPY_MODEL` is set, that model is used (and flagged if not installed).
Otherwise the first installed Gemma model is used, then any installed model.

**Why:** Works out of the box with the existing Gemma install, while letting the user switch
(e.g. to `qwen2.5:3b`) without touching code. A Settings screen can replace the env var later.

## ADR-009 — "Ollama off" is a normal state

**Decision:** `GET /ollama/status` always returns 200 with `running: true | false`.
Only real request failures (e.g. `POST /ollama/test`) map to 4xx/5xx codes.

**Why:** The backend itself is healthy when Ollama is closed; the UI just needs to show it
and explain how to start it.

## ADR-010 — Saved repositories in a JSON file (for now)

**Decision:** The list of repositories is stored in `data/repositories.json` behind a
`RepositoryStore` interface. Writes are serialized and atomic (temp file + rename).

**Why:** Phase 3 only needs a short list. SQLite (planned in the stack) will arrive with
Phase 4, when tasks and history need real queries; only the store implementation changes.

## ADR-011 — Repository paths are validated and analysis is read-only

**Decision:** A path is accepted only if it is absolute (`~` is expanded), exists, is a
folder and is the root of a Git repository. It is stored resolved with `realpath`, so the
same folder reached through a symlink or a trailing slash is detected as a duplicate.
The id is a hash of that path. The scanner skips symlinks and generated folders and stops
at 20,000 files. Git is only inspected with fixed, read-only commands.

**Why:** These checks are the base for the safety rules of later phases (the agent must
never leave the repository). Analysis must never change anything on disk.

## ADR-012 — Own stack detection instead of Tree-sitter (for now)

**Decision:** Phase 3 detects languages by extension and the stack from manifests
(`package.json`, `composer.json`, `pom.xml`, …) and lockfiles.

**Why:** It is fast, has no dependencies and is enough for a structural overview.

## ADR-013 — Native folder dialog opened by the backend

**Decision:** `POST /system/pick-folder` makes the backend open the OS dialog
(`osascript` "choose folder" on macOS, `zenity` on Linux) and return the chosen path.
Typing the path stays available as a fallback. Commands and arguments are fixed; only
one dialog can be open at a time; it gives up after 5 minutes.

**Why:** Browsers never expose a folder's real path to a web page (not with drag & drop,
not with `<input type="file">`). Since the backend runs on the user's machine, it can show
the native dialog instead, which is much easier than copying paths.

## ADR-014 — Protection against other websites and DNS rebinding

**Decision:** Every request must be addressed to `localhost`, `127.0.0.1` or `[::1]`.
Every POST/DELETE must carry the `x-sleepy-client: web` header.

**Why:** CORS only stops other sites from *reading* responses; a simple POST is still
*sent*. A custom header forces a CORS preflight, which is rejected for any origin other
than our web app. The Host check blocks DNS rebinding. This matters before the agent is
able to modify code (Phase 5).
Tree-sitter is kept for Phase 4/5, where real code parsing (functions, TODOs in context)
is needed.