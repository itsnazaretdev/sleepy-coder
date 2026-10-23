/** Provider-agnostic chat message (the server plugs Ollama in). */
export interface AgentMessage {
  role: 'system' | 'user';
  content: string;
}

/** Anything that can answer a chat with JSON. */
export interface AgentModel {
  complete(messages: AgentMessage[], schema: Record<string, unknown>): Promise<string>;
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  suggestedImplementation: string;
  affectedFiles: string[];
  category: string;
}

export interface FileSnapshot {
  path: string;
  content: string;
}

export const MAX_CHANGED_FILES = 3;

/**
 * JSON Schema for the model's answer: a summary and a list of search/replace blocks.
 * An empty "search" means "this is the whole content" (to create a new file).
 */
export const EDIT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    changes: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          search: { type: 'string' },
          replace: { type: 'string' },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
  required: ['summary', 'changes'],
};

const SYSTEM_PROMPT = `You are Sleepy Coder, a careful developer agent working on a local repository.
You make the smallest change that completes the task, and nothing else.
You only answer with JSON that matches the given schema.
You describe changes as search/replace blocks: you copy the exact text to change from the file, and give its replacement.`;

const FORMAT_EXAMPLE = `{
  "summary": "Changed the logo heading to a paragraph.",
  "changes": [
    {
      "path": "src/components/Header.astro",
      "search": "<h1 class=\\"logo\\">My site</h1>",
      "replace": "<p class=\\"logo\\">My site</p>"
    }
  ]
}`;

function fence(file: FileSnapshot): string {
  return `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
}

function rules(testingTools: string[]): string {
  const tools = testingTools.length > 0 ? testingTools.join(', ') : 'the existing test framework';
  return `How to write changes:
- Each item of "changes" is one search/replace block: "search" is text copied EXACTLY from the current file (a few lines, enough to be unique in that file) and "replace" is the new text for it.
- Use several blocks for several places. Everything outside the "search" text stays as it is.
- To create a NEW file, use "search": "" and put the whole file in "replace".
- Example:
${FORMAT_EXAMPLE}

Rules:
- Change or create at most ${MAX_CHANGED_FILES} files. Only touch what the task needs.
- Do not reformat, re-indent, join or split lines you are not changing. A change that only moves spaces or line breaks is rejected.
- If the task is about something that is not in the files shown, do not invent a change: return an empty "changes" list and explain why in the summary.
- Never write placeholders such as "// ... rest of the code", "// existing code" or "...".
- You cannot change package.json, lockfiles, .env files, CI files or tool configuration files (*.config.js, *.config.ts…). Do not add new dependencies.
- New tests must use ${tools} and follow the naming already used in the repository.
- Paths are relative to the repository root.
- summary: one or two sentences in English describing what you changed.`;
}

/** First request: do the task. */
export function buildEditMessages(
  task: AgentTask,
  context: { fileList: string[]; files: FileSnapshot[] },
  testingTools: string[],
): AgentMessage[] {
  const files = context.files.length > 0 ? context.files.map(fence).join('\n\n') : '(no file content provided)';

  const user = `Task: ${task.title}
Description: ${task.description}
How to do it: ${task.suggestedImplementation}

Repository files:
${context.fileList.join('\n')}

Current content of the relevant files:
${files}

${rules(testingTools)}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

const MAX_FEEDBACK_IN_PROMPT = 4_000;

/** Why the model gets a second chance. */
export type FixFeedback =
  /** The tests passed before the change and fail after it. */
  | { kind: 'tests'; output: string }
  /** The automatic check that found the task still finds the problem. */
  | { kind: 'check'; problem: string };

/** Follow-up request: the change broke the tests, or did not solve the task. */
export function buildFixMessages(
  task: AgentTask,
  files: FileSnapshot[],
  feedback: FixFeedback,
  testingTools: string[],
): AgentMessage[] {
  let intro: string;
  if (feedback.kind === 'tests') {
    const output =
      feedback.output.length > MAX_FEEDBACK_IN_PROMPT
        ? `…${feedback.output.slice(-MAX_FEEDBACK_IN_PROMPT)}`
        : feedback.output;
    intro = `You already changed the files below, but now the tests fail. Fix your change so the tests pass.
Do not delete or skip tests to make them pass.

Test output:
\`\`\`
${output}
\`\`\``;
  } else {
    intro = `Your change did not solve the task: the automatic check still finds this problem:
"${feedback.problem.slice(0, MAX_FEEDBACK_IN_PROMPT)}"
Change the files below so the problem is really solved.`;
  }

  const user = `Task: ${task.title}
Description: ${task.description}
How to do it: ${task.suggestedImplementation}

${intro}

Current content of the files:
${files.map(fence).join('\n\n')}

${rules(testingTools)}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
