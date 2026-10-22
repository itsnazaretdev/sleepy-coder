import type { StructureReport } from '@sleepy-coder/shared';
import type { RepositoryContext } from './context.js';

/** Provider-agnostic chat message, so this package does not depend on Ollama. */
export interface ModelMessage {
  role: 'system' | 'user';
  content: string;
}

export const MAX_AI_TASKS = 5;

export const AI_CATEGORIES = ['refactor', 'tests', 'documentation', 'maintenance'] as const;
const LEVELS = ['low', 'medium', 'high'] as const;
const COMPLEXITIES = ['small', 'medium', 'large'] as const;

/**
 * JSON Schema for the answer. Ollama uses it to constrain the model's output
 * ("structured outputs"); we still validate everything in parse.ts.
 */
export const SUGGESTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      maxItems: MAX_AI_TASKS,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string', enum: [...AI_CATEGORIES] },
          priority: { type: 'string', enum: [...LEVELS] },
          complexity: { type: 'string', enum: [...COMPLEXITIES] },
          risk: { type: 'string', enum: [...LEVELS] },
          affectedFiles: { type: 'array', items: { type: 'string' } },
          suggestedImplementation: { type: 'string' },
        },
        required: [
          'title',
          'description',
          'category',
          'priority',
          'complexity',
          'risk',
          'affectedFiles',
          'suggestedImplementation',
        ],
      },
    },
  },
  required: ['tasks'],
};

const SYSTEM_PROMPT = `You are Sleepy Coder, a careful senior developer reviewing a repository.
You suggest small, concrete, low-risk improvement tasks that an AI agent could do on its own
and that a human can review in a few minutes. You only answer with JSON that matches the given schema.`;

const list = (items: string[]) => (items.length > 0 ? items.join(', ') : 'none');

/** Builds the messages for the "suggest tasks" request. Instructions in English, output in Spanish. */
export function buildSuggestionMessages(
  structure: StructureReport,
  context: RepositoryContext,
  knownTitles: string[],
): ModelMessage[] {
  const languages = structure.languages.map((l) => `${l.language} ${l.percent}%`);

  const files =
    context.fileList.join('\n') + (context.omittedFiles > 0 ? `\n... and ${context.omittedFiles} more files` : '');

  const excerpts = context.excerpts
    .map((e) => `### ${e.path}${e.truncated ? ' (truncated)' : ''}\n\`\`\`\n${e.content}\n\`\`\``)
    .join('\n\n');

  const known = knownTitles.length > 0 ? knownTitles.map((t) => `- ${t}`).join('\n') : '- (none)';

  const user = `Repository summary:
- Languages: ${list(languages)}
- Frameworks: ${list(structure.frameworks)}
- Testing tools: ${list(structure.testingTools)}
- Test files: ${structure.files.testFiles}

Source files:
${files}

Code excerpts:
${excerpts || '(no source code)'}

Tasks that already exist (do NOT repeat them or suggest similar ones):
${known}

Rules:
- Suggest between 1 and ${MAX_AI_TASKS} tasks, based ONLY on the code shown above. Fewer good tasks are better than many vague ones.
- Each task must be specific: say which file and what exactly to change.
- Good tasks: small refactors (duplicated code, very long functions, unclear names, magic numbers), a test for a specific function shown above, missing error handling, accessibility fixes in markup (alt text, labels), comments for complex logic.
- Do NOT suggest: resolving TODO/FIXME comments, adding a README or LICENSE, "add tests" in general, upgrading dependencies, changing the framework, rewriting large parts of the project.
- affectedFiles must only contain paths from the "Source files" list.
- Write title, description and suggestedImplementation in Spanish (Spain). The title is a short imperative sentence of at most 80 characters, e.g. "Extraer la validación del formulario a una función".
- category: refactor | tests | documentation | maintenance. priority and risk: low | medium | high. complexity: small | medium | large.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
