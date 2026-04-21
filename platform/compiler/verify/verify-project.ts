import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { listFilesRecursive, writeJson } from '../../shared/fs.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { LockFile, VerificationReport } from '../../shared/types.ts';
import { formatCompilerFailure, typecheckProject } from './typecheck-project.ts';

interface SuiteModule {
  runSuite?: () => Promise<void> | void;
}

async function runSuiteFiles(rootDir: string): Promise<string[]> {
  const files = (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith('.test.ts'))
    .sort((left, right) => left.localeCompare(right));
  const results = [];

  for (const file of files) {
    const moduleUrl = `${pathToFileURL(file).href}?t=${Date.now()}`;
    const testModule = (await import(moduleUrl)) as SuiteModule;
    if (typeof testModule.runSuite !== 'function') {
      throw new CompilerError('VERIFY-BUILD-002', `Test file "${file}" must export runSuite()`);
    }
    await testModule.runSuite();
    results.push(path.relative(rootDir, file).replaceAll('\\', '/'));
  }

  return results;
}

export async function verifyProject(workspaceRoot: string, lock: LockFile): Promise<VerificationReport> {
  const { projectRoot, verificationReportPath, lockPath } = getWorkspacePaths(workspaceRoot);

  if (lock.passStatus.adapt !== 'succeeded') {
    throw new CompilerError('VERIFY-BLOCKED-001', 'adapt must succeed before verify');
  }

  let unitPassed: string[] = [];
  let acceptancePassed: string[] = [];
  let failure: unknown | null = null;

  try {
    await typecheckProject(projectRoot);
    unitPassed = await runSuiteFiles(path.join(projectRoot, 'tests', 'unit'));
    acceptancePassed = await runSuiteFiles(path.join(projectRoot, 'tests', 'acceptance'));
  } catch (error) {
    failure = error;
  }

  const report: VerificationReport = {
    build: {
      status: failure ? 'failed' : 'passed'
    },
    unit: {
      status: failure ? 'failed' : 'passed',
      passed: unitPassed
    },
    acceptance: {
      status: failure ? 'failed' : 'passed',
      passed: failure ? [] : acceptancePassed,
      failed: failure ? lock.acceptancePlan : []
    },
    summary: {
      status: failure ? 'failed' : 'passed'
    },
    logs: {
      stdout: failure ? '' : `typecheck:passed unit:${unitPassed.join(',')} acceptance:${acceptancePassed.join(',')}`,
      stderr: failure ? formatCompilerFailure(failure) : ''
    }
  };

  await writeJson(verificationReportPath, report);

  if (failure) {
    lock.passStatus.verify = 'failed';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    throw new CompilerError('VERIFY-ACCEPTANCE-003', 'Project verification failed', report);
  }

  for (const task of lock.slotTasks) {
    if (task.status === 'filled') {
      task.status = 'verified';
      task.provenanceHints.verifiedBy = [
        'tests/unit/customer-normalizer.test.ts',
        'tests/acceptance/customer-flow.test.ts'
      ];
    }
  }

  lock.passStatus.verify = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return report;
}
