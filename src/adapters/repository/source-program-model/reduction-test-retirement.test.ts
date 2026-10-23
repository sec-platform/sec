import { expect, test } from 'bun:test';
import { sha256 } from '../../../contracts/canonical.ts';
import {
  compileSourceProgramSupersessionEvidence,
  compileSourceProgramSupersessionReceipt,
  compileSourceProgramTestRetirementReceipt,
  projectSourceProgramTestRetirementDispositions,
  reconcileSourceProgramTestValueWithSupersession
} from './reduction.ts';
import { compileSourceProgramTestRewriteDispositions } from './test-disposition-decisions.ts';
import { compileSourceProgramTestBaselineEvidence, compileSourceProgramTestValue } from './test-value.ts';
import { compileSupersessionFixture } from './test/supersession-fixture.ts';

function compileTestRetirementFixture(
  baselineTestSource: string,
  productionSource = "export const value = 'ok';\n",
  currentTestSource?: string,
  currentTestPath = 'tests/obsolete.test.ts',
  ownerRewrite = false
) {
  const baseline = compileSupersessionFixture({
    'src/example/operation.ts': productionSource,
    'tests/obsolete.test.ts': baselineTestSource
  });
  const current = compileSupersessionFixture({
    'src/example/operation.ts': productionSource,
    ...(currentTestSource === undefined ? {} : { [currentTestPath]: currentTestSource })
  });
  const baselineTestPaths = ['tests/obsolete.test.ts'];
  const baselineEvidence = compileSourceProgramTestBaselineEvidence({
    baselineTestPaths,
    baselineModel: baseline.full.typeScriptModel,
    candidateModel: current.full.typeScriptModel,
    baselineRevision: baseline.evidence.identity.sourceRevision
  });
  let currentTests = compileSourceProgramTestValue({
    repositoryRoot: 'C:/synthetic/repository',
    files: current.files,
    model: current.full.model,
    baselineTestPaths,
    baselineEvidence
  });
  if (ownerRewrite) {
    const dispositions = compileSourceProgramTestRewriteDispositions({
      compilation: currentTests,
      baselineEvidence,
      batches: [Object.freeze({
        baselineDigest: currentTests.baselineDigest,
        owner: 'repository-test-value',
        decisions: Object.freeze([Object.freeze({
          path: 'tests/obsolete.test.ts',
          replacementPaths: Object.freeze([currentTestPath]),
          reason: 'The replacement intentionally rewrites the useful public test obligation.'
        })])
      })]
    });
    currentTests = compileSourceProgramTestValue({
      repositoryRoot: 'C:/synthetic/repository',
      files: current.files,
      model: current.full.model,
      baselineTestPaths,
      baselineEvidence,
      dispositions
    });
  }
  const currentEvidence = compileSourceProgramSupersessionEvidence({
    model: current.full.model,
    tests: currentTests,
    intentEvidence: current.full.intentEvidence,
    identity: current.identity
  });
  const supersession = compileSourceProgramSupersessionReceipt({
    baseline: baseline.evidence,
    current: currentEvidence
  });
  const observedProjection = reconcileSourceProgramTestValueWithSupersession(
    currentTests,
    supersession
  );
  const retirement = compileSourceProgramTestRetirementReceipt({
    baseline: baseline.evidence,
    current: currentEvidence,
    supersession,
    currentModel: current.full.model,
    currentTestCompilation: currentTests,
    baselineFiles: baseline.files,
    currentFiles: current.files
  });
  return Object.freeze({
    baseline,
    current,
    currentEvidence,
    currentTests,
    observedProjection,
    retirement,
    supersession
  });
}

test('test retirement does not demand deletion of a retained behavior test', () => {
  const source = "import { expect, test } from 'bun:test';\nimport { value } from '../src/example/operation.ts';\ntest('public value', () => expect(value).toBe('ok'));\n";
  const fixture = compileTestRetirementFixture(source, undefined, source);
  const projection = projectSourceProgramTestRetirementDispositions(
    fixture.observedProjection,
    fixture.retirement
  );

  expect(fixture.retirement.baselineTestPathsDigest).toBe(
    'sha256:f5bf0e0e7e123d5140ba4d1c6403e68a68ba38b2a6ae87f6dc7fe3686a1b9ccc'
  );
  expect(fixture.retirement.proofs).toEqual([]);
  expect(projection.dispositions.some(({ disposition }) => disposition === 'delete')).toBe(false);
});

test('test retirement cannot merge a success obligation into a failure-only observation', () => {
  const production = "export function execute(invalid = false): string { if (invalid) throw new Error('invalid'); return 'ok'; }\n";
  const baseline = "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n";
  const replacement = "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('rejects invalid input', () => expect(() => execute(true)).toThrow('invalid'));\n";
  const fixture = compileTestRetirementFixture(
    baseline, production, replacement, 'tests/replacement.test.ts'
  );
  const projection = projectSourceProgramTestRetirementDispositions(
    fixture.observedProjection,
    fixture.retirement
  );

  expect(fixture.supersession.status).toBe('owner-decision-required');
  expect(fixture.supersession.replacements.filter(({ kind }) => kind === 'test')).toEqual([]);
  expect(fixture.observedProjection.dispositions).toContainEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts', disposition: 'unknown'
  }));
  expect(fixture.retirement.proofs).toContainEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts', status: 'blocked'
  }));
  expect(projection.dispositions).toContainEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts', disposition: 'unknown'
  }));
});

test('test retirement does not demand consumer-zero proof after an exact owner rewrite', () => {
  const baseline = "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n";
  const replacement = "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes and rejects invalid input', () => { expect(execute()).toBe('ok'); expect(() => execute(true)).toThrow('invalid'); });\n";
  const fixture = compileTestRetirementFixture(
    baseline,
    "export function execute(invalid = false): string { if (invalid) throw new Error('invalid'); return 'ok'; }\n",
    replacement,
    'tests/replacement.test.ts',
    true
  );

  expect(fixture.currentTests.dispositions).toContainEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts', disposition: 'rewrite'
  }));
  expect(fixture.retirement.proofs).toEqual([]);
  expect(fixture.observedProjection.findings.some(({ path, code }) =>
    path === 'tests/obsolete.test.ts' && code === 'test-module-disposition-unknown')).toBe(false);
});

test('test retirement rejects a caller-forged Supersession decision', () => {
  const production = "export function execute(invalid = false): string { if (invalid) throw new Error('invalid'); return 'ok'; }\n";
  const baseline = "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n";
  const replacement = "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes and rejects invalid input', () => { expect(execute()).toBe('ok'); expect(() => execute(true)).toThrow('invalid'); });\n";
  const fixture = compileTestRetirementFixture(
    baseline, production, replacement, 'tests/replacement.test.ts'
  );
  const canonicalForged = Object.freeze({
    ...fixture.supersession,
    replacements: Object.freeze(fixture.supersession.replacements.map((replacementEvidence) =>
      replacementEvidence.kind === 'test'
        ? Object.freeze({ ...replacementEvidence, baselineId: sha256('caller-selected-test') })
        : replacementEvidence))
  });
  const { receiptDigest: _receiptDigest, ...forgedWithoutDigest } = canonicalForged;
  const forged = Object.freeze({
    ...forgedWithoutDigest,
    receiptDigest: sha256(forgedWithoutDigest)
  });

  expect(() => compileSourceProgramTestRetirementReceipt({
    baseline: fixture.baseline.evidence,
    current: fixture.currentEvidence,
    supersession: forged,
    currentModel: fixture.current.full.model,
    currentTestCompilation: fixture.currentTests,
    baselineFiles: fixture.baseline.files,
    currentFiles: fixture.current.files
  })).toThrow('exact Supersession decision recomputed from sealed evidence');
});

test('test retirement derives DELETE only from one compiler-issued consumer-zero receipt', () => {
  const fixture = compileTestRetirementFixture('// obsolete module with no observable contract\n');
  const proof = fixture.retirement.proofs[0]!;
  const projection = projectSourceProgramTestRetirementDispositions(
    fixture.observedProjection,
    fixture.retirement
  );

  expect(proof).toEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts',
    status: 'retired',
    reason: null,
    census: { producerCount: 0, consumerCount: 0, externalContractCount: 0 },
    observationClasses: [],
    consumerEvidence: [],
    unknownEvidence: []
  }));
  expect(projection.dispositions).toContainEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts',
    disposition: 'delete',
    evidence: expect.objectContaining({
      replacementTestIds: [],
      supersession: expect.objectContaining({ proof: 'consumer-zero' })
    })
  }));
  expect(projection.findings.some(({ path, code }) =>
    path === 'tests/obsolete.test.ts' && code === 'test-module-disposition-unknown')).toBe(false);
  expect(() => projectSourceProgramTestRetirementDispositions(
    fixture.observedProjection,
    { ...fixture.retirement }
  )).toThrow('compiler-issued exact receipt');

  const foreignBaselineEvidence = compileSourceProgramSupersessionEvidence({
    ...fixture.baseline.full,
    intentEvidence: Object.freeze([]),
    identity: fixture.baseline.identity
  });
  const foreignCurrentEvidence = compileSourceProgramSupersessionEvidence({
    ...fixture.current.full,
    intentEvidence: Object.freeze([]),
    identity: fixture.current.identity
  });
  const foreignReceipt = compileSourceProgramSupersessionReceipt({
    baseline: foreignBaselineEvidence,
    current: foreignCurrentEvidence
  });

  expect(() => compileSourceProgramTestRetirementReceipt({
    baseline: fixture.baseline.evidence,
    current: fixture.currentEvidence,
    supersession: foreignReceipt,
    currentModel: fixture.current.full.model,
    currentTestCompilation: fixture.currentTests,
    baselineFiles: fixture.baseline.files,
    currentFiles: fixture.current.files
  })).toThrow('sealed baseline/current Source Program evidence: supersession-receipt');
});

test('test retirement blocks real consumers, path contracts, dynamic imports, and parse unknowns', () => {
  const fixtures = [
    compileTestRetirementFixture(
      "import { value } from '../src/example/operation.ts';\nvoid value;\n"
    ),
    compileTestRetirementFixture(
      '// test path is consumed by the production registry\n',
      "export const retiredPath = 'tests/obsolete.test.ts';\n"
    ),
    compileTestRetirementFixture(
      '// test path is consumed through a relative production literal\n',
      "export const retiredPath = '../../tests/obsolete.test.ts';\n"
    ),
    compileTestRetirementFixture(
      "const target = '../src/example/operation.ts';\nvoid import(target);\n"
    ),
    compileTestRetirementFixture('export const malformed = ;\n')
  ];

  expect(fixtures.map(({ retirement }) => retirement.proofs[0]?.status))
    .toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'blocked']);
  expect(fixtures.map(({ retirement }) => retirement.proofs[0]?.reason))
    .toEqual([
      'consumer-closure-not-empty',
      'consumer-closure-not-empty',
      'consumer-closure-not-empty',
      'consumer-closure-not-empty',
      'consumer-closure-not-empty'
    ]);
  for (const fixture of fixtures) {
    const projection = projectSourceProgramTestRetirementDispositions(
      fixture.observedProjection,
      fixture.retirement
    );
    expect(projection.dispositions).toContainEqual(expect.objectContaining({
      path: 'tests/obsolete.test.ts',
      disposition: 'unknown'
    }));
  }
});

test('test retirement preserves behavior, Effect, durable, failure, and algorithm observations', () => {
  const fixtures = [
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('behavior', () => expect(execute()).toBe('ok'));\n",
      "export function execute(): string { return 'ok'; }\n"
    ),
    compileTestRetirementFixture(
      "import { test } from 'bun:test';\nimport { readFile } from 'node:fs/promises';\ntest('effect', async () => { await readFile('state'); });\n"
    ),
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\nimport { readFile, writeFile } from 'node:fs/promises';\ntest('durable', async () => { await writeFile('state', 'x'); expect(await readFile('state', 'utf8')).toBe('x'); });\n"
    ),
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\ntest('failure', () => expect(() => { throw new Error('failure'); }).toThrow());\n"
    ),
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\ntest('property', () => { for (const value of [1, 2]) expect(value).toBeGreaterThan(0); });\n"
    )
  ];
  const classes = fixtures.map(({ retirement }) => retirement.proofs[0]!.observationClasses);

  expect(classes[0]).toContain('behavior');
  expect(classes[1]).toContain('effect');
  expect(classes[2]).toEqual(expect.arrayContaining(['durable-state', 'effect']));
  expect(classes[3]).toContain('failure-boundary');
  expect(classes[4]).toContain('algorithm-property');
  expect(fixtures.every(({ retirement }) => retirement.proofs[0]?.status === 'blocked')).toBe(true);
});
