import { expect, test } from 'bun:test';

import {
  bindSecCurrentReviewReportV1,
  type SecReviewEvidenceReferenceV1
} from '../../platform/shared/review-finding-contract.ts';
import {
  BASE_SHA,
  CONTRACT_DIGEST,
  expected,
  finding,
  HEAD_SHA,
  INSTRUCTION_SHA,
  observationKey,
  registry,
  report,
  SOURCE_DIGEST
} from './review-finding-fixtures.ts';
import type { MutableReport } from './review-finding-fixtures.ts';

test('blocking findings require owner contract, exact source line, evidence and remediation', async () => {
  const authority = await registry();
  const base = report([finding('p1-defect', 'p1')]);

  const preference = structuredClone(base) as MutableReport;
  preference.findings[0].basis = 'preference';
  expect(() => bindSecCurrentReviewReportV1(preference, authority, expected(preference))).toThrow(
    'cannot use preference'
  );

  const noEvidence = structuredClone(base) as MutableReport;
  noEvidence.findings[0].evidenceRefs = [];
  expect(() => bindSecCurrentReviewReportV1(noEvidence, authority, expected(noEvidence))).toThrow(
    'requires evidence references'
  );

  const lowConfidence = structuredClone(base) as MutableReport;
  lowConfidence.findings[0].confidence = 'high';
  lowConfidence.findings[0].limitation = 'A second reproduction remains unavailable.';
  expect(() => bindSecCurrentReviewReportV1(lowConfidence, authority, expected(lowConfidence))).toThrow(
    'p1 requires confirmed confidence'
  );

  const noRemediation = structuredClone(base) as MutableReport;
  noRemediation.findings[0].remediationConstraint = null;
  expect(() => bindSecCurrentReviewReportV1(noRemediation, authority, expected(noRemediation))).toThrow(
    'requires a remediation constraint'
  );

  const noLine = structuredClone(base) as MutableReport;
  noLine.findings[0].line = null;
  noLine.findings[0].lineRevisionSha = null;
  expect(() => bindSecCurrentReviewReportV1(noLine, authority, expected(noLine))).toThrow(
    'requires an exact finding line and revision'
  );

  const noOwnerContract = structuredClone(base) as MutableReport;
  noOwnerContract.findings[0].evidenceRefs = noOwnerContract.findings[0].evidenceRefs.filter(
    (entry: SecReviewEvidenceReferenceV1) => entry.kind !== 'canonical-contract'
  );
  expect(() => bindSecCurrentReviewReportV1(
    noOwnerContract,
    authority,
    expected(noOwnerContract)
  )).toThrow('requires the owning canonical contract');

  const noLocation = structuredClone(base) as MutableReport;
  noLocation.findings[0].evidenceRefs = noLocation.findings[0].evidenceRefs.filter(
    (entry: SecReviewEvidenceReferenceV1) => entry.kind !== 'source-location'
  );
  expect(() => bindSecCurrentReviewReportV1(noLocation, authority, expected(noLocation))).toThrow(
    'requires source-location evidence'
  );

  const wrongLocationRevision = structuredClone(base) as MutableReport;
  wrongLocationRevision.findings[0].evidenceRefs[1].revisionSha = BASE_SHA;
  expect(() => bindSecCurrentReviewReportV1(
    wrongLocationRevision,
    authority,
    expected(wrongLocationRevision)
  )).toThrow('covering its line');

  const wrongLine = structuredClone(base) as MutableReport;
  wrongLine.findings[0].evidenceRefs[1].reference =
    'platform/shared/review-finding-contract.ts#L20-L22';
  expect(() => bindSecCurrentReviewReportV1(wrongLine, authority, expected(wrongLine))).toThrow(
    'covering its line'
  );
});

test('Evidence references bind exact revisions and observed bytes', async () => {
  const authority = await registry();
  const base = report([finding('p1-defect', 'p1')]);

  const wrongContractRevision = structuredClone(base) as MutableReport;
  wrongContractRevision.findings[0].evidenceRefs[0].revisionSha = HEAD_SHA;
  expect(() => bindSecCurrentReviewReportV1(
    wrongContractRevision,
    authority,
    expected(wrongContractRevision)
  )).toThrow('must bind trustedInstructionSha');

  const wrongSourceRevision = structuredClone(base) as MutableReport;
  wrongSourceRevision.findings[0].evidenceRefs[1].revisionSha = INSTRUCTION_SHA;
  expect(() => bindSecCurrentReviewReportV1(
    wrongSourceRevision,
    authority,
    expected(wrongSourceRevision)
  )).toThrow('must bind baseSha or headSha');

  const reversed = structuredClone(base) as MutableReport;
  reversed.findings[0].evidenceRefs[1].reference =
    'platform/shared/review-finding-contract.ts#L12-L10';
  expect(() => bindSecCurrentReviewReportV1(reversed, authority, expected(reversed))).toThrow(
    'line range is reversed'
  );

  const digestMismatch = structuredClone(expected(base)) as any;
  digestMismatch.observedEvidence[1].digest = CONTRACT_DIGEST;
  expect(() => bindSecCurrentReviewReportV1(base, authority, digestMismatch)).toThrow(
    'digest mismatch'
  );

  const missingObserved = structuredClone(expected(base)) as any;
  missingObserved.observedEvidence.pop();
  expect(() => bindSecCurrentReviewReportV1(base, authority, missingObserved)).toThrow(
    'must exactly match'
  );

  const extraObserved = structuredClone(expected(base)) as any;
  extraObserved.observedEvidence.push({
    revisionSha: HEAD_SHA,
    path: 'tests/contract/review-finding-contract.test.ts',
    digest: SOURCE_DIGEST
  });
  extraObserved.observedEvidence.sort((left: any, right: any) => (
    observationKey(left) < observationKey(right) ? -1 :
      observationKey(left) > observationKey(right) ? 1 : 0
  ));
  expect(() => bindSecCurrentReviewReportV1(base, authority, extraObserved)).toThrow(
    'must exactly match'
  );
});

test('findings cannot escape reviewed scope or target non-owning authority', async () => {
  const authority = await registry();

  const outside = structuredClone(report([finding('p1-defect', 'p1')])) as MutableReport;
  outside.findings[0].path = 'docs/product.md';
  expect(() => bindSecCurrentReviewReportV1(outside, authority, expected(outside))).toThrow(
    'inside the reviewed scope'
  );

  const projection = structuredClone(report([finding('p1-defect', 'p1')])) as MutableReport;
  projection.findings[0].ownerAuthorityId = 'root-readme';
  expect(() => bindSecCurrentReviewReportV1(projection, authority, expected(projection))).toThrow(
    'must be one owning canonical authority'
  );
});
