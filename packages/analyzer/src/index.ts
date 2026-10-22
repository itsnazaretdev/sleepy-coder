export { analyzeStructure } from './analyze.js';
export { detectStack, isTestFile, type StackDetection } from './detect.js';
export { languageOf, summarizeLanguages } from './languages.js';
export {
  scanDirectory,
  IGNORED_DIRS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILES,
  type ScanOptions,
  type ScanResult,
  type ScannedFile,
} from './scan.js';
