import {
  CodexDevelopmentAffectedInventoryInputsV1,
  CodexDevelopmentBuildAffectedTestInventoryV1
} from './affected-test-inventory.ts';
import {
  CodexDevelopmentEvidenceCompositionDigestV1,
  CodexDevelopmentVerificationScopeV1,
  CodexDevelopmentVerificationSelectionDigestV1,
  type CodexDevelopmentExactGitBlobV1,
  type CodexDevelopmentRequiredGitBlobV1,
  type CodexDevelopmentVerificationScopeInventoryV1
} from './ci-evidence-reuse-contract.ts';
import {
  CodexDevelopmentCreateTestImpactTransitionObservationV1,
  type CodexDevelopmentGitChangedRecordV1
} from './ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from './ci-pr-risk-selection.ts';
import { CodexDevelopmentBuildVerificationPlanV1 } from './ci-verification-plan.ts';
import { uniqueSorted } from './collections.ts';
import {
  slowTestSuiteFiles
} from './test-budget-contract.ts';
import type { CodexDevelopmentTestImpactSourceProviderV1 } from './test-impact-contract.ts';

function requiredBlobs(
  currentHead: string,
  files: readonly string[],
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null
): CodexDevelopmentRequiredGitBlobV1[] {
  return uniqueSorted(files).map((file) => {
    const entry = gitBlob(currentHead, file);
    if (!entry || entry.type !== 'blob') {
      throw new Error(`Verification selector input is not an exact ordinary Git blob: ${file}.`);
    }
    return { path: file, ...entry };
  });
}

export function CodexDevelopmentBuildVerificationScopeInventoryV1(options: {
  profile: 'quick' | 'full';
  changedFiles: readonly string[];
  runtime: string;
  currentHead: string;
  baseHead: string;
  changedRecords: readonly CodexDevelopmentGitChangedRecordV1[];
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
  testImpactSourceProvider?: CodexDevelopmentTestImpactSourceProviderV1;
}): CodexDevelopmentVerificationScopeInventoryV1 {
  if (options.profile !== 'quick') {
    throw new Error('Evidence composition policy revision V1 supports Quick only.');
  }
  const fullChangedFiles = uniqueSorted(options.changedFiles);
  if (new Set(fullChangedFiles).size !== options.changedFiles.length) {
    throw new Error('Verification scope inventory changed files must be unique.');
  }
  const transition = CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha: options.baseHead,
    headSha: options.currentHead,
    records: options.changedRecords,
    readPathBlob: (revision, repositoryPath) => {
      const blob = options.gitBlob(revision, repositoryPath);
      return blob === null ? null : { mode: blob.mode, blobSha: blob.blobSha };
    }
  });
  const canonicalPlan = CodexDevelopmentBuildVerificationPlanV1(
    options.profile,
    fullChangedFiles,
    options.testImpactSourceProvider,
    transition
  );
  if (!canonicalPlan.selectionResolved) {
    throw new Error('Verification scope inventory cannot compose unresolved changed-path selection.');
  }
  const affected = CodexDevelopmentBuildAffectedTestInventoryV1(
    CodexDevelopmentAffectedInventoryInputsV1(
      fullChangedFiles,
      (file) => options.gitBlob(options.currentHead, file)?.type === 'blob'
    ),
    options.testImpactSourceProvider,
    transition
  );
  const risk = selectCiPrRiskSlowSuites(fullChangedFiles, options.testImpactSourceProvider, transition);
  if (!risk.resolved) {
    throw new Error('Verification scope inventory cannot compose unresolved changed-path selection.');
  }
  const appendScope = (
    scopes: ReturnType<typeof CodexDevelopmentVerificationScopeV1>[],
    id: string,
    argv: string[],
    selector: unknown,
    files: string[] = [],
    refinement: 'allowed' | 'forbidden' = 'forbidden'
  ): void => {
    scopes.push(CodexDevelopmentVerificationScopeV1(
      id,
      options.runtime,
      argv,
      selector,
      requiredBlobs(options.currentHead, files, options.gitBlob),
      scopes.length,
      {},
      refinement
    ));
  };
  const scopes: ReturnType<typeof CodexDevelopmentVerificationScopeV1>[] = [];
  for (const step of canonicalPlan.gates) {
    if (step.id === 'affected-tests') {
      appendScope(
        scopes,
        'gate:affected-tests',
        ['bun', ...step.args],
        { kind: 'canonical-affected-tests', gateId: step.id, inventory: affected },
        affected.selectedFastTests,
        'allowed'
      );
      continue;
    }
    if (step.id === 'impact-risk') {
      const suiteInventory = risk.suites.map((suiteId) => ({
        suiteId,
        files: slowTestSuiteFiles(suiteId)
      }));
      appendScope(
        scopes,
        'gate:impact-risk',
        ['bun', ...step.args],
        {
          kind: 'canonical-impact-risk',
          gateId: step.id,
          selection: risk,
          suiteInventory
        },
        [...suiteInventory.flatMap((suite) => suite.files), ...risk.slowTests],
        'allowed'
      );
      continue;
    }
    appendScope(
      scopes,
      `gate:${step.id}`,
      ['bun', ...step.args],
      { kind: 'canonical-gate', gateId: step.id }
    );
  }
  return {
    profile: options.profile,
    fullChangedFiles,
    fullChangedInputDigest: CodexDevelopmentBuildChangedInputDigestV1({
      records: options.changedRecords,
      baseHead: options.baseHead,
      currentHead: options.currentHead,
      gitBlob: options.gitBlob
    }),
    fullSelectionDigest: CodexDevelopmentVerificationSelectionDigestV1(
      options.profile,
      fullChangedFiles,
      scopes,
      CodexDevelopmentBuildChangedInputDigestV1({
        records: options.changedRecords,
        baseHead: options.baseHead,
        currentHead: options.currentHead,
        gitBlob: options.gitBlob
      })
    ),
    scopes
  };
}

export function CodexDevelopmentBuildChangedInputDigestV1(options: {
  records: readonly CodexDevelopmentGitChangedRecordV1[];
  baseHead: string;
  currentHead: string;
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
}): string {
  const records = [...options.records].sort((left, right) => {
    const leftKey = `${left.previousPath ?? ''}\0${left.path}\0${left.status}`;
    const rightKey = `${right.previousPath ?? ''}\0${right.path}\0${right.status}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  }).map((record) => {
    const basePath = record.previousPath ?? record.path;
    const baseEntry = options.gitBlob(options.baseHead, basePath);
    const currentEntry = options.gitBlob(options.currentHead, record.path);
    if (record.status === 'added' && (baseEntry !== null || currentEntry === null)) {
      throw new Error(`Changed-input added identity mismatch: ${record.path}.`);
    }
    if (record.status === 'removed' && (baseEntry === null || currentEntry !== null)) {
      throw new Error(`Changed-input removed identity mismatch: ${record.path}.`);
    }
    if (record.status !== 'added' && record.status !== 'removed' && (baseEntry === null || currentEntry === null)) {
      throw new Error(`Changed-input ordinary blob identity mismatch: ${record.path}.`);
    }
    return {
      status: record.status,
      path: record.path,
      previousPath: record.previousPath ?? null,
      baseEntry,
      currentEntry
    };
  });
  return CodexDevelopmentEvidenceCompositionDigestV1({ records });
}
