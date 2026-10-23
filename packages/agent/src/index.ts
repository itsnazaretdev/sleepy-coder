export { isHiddenPath, protectedReason } from './protected.js';
export {
  detectTestCommand,
  linkDependencies,
  packageManagerFor,
  runTests,
  type TestCommand,
  type TestRunResult,
} from './test-runner.js';
export {
  MAX_LISTED_FILES,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  normalizeRelativePath,
  openWorkspace,
  WorkspaceError,
  type Workspace,
  type WorkspaceErrorCode,
} from './workspace.js';

// Agent run (Phase 5b)
export { gatherContext, MAX_EDITABLE_CHARS, type AgentContext } from './run/context.js';
export {
  AgentOutputError,
  applyEdits,
  applySearchReplace,
  MAX_EDIT_BLOCKS,
  parseEdits,
  unsafeEditReason,
  type ApplyResult,
  type ParsedEdits,
  type ProposedEdit,
  type ReplaceResult,
} from './run/edits.js';
export { executeTask, type ExecuteOptions, type ExecuteOutcome } from './run/execute.js';
export {
  buildEditMessages,
  buildFixMessages,
  EDIT_SCHEMA,
  MAX_CHANGED_FILES,
  type AgentMessage,
  type AgentModel,
  type AgentTask,
  type FileSnapshot,
  type FixFeedback,
} from './run/prompt.js';
