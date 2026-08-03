import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  SecReviewEvidenceReferenceV1,
  SecReviewExpectedBindingV1,
  SecReviewFindingV1,
  SecReviewReportV1
} from '../../platform/shared/review-finding-contract.ts';
import { parseDocumentationAuthorityRegistry } from '../../platform/shared/documentation-authority-contract.ts';
import {
  SEC_REVIEW_REPORT_SCHEMA,
  SEC_REVIEW_RESTATEMENT_POLICY
} from '../../platform/shared/review-finding-contract.ts';

const ROOT = path.resolve(import.meta.dir, '../..');
export const BASE_SHA = '1'.repeat(40);
export const HEAD_SHA = '2'.repeat(40);
export const TREE_SHA = '3'.repeat(40);
export const INSTRUCTION_SHA = '4'.repeat(40);
export const REVIEWER_ID = 'trusted-architecture-reviewer';
export const CONTRACT_DIGEST = `sha256:${'a'.repeat(64)}` as const;
export const SOURCE_DIGEST = `sha256:${'b'.repeat(64)}` as const;
export const POLICY_DIGEST = `sha256:${'c'.repeat(64)}` as const;
export const POLICY_PATH = 'docs/work-packages/review-policy-v1.md' as const;
export const CHANGED_PATHS = [
  'platform/shared/review-finding-contract.ts',
  'tests/contract/review-finding-contract.test.ts'
] as const;

export type MutableReport = Record<string, any>;

export async function registry() {
  return parseDocumentationAuthorityRegistry(await readFile(
    path.join(ROOT, 'docs/authority.json'),
    'utf8'
  ));
}

export function evidence(
  kind: SecReviewEvidenceReferenceV1['kind'],
  reference: string,
  revisionSha: string | null,
  digest: SecReviewEvidenceReferenceV1['digest']
): SecReviewEvidenceReferenceV1 {
  return { kind, reference, revisionSha, digest };
}

export function finding(
  id: string,
  severity: SecReviewFindingV1['severity'] = 'nit'
): SecReviewFindingV1 {
  const blocking = severity === 'p0' || severity === 'p1' || severity === 'p2';
  return {
    id,
    severity,
    title: blocking ? 'Canonical invariant is violated' : 'Naming could be clearer',
    path: 'platform/shared/review-finding-contract.ts',
    line: blocking ? 10 : null,
    lineRevisionSha: blocking ? HEAD_SHA : null,
    symbol: 'bindSecCurrentReviewReportV1',
    ownerAuthorityId: 'development-governance',
    invariant: blocking
      ? 'Current review decisions must preserve exact identity, verified evidence and orthogonal truth.'
      : 'Names should remain consistent with the surrounding contract vocabulary.',
    basis: blocking ? 'canonical-contract' : 'preference',
    evidenceRefs: blocking ? [
      evidence(
        'canonical-contract',
        'docs/development-governance.md#review',
        INSTRUCTION_SHA,
        CONTRACT_DIGEST
      ),
      evidence(
        'source-location',
        'platform/shared/review-finding-contract.ts#L10-L12',
        HEAD_SHA,
        SOURCE_DIGEST
      )
    ] : [],
    confidence: 'confirmed',
    limitation: null,
    remediationConstraint: blocking
      ? 'Bind Evidence bytes and preserve freshness, completeness and blocking independently.'
      : null
  };
}

export function report(findings: SecReviewFindingV1[] = []): SecReviewReportV1 {
  return {
    schema: SEC_REVIEW_REPORT_SCHEMA,
    repository: 'sec-platform/sec',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    treeSha: TREE_SHA,
    trustedInstructionSha: INSTRUCTION_SHA,
    reviewerRole: 'architecture-reviewer',
    reviewerId: REVIEWER_ID,
    containsExternalText: false,
    restatementPolicy: SEC_REVIEW_RESTATEMENT_POLICY,
    scope: {
      reviewedPaths: [...CHANGED_PATHS],
      unreviewedPaths: [],
      limitation: null
    },
    findings
  };
}

export function observationKey(value: { revisionSha: string | null; path: string }): string {
  return `${value.revisionSha ?? 'physical'}\0${value.path}`;
}

export function observedEvidence(
  value: SecReviewReportV1
): SecReviewExpectedBindingV1['observedEvidence'] {
  const observations = new Map<string, SecReviewExpectedBindingV1['observedEvidence'][number]>();
  for (const item of value.findings.flatMap((entry) => entry.evidenceRefs)) {
    const observation = {
      revisionSha: item.revisionSha,
      path: item.reference.split('#')[0]!,
      digest: item.digest
    };
    observations.set(observationKey(observation), observation);
  }
  observations.set(observationKey({ revisionSha: INSTRUCTION_SHA, path: POLICY_PATH }), {
    revisionSha: INSTRUCTION_SHA,
    path: POLICY_PATH,
    digest: POLICY_DIGEST
  });
  return [...observations.values()].sort((left, right) => (
    observationKey(left) < observationKey(right) ? -1 :
      observationKey(left) > observationKey(right) ? 1 : 0
  ));
}

export function expected(
  value: SecReviewReportV1 | MutableReport,
  blockingSeverities: SecReviewExpectedBindingV1['blockingPolicy']['blockingSeverities'] = [
    'p0', 'p1', 'p2'
  ]
): SecReviewExpectedBindingV1 {
  const typed = value as SecReviewReportV1;
  return {
    repository: 'sec-platform/sec',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    treeSha: TREE_SHA,
    trustedInstructionSha: INSTRUCTION_SHA,
    reviewerRole: 'architecture-reviewer',
    reviewerId: REVIEWER_ID,
    changedPaths: [...CHANGED_PATHS],
    blockingPolicy: {
      sourcePath: POLICY_PATH,
      revisionSha: INSTRUCTION_SHA,
      digest: POLICY_DIGEST,
      blockingSeverities
    },
    observedEvidence: observedEvidence(typed)
  };
}
