# 💤 Sleepy Coder

**Let your code sleep. We'll handle the boring stuff.**

Sleepy Coder is a local coding assistant that looks through your repositories for small,
boring problems — a duplicate `<h1>`, an image without `alt`, a forgotten `console.log`, a TODO
you never got back to — and shows you **exactly where each one is and how to fix it**.

It runs on your machine with a local model through [Ollama](https://ollama.com).
No cloud, no paid APIs, and it never changes your files: you make the fix, Sleepy Coder checks it.

> Built for the Hacktoberfest **Slow and Steady** challenge.

## What it finds

**With rules** (fast, no AI, reliable):

- **SEO:** duplicate `<h1>` on a page (it follows Astro layouts and components), missing
  `<title>`, missing `<meta name="description">`
- **Accessibility:** images without `alt`, links without readable text, `<html>` without `lang`
- **Code:** TODO / FIXME / HACK comments, leftover `console.log` in front-end code,
  `target="_blank"` without `rel="noopener"`
- **Repository:** missing README, LICENSE or tests

**With AI** (ideas from Gemma): refactors, documentation, tests… anything it notices in your code.
These are labelled **AI idea · verify it**: a small local model is good at spotting patterns,
but it can be wrong, so check them against your code.

## Requirements

- Node.js 22.13 or newer
- pnpm 10
- [Ollama](https://ollama.com) with a model installed. Gemma 3 4B works well on a 16 GB laptop:

  ```bash
  ollama pull gemma3:4b
  ```

## Install and run

```bash
git clone <this repository>
cd sleepy-coder
pnpm install
pnpm dev
```

Open **http://127.0.0.1:4321**. Make sure Ollama is running (open the Ollama app, or run
`ollama serve`): the dashboard shows whether it is connected and which model it will use.

Everything runs on `127.0.0.1`, so nothing is exposed to your network.

## How to use it

1. **Add a repository.** Go to **Repositories**, press **Choose folder…** and pick the root
   folder of a Git project. Sleepy Coder shows its languages, frameworks, tests and Git status.
2. **Find tasks.** Press **Find tasks** for the rule-based checks (instant), and
   **Suggest with AI** if you also want Gemma's ideas (takes a minute or two).
3. **Review them.** **Approve** what you want to fix and **Discard** what you don't.
4. **Open "How to fix"** on an approved task:
   - **Where:** the file, the line and the code around it, with an **Open in VS Code** link.
   - **How:** press **Ask Gemma how to fix it** for an explanation, the steps and suggested code
     you can copy. For AI ideas, Gemma reads the real file first and tells you if the task does
     not apply.
5. **Fix it in your editor** and save.
6. **Press "I fixed it — check again".** The same rule that found the problem runs again; if it
   is gone, the task moves to **Done**. AI ideas have no rule behind them, so you mark them as
   done yourself.

If a problem you fixed comes back later, the next **Find tasks** puts it back in **Pending**.

## Choosing the model

Sleepy Coder uses the first Gemma model it finds in Ollama. To use another one:

```bash
SLEEPY_MODEL=qwen2.5:3b pnpm dev
```

| Variable | Default |
|---|---|
| `SLEEPY_MODEL` | first installed Gemma model |
| `SLEEPY_OLLAMA_URL` | `http://127.0.0.1:11434` |
| `SLEEPY_EXPERIMENTAL_AGENT` | off (see below) |

## Why it doesn't fix things for you

The first version had an agent that made the changes on its own Git branch. It was safe — it
never broke anything — but with a 4B local model the edits were not reliable: it reformatted
code instead of fixing it, dropped parts of files, or quoted code that wasn't there.

The model was good at the other half: understanding a problem and explaining the fix. So Sleepy
Coder does what it does reliably — rules find the exact lines, Gemma explains, you edit, the rule
checks. The agent is still in the code as an experimental option for bigger models
(`SLEEPY_EXPERIMENTAL_AGENT=1`).

## For developers

Project structure, API, scripts and architecture decisions are in
[`docs/development.md`](docs/development.md) and [`docs/decisions.md`](docs/decisions.md).

Built with Astro · React · TypeScript · Fastify · SQLite · Ollama · Vitest · plain CSS.

## License

MIT