export { createGitInspector, type GitInspector } from './inspector.js';
export {
  AGENT_BRANCH_PREFIX,
  agentBranchName,
  commitAllChanges,
  createTaskWorktree,
  currentBranch,
  deleteAgentBranch,
  diffSince,
  removeTaskWorktree,
  WorktreeError,
  type FileChange,
  type TaskWorktree,
  type WorktreeDiff,
  type WorktreeErrorCode,
} from './worktree.js';
