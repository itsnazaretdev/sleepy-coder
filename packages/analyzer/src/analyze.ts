import type { StructureReport } from '@sleepy-coder/shared';
import { detectStack } from './detect.js';
import { summarizeLanguages } from './languages.js';
import { scanDirectory, type ScanOptions, type ScanResult } from './scan.js';

/**
 * Analyzes the files of a repository: size, languages and tech stack.
 * Read-only: never modifies anything on disk.
 */
export async function analyzeStructure(root: string, options: ScanOptions = {}): Promise<StructureReport> {
  return analyzeScan(root, await scanDirectory(root, options));
}

/** Same as analyzeStructure, reusing a scan you already have (avoids walking the repo twice). */
export async function analyzeScan(root: string, scan: ScanResult): Promise<StructureReport> {
  const stack = await detectStack(root, scan.files);

  return {
    files: {
      total: scan.files.length,
      totalBytes: scan.files.reduce((sum, f) => sum + f.size, 0),
      testFiles: stack.testFiles,
      truncated: scan.truncated,
    },
    languages: summarizeLanguages(scan.files),
    packageManagers: stack.packageManagers,
    frameworks: stack.frameworks,
    testingTools: stack.testingTools,
    configFiles: stack.configFiles,
    hasReadme: stack.hasReadme,
    hasLicense: stack.hasLicense,
  };
}
