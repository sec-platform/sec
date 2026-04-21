import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getWorkspacePaths } from '../../shared/paths.js';
import { listFilesRecursive, writeJson } from '../../shared/fs.js';
import { CompilerError } from '../../shared/errors.js';

async function runSuiteFiles(rootDir) {
  const files = (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith('.test.ts'))
    .sort((left, right) => left.localeCompare(right));
  const results = [];

  for (const file of files) {
    const moduleUrl = `${pathToFileURL(file).href}?t=${Date.now()}`;
    const testModule = await import(moduleUrl);
    if (typeof testModule.runSuite !== 'function') {
      throw new CompilerError('VERIFY-BUILD-002', `Test file "${file}" must export runSuite()`);
    }
    await testModule.runSuite();
    results.push(path.relative(rootDir, file).replaceAll('\\', '/'));
  }

  return results;
}

export async function verifyProject(workspaceRoot, lock) {
  const { projectRoot, verificationReportPath, lockPath } = getWorkspacePaths(workspaceRoot);

  if (lock.passStatus.adapt !== 'succeeded') {
    throw new CompilerError('VERIFY-BLOCKED-001', 'adapt must succeed before verify');
  }

  let unitPassed = [];
  let acceptancePassed = [];
  let failure = null;

  try {
    unitPassed = await runSuiteFiles(path.join(projectRoot, 'tests', 'unit'));
    acceptancePassed = await runSuiteFiles(path.join(projectRoot, 'tests', 'acceptance'));
  } catch (error) {
    failure = error;
  }

  const report = {
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
      stdout: failure ? '' : `unit:${unitPassed.join(',')} acceptance:${acceptancePassed.join(',')}`,
      stderr: failure ? String(failure.stack ?? failure.message ?? failure) : ''
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
