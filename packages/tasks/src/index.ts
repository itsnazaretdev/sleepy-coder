export { huntStaticTasks, type StaticHuntResult } from './hunt.js';
export { tasksFromStructure } from './report-tasks.js';
export {
  astroImports,
  countH1,
  findMarkupIssues,
  htmlWithoutLang,
  imagesWithoutAlt,
  mainH1Source,
  parseMarkup,
  renderedH1,
  type MarkupFile,
} from './markup.js';
export {
  endsInsideString,
  findTodos,
  findTodosInText,
  todoToTask,
  MAX_TODOS,
  type TodoComment,
  type TodoMarker,
} from './todos.js';

// AI suggestions (Phase 4b)
export { buildRepositoryContext, type CodeExcerpt, type ContextOptions, type RepositoryContext } from './ai/context.js';
export { AiOutputError, normalizeTitle, parseSuggestions, type ParseOptions, type ParseResult } from './ai/parse.js';
export { buildSuggestionMessages, MAX_AI_TASKS, SUGGESTION_SCHEMA, type ModelMessage } from './ai/prompt.js';
export { suggestTasks, type SuggestOptions, type SuggestResult, type TaskModel } from './ai/suggest.js';

// Fix guides (ADR-023)
export { codeNames, locateTask, MAX_LOCATIONS, SNIPPET_CONTEXT, type LocatableTask } from './locate.js';
export {
  buildGuideMessages,
  GUIDE_SCHEMA,
  MAX_GUIDE_STEPS,
  MAX_GUIDE_SUGGESTIONS,
  parseGuide,
  writeFixGuide,
  type ParsedGuide,
} from './ai/guide.js';
