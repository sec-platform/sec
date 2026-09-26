import { compareCodeUnits, sha256 } from '../../../contracts/canonical.ts';
import {
  isRepositoryTestModulePath,
  normalizeRepositoryTestModulePath
} from '../../../contracts/repository-test-path.ts';
import type {
  SourceProgramTestBaselineEvidence,
  SourceProgramTestValueCompilation
} from './test-value.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;

interface SourceProgramTestRewriteDecision {
  readonly path: string;
  readonly replacementPaths: readonly string[];
  readonly reason: string;
}

export interface SourceProgramTestRewriteDecisionBatch {
  /** Exact tracked-test baseline to which these one-way decisions apply. */
  readonly baselineDigest: string;
  readonly owner: string;
  readonly decisions: readonly SourceProgramTestRewriteDecision[];
}

function decisionError(field: string, detail: string): never {
  throw new Error(`invalid source-program test rewrite decision ${field}: ${detail}`);
}

function canonicalDecisionPath(value: string, field: string): string {
  if (typeof value !== 'string' || !isRepositoryTestModulePath(value)) {
    return decisionError(field, 'expected a canonical SEC test-module path');
  }
  const normalized = normalizeRepositoryTestModulePath(value);
  if (normalized !== value) return decisionError(field, 'path is not canonical');
  return normalized;
}

/**
 * Compile stable repository-owner rewrite decisions into the exact disposition
 * input consumed by Test Value.  The stable source records paths and reasons;
 * this compiler binds them to the current source revision, baseline census and
 * candidate registration ids.  DELETE/MERGE remain exclusive to Source Program
 * proof and cannot be authored through this route.
 */
export function compileSourceProgramTestRewriteDispositions(input: Readonly<{
  compilation: SourceProgramTestValueCompilation;
  baselineEvidence: readonly SourceProgramTestBaselineEvidence[];
  batches: readonly SourceProgramTestRewriteDecisionBatch[];
}>): readonly unknown[] {
  if (!Array.isArray(input.batches)) return decisionError('batches', 'expected an array');
  const batchDigests = new Set<string>();
  for (const [batchIndex, batch] of input.batches.entries()) {
    if (!DIGEST.test(batch.baselineDigest)) {
      decisionError(`batches[${batchIndex}].baselineDigest`, 'expected a sha256 digest');
    }
    if (batchDigests.has(batch.baselineDigest)) {
      decisionError(`batches[${batchIndex}].baselineDigest`, 'duplicate baseline digest');
    }
    batchDigests.add(batch.baselineDigest);
    if (!OWNER_ID.test(batch.owner)) {
      decisionError(`batches[${batchIndex}].owner`, 'expected a bounded owner id');
    }
    if (!Array.isArray(batch.decisions)) {
      decisionError(`batches[${batchIndex}].decisions`, 'expected an array');
    }
  }

  const active = input.batches.find(({ baselineDigest }) =>
    baselineDigest === input.compilation.baselineDigest);
  if (active === undefined) return Object.freeze([]);
  const activeDecisions: readonly SourceProgramTestRewriteDecision[] = active.decisions;

  const evidenceByPath = new Map(input.baselineEvidence.map((evidence) =>
    [evidence.path, evidence] as const));
  const unknownDispositionPaths = new Set(input.compilation.dispositions
    .filter(({ disposition }) => disposition === 'unknown')
    .map(({ path }) => path));
  const registrationsByPath = new Map<string, string[]>();
  for (const registration of input.compilation.records) {
    const ids = registrationsByPath.get(registration.path) ?? [];
    ids.push(registration.testId);
    registrationsByPath.set(registration.path, ids);
  }

  const seenPaths = new Set<string>();
  const dispositions = activeDecisions.map((
    decision: SourceProgramTestRewriteDecision,
    decisionIndex: number
  ) => {
    const field = `decision[${decisionIndex}]`;
    const decisionPath = canonicalDecisionPath(decision.path, `${field}.path`);
    if (seenPaths.has(decisionPath)) decisionError(`${field}.path`, 'duplicate decision path');
    seenPaths.add(decisionPath);
    if (!unknownDispositionPaths.has(decisionPath)) {
      decisionError(`${field}.path`, 'path is not one unresolved missing baseline test');
    }
    if (!Array.isArray(decision.replacementPaths) || decision.replacementPaths.length === 0) {
      decisionError(`${field}.replacementPaths`, 'expected at least one replacement test path');
    }
    if (typeof decision.reason !== 'string'
        || decision.reason.length === 0
        || decision.reason.length > 512
        || decision.reason !== decision.reason.normalize('NFC')
        || decision.reason.includes('\0')) {
      decisionError(`${field}.reason`, 'expected bounded non-empty NFC text without NUL');
    }
    const replacementPaths = decision.replacementPaths.map((
      replacementPath: string,
      replacementIndex: number
    ) => canonicalDecisionPath(
      replacementPath,
      `${field}.replacementPaths[${replacementIndex}]`
    ));
    if (new Set(replacementPaths).size !== replacementPaths.length) {
      decisionError(`${field}.replacementPaths`, 'duplicate replacement path');
    }
    if (replacementPaths.includes(decisionPath)) {
      decisionError(`${field}.replacementPaths`, 'a missing test cannot replace itself');
    }
    const replacementTestIds = replacementPaths.flatMap((replacementPath: string) => {
      const ids = registrationsByPath.get(replacementPath) ?? [];
      if (ids.length === 0) {
        decisionError(`${field}.replacementPaths`, `no current test registrations for ${replacementPath}`);
      }
      return ids;
    }).sort(compareCodeUnits);
    const baseline = evidenceByPath.get(decisionPath);
    if (baseline === undefined) {
      decisionError(`${field}.path`, 'missing exact baseline census evidence');
    }
    const ownerDecisionDigest = sha256({
      baselineDigest: active.baselineDigest,
      owner: active.owner,
      path: decisionPath,
      replacementPaths: [...replacementPaths].sort(compareCodeUnits),
      reason: decision.reason
    });
    return Object.freeze({
      path: decisionPath,
      disposition: 'rewrite' as const,
      evidence: Object.freeze({
        owner: active.owner,
        sourceRevision: input.compilation.sourceRevision,
        replacementTestIds: Object.freeze(replacementTestIds),
        census: baseline.census,
        supersession: null,
        ownerDecisionDigest
      })
    });
  }).sort((left, right) => compareCodeUnits(left.path, right.path));

  return Object.freeze(dispositions);
}
