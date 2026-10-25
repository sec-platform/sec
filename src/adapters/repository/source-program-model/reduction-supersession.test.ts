import { expect, test } from 'bun:test';
import { sha256 } from '../../../contracts/canonical.ts';
import { createSourceProgramCompilationOperation } from './compilation-operation.ts';
import {
  compileSourceProgramSupersessionEvidence,
  compileSourceProgramSupersessionEvidenceIdentity,
  compileSourceProgramSupersessionReceipt,
  compileSourceProgramTestRetirementReceipt,
  parseSourceProgramSupersessionEvidence
} from './reduction.ts';
import { compileSourceProgramTestValue } from './test-value.ts';
import { compileSupersessionFixture, compileSupersessionSnapshot } from './test/supersession-fixture.ts';

// These exact, immutable evidence inputs are shared; each comparison keeps
// its own registration, current generation and independent operation budget.
const operationSources = {
  'src/example/operation.ts': "export function execute(): string { return 'ok'; }\n",
  'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
};
let operationBaseline: ReturnType<typeof compileSupersessionSnapshot> | undefined;
const dynamicSources = {
  'src/example/operation.ts': "export async function execute(specifier: string) { return import(specifier); }\n",
  'tests/example.test.ts': "import { test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', async () => { await execute('external'); });\n"
};
let dynamicBaseline: ReturnType<typeof compileSupersessionFixture> | undefined;

test('supersession evidence preserves a zero input admission ceiling and rejects negative budgets', () => {
  const sources = {
    'src/example/operation.ts': "export function execute(): string { return 'ok'; }\n"
  };
  const exact = compileSupersessionFixture(sources, true, true, [
    { resource: 'duration-ms', maximum: 1_000 },
    { resource: 'input-bytes', maximum: 0 }
  ]);

  expect(exact.evidence.intentEvidence[0]?.operationObligations[0]?.obligation.resources)
    .toEqual({
      aggregateBudgets: [
        { resource: 'duration-ms', maximum: 1_000 },
        { resource: 'input-bytes', maximum: 0 }
      ]
    });
  expect(() => compileSupersessionFixture(sources, true, true, [
    { resource: 'input-bytes', maximum: -1 }
  ])).toThrow();
});

test('supersession preserves production rename evidence without inventing test equivalence', () => {
  const baseline = compileSupersessionSnapshot({
    'src/example/legacy.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/legacy.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  });
  const current = compileSupersessionSnapshot({
    'src/example/current.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/current.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toEqual([expect.objectContaining({
    code: 'required-test-boundary-missing',
    baselinePaths: ['tests/example.test.ts']
  }), expect.objectContaining({
    code: 'test-introduction-decision-required', currentCandidateIds: [current.tests[0]!.testId]
  })]);
  expect(receipt.replacements.find(({ kind }) => kind === 'production')).toEqual(
    expect.objectContaining({
      baselinePaths: ['src/example/legacy.ts'],
      currentPaths: ['src/example/current.ts'],
      proof: 'exact-semantic-obligation'
    })
  );
});

test('supersession retains unchanged legacy inputs without admitting an unassessed introduction', () => {
  const baseline = operationBaseline ??= compileSupersessionSnapshot(operationSources);
  const current = compileSupersessionSnapshot({
    ...operationSources,
    'tests/another.test.ts': operationSources['tests/example.test.ts']
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toEqual([expect.objectContaining({
    code: 'test-introduction-decision-required', baselineId: null,
    currentCandidateIds: [current.tests.find(({ path }) => path === 'tests/another.test.ts')!.testId]
  })]);
  expect(receipt.replacements.filter(({ kind }) => kind === 'test')).toEqual([expect.objectContaining({
    baselinePaths: ['tests/example.test.ts'],
    currentPaths: ['tests/example.test.ts'],
    proof: 'retained-unassessed'
  })]);
});

test('supersession does not treat the same test occurrence as input or oracle equivalence', () => {
  const production = "export function execute(input: number): string { return input === 0 ? 'ok' : 'no'; }\n";
  const testSource = "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute(0)).toBe('ok'));\n";
  const baseline = compileSupersessionSnapshot({
    'src/example/operation.ts': production,
    'tests/example.test.ts': testSource
  });
  for (const changedTest of [
    testSource.replace('execute(0)', 'execute(1)'),
    testSource.replace("toBe('ok')", "toBe('no')")
  ]) {
    const current = compileSupersessionSnapshot({
      'src/example/operation.ts': production,
      'tests/example.test.ts': changedTest
    });
    // Equal-length source edits retain path/index/title/span occurrence identity.
    expect(current.tests[0]!.testId).toBe(baseline.tests[0]!.testId);
    const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
    expect(receipt.status).toBe('owner-decision-required');
    expect(receipt.replacements.filter(({ kind }) => kind === 'test')).toEqual([]);
    expect(receipt.findings).toContainEqual(expect.objectContaining({
      code: 'required-test-boundary-missing',
      baselineId: baseline.tests[0]!.testId,
      currentCandidateIds: [current.tests[0]!.testId]
    }));
  }
});

test('supersession separates semantic signatures from source occurrence identity', () => {
  const repeatedFixture = compileSupersessionFixture({
    'src/example/cli.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      "root.command('sample');",
      "root.command('sample');",
      ''
    ].join('\n'),
    'tests/example-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      "root.command('sample');",
      "root.command('sample');",
      ''
    ].join('\n')
  });
  const repeatedCommand = repeatedFixture.evidence;
  expect(repeatedFixture.full.model.entrypoints.filter(({ kind, path }) => (
    kind === 'cli-command' && path === 'tests/example-command.test.ts'
  ))).toHaveLength(2);
  expect(repeatedFixture.full.model.candidates.filter(({ code }) => code === 'duplicate-entrypoint-command'))
    .toEqual([expect.objectContaining({ subject: 'sample', paths: ['src/example/cli.ts'] })]);
  const repeatedUnits = repeatedCommand.entrypointUnits.filter((unit) => (
    unit.path === 'tests/example-command.test.ts'
  ));
  expect(repeatedUnits).toHaveLength(2);
  expect(new Set(repeatedUnits.map(({ signature }) => signature)).size).toBe(1);
  expect(new Set(repeatedUnits.map(({ occurrenceId }) => occurrenceId)).size).toBe(2);
  expect(new Set(repeatedUnits.map(({ id }) => id)).size).toBe(2);
  expect(compileSourceProgramSupersessionReceipt({
    baseline: repeatedCommand,
    current: repeatedCommand
  }).findings).not.toContainEqual(expect.objectContaining({
    code: expect.stringMatching(/evidence-invalid/u)
  }));

  const duplicateProduction = compileSupersessionSnapshot({
    'src/example/a.ts': 'export function execute(): number { return 1; }\n',
    'src/example/b.ts': 'export function execute(): number { return 1; }\n'
  });
  const productionUnits = duplicateProduction.productionUnits.filter(({ path }) => (
    path === 'src/example/a.ts' || path === 'src/example/b.ts'
  ));
  expect(productionUnits).toHaveLength(2);
  expect(new Set(productionUnits.map(({ signature }) => signature)).size).toBe(1);
  expect(new Set(productionUnits.map(({ id }) => id)).size).toBe(2);
  expect(compileSourceProgramSupersessionReceipt({
    baseline: duplicateProduction,
    current: duplicateProduction
  }).replacements.filter(({ kind }) => kind === 'production')).toHaveLength(2);

  const legacyUnit = Object.fromEntries(Object.entries(repeatedUnits[0]!)
    .filter(([key]) => key !== 'occurrenceId'));
  const legacyCanonical = Object.freeze({
    ...repeatedCommand,
    entrypointUnits: Object.freeze(repeatedCommand.entrypointUnits.map(unit => (
      unit.id === repeatedUnits[0]!.id ? legacyUnit : unit
    )))
  });
  const { evidenceDigest: _legacyDigest, ...legacyEvidenceWithoutDigest } = legacyCanonical;
  expect(() => parseSourceProgramSupersessionEvidence(Object.freeze({
    ...legacyEvidenceWithoutDigest,
    evidenceDigest: sha256(legacyEvidenceWithoutDigest)
  }))).toThrow('not canonical');
});

test('supersession refuses source-order matching for changed duplicate entrypoint occurrences', () => {
  const baselineFixture = compileSupersessionFixture({
    'tests/example-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      "root.command('sample');",
      ''
    ].join('\n')
  });
  const currentFixture = compileSupersessionFixture({
    'tests/example-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      'const unrelated = true;',
      "root.command('sample');",
      "if (unrelated) root.command('sample');",
      ''
    ].join('\n')
  });
  const currentTests = compileSourceProgramTestValue({
    repositoryRoot: 'C:/synthetic/repository',
    files: currentFixture.files,
    model: currentFixture.full.model,
    baselineTestPaths: ['tests/example-command.test.ts']
  });
  const currentEvidence = compileSourceProgramSupersessionEvidence({
    model: currentFixture.full.model,
    tests: currentTests,
    intentEvidence: currentFixture.full.intentEvidence,
    identity: currentFixture.identity
  });
  const ambiguousSupersession = compileSourceProgramSupersessionReceipt({
    baseline: baselineFixture.evidence,
    current: currentEvidence
  });
  expect(ambiguousSupersession.findings)
    .toContainEqual(expect.objectContaining({
      code: 'replacement-ambiguous',
      baselinePaths: ['tests/example-command.test.ts']
    }));
  const retirement = compileSourceProgramTestRetirementReceipt({
    baseline: baselineFixture.evidence,
    current: currentEvidence,
    supersession: ambiguousSupersession,
    currentModel: currentFixture.full.model,
    currentTestCompilation: currentTests,
    baselineFiles: baselineFixture.files,
    currentFiles: currentFixture.files
  });
  // This module is retained. Its ambiguous replacement remains a Supersession
  // failure, not an attempted whole-module retirement.
  expect(retirement.proofs).toEqual([]);
  expect(ambiguousSupersession.status).toBe('owner-decision-required');

  const twoPathBaseline = compileSupersessionSnapshot({
    'tests/first-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      "root.command('sample');",
      ''
    ].join('\n'),
    'tests/second-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      "root.command('sample');",
      ''
    ].join('\n')
  });
  const twoPathCurrent = compileSupersessionSnapshot({
    'tests/first-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      'const firstShift = true;',
      "root.command('sample');",
      ''
    ].join('\n'),
    'tests/second-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      'const secondShift = true;',
      "root.command('sample');",
      ''
    ].join('\n')
  });
  const twoPathReceipt = compileSourceProgramSupersessionReceipt({
    baseline: twoPathBaseline,
    current: twoPathCurrent
  });
  expect(twoPathReceipt.findings).not.toContainEqual(expect.objectContaining({
    code: 'replacement-ambiguous'
  }));
  expect(twoPathReceipt.replacements.filter(({ kind }) => kind === 'entrypoint')).toHaveLength(2);

  const collapsedCurrent = compileSupersessionSnapshot({
    'tests/example-command.test.ts': [
      "import { Command } from 'commander';",
      'const root = new Command();',
      'const shifted = true;',
      "if (shifted) root.command('sample');",
      ''
    ].join('\n')
  });
  const collapsed = compileSourceProgramSupersessionReceipt({
    baseline: compileSupersessionSnapshot({
      'tests/example-command.test.ts': [
        "import { Command } from 'commander';",
        'const root = new Command();',
        "root.command('sample');",
        "root.command('sample');",
        ''
      ].join('\n')
    }),
    current: collapsedCurrent
  });
  expect(collapsed.replacements.filter(({ kind }) => kind === 'entrypoint')).toHaveLength(0);
  expect(collapsed.findings.filter(({ code }) => code === 'replacement-ambiguous')).toHaveLength(2);
});

test('supersession evidence preserves strict grammar and deterministic exact ActionKey reuse', () => {
  const declarations = [
    'export function operation0(value: number): number { return value + 0; }',
    'export function operation1(value: number): number { return value + 1; }'
  ].join('\n');
  const fixture = compileSupersessionFixture({
    'src/example/operations.ts': `${declarations}\n`,
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { operation0 } from '../src/example/operations.ts';\ntest('executes', () => expect(operation0(1)).toBe(1));\n"
  });
  const replay = compileSourceProgramSupersessionEvidence({
    ...fixture.full,
    identity: fixture.identity
  });
  const identityFields = Object.keys(fixture.identityInput) as (keyof typeof fixture.identityInput)[];
  const changedEvidence = identityFields.map((field) => compileSourceProgramSupersessionEvidence({
    ...fixture.full,
    identity: compileSourceProgramSupersessionEvidenceIdentity(Object.freeze({
      ...fixture.identityInput,
      [field]: sha256({ field, previous: fixture.identityInput[field] })
    }))
  }));
  const { evidenceDigest: _evidenceDigest, ...validEvidence } = fixture.evidence;
  const malformedCanonical = Object.freeze({
    ...validEvidence,
    duplicateProjection: fixture.evidence.productionUnits
  });
  const malformedEvidence = Object.freeze({
    ...malformedCanonical,
    evidenceDigest: sha256(malformedCanonical)
  });
  expect(replay).toEqual(fixture.evidence);
  expect(replay.actionKey).toBe(fixture.evidence.actionKey);
  expect(new Set([
    fixture.evidence.actionKey,
    ...changedEvidence.map(({ actionKey }) => actionKey)
  ]).size).toBe(identityFields.length + 1);
  expect(changedEvidence.every(({ evidenceDigest }) =>
    evidenceDigest !== fixture.evidence.evidenceDigest)).toBe(true);
  expect(() => compileSourceProgramSupersessionEvidence({
    ...fixture.full,
    identity: Object.freeze({
      ...fixture.identity,
      schemaDigest: sha256({ foreignSchema: fixture.identity.schemaDigest })
    })
  })).toThrow('exact revision-bound inputs');
  // Extra projection fields fail grammar admission before any receipt is issued.
  expect(() => compileSourceProgramSupersessionReceipt({
    baseline: malformedEvidence,
    current: fixture.evidence
  })).toThrow('exact compact evidence grammar');
  // Valid grammar with a stale binding remains an interpretable invalid finding.
  const staleActionKeyCanonical = Object.freeze({
    ...validEvidence,
    actionKey: sha256({ staleActionKey: fixture.evidence.actionKey })
  });
  const staleActionKeyEvidence = Object.freeze({
    ...staleActionKeyCanonical,
    evidenceDigest: sha256(staleActionKeyCanonical)
  });
  expect(compileSourceProgramSupersessionReceipt({
    baseline: staleActionKeyEvidence,
    current: fixture.evidence
  }).findings).toContainEqual(expect.objectContaining({
    code: 'baseline-evidence-invalid'
  }));
  expect(compileSourceProgramSupersessionReceipt({
    baseline: fixture.evidence,
    current: replay
  })).toEqual(compileSourceProgramSupersessionReceipt({
    baseline: replay,
    current: fixture.evidence
  }));
});

test('source observations can invalidate but never expand an owner operation envelope', () => {
  const fixture = compileSupersessionFixture({
    'src/example/operation.ts': "export function execute(): void { Bun.spawn(['tool']); }\n",
    'tests/example.test.ts': "import { test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => execute());\n"
  });
  const evidence = fixture.full.intentEvidence[0]!.operationObligations[0]!;

  expect(evidence.obligation.effect.kinds).toEqual([]);
  expect(evidence.observation).toEqual(expect.objectContaining({
    status: 'unknown',
    reason: 'effect-closure-unresolved',
    effectKinds: ['process']
  }));
});

test('supersession rejects forged intent expansion and additional effect or failure categories as obligation proof', () => {
  const baseline = operationBaseline ??= compileSupersessionSnapshot(operationSources);
  const current = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { readFile } from 'node:fs/promises';\nimport { execute } from '../src/example/operation.ts';\ntest('executes and rejects invalid state', async () => { expect(execute()).toBe('ok'); await readFile('observation'); expect(() => { throw new Error('invalid'); }).toThrow(); });\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toEqual([expect.objectContaining({
    code: 'required-test-boundary-missing',
    currentCandidateIds: [current.tests[0]!.testId]
  }), expect.objectContaining({
    code: 'test-introduction-decision-required', currentCandidateIds: [current.tests[0]!.testId]
  })]);
  expect(receipt.replacements.filter(({ kind }) => kind === 'test')).toEqual([]);
  const owner = baseline.intentEvidence[0]!;
  const original = owner.operationObligations[0]!;
  const observation = Object.freeze({
    ...original.observation,
    effectKinds: Object.freeze(['process'])
  });
  const forgedObligationCanonical = Object.freeze({
    obligation: original.obligation,
    observation
  });
  const forgedObligation = Object.freeze({
    ...forgedObligationCanonical,
    evidenceDigest: sha256(forgedObligationCanonical)
  });
  const forgedOwnerCanonical = Object.freeze({
    owner: owner.owner,
    capabilityEnvelope: owner.capabilityEnvelope,
    publicEntrypointEnvelope: owner.publicEntrypointEnvelope,
    operationObligations: Object.freeze([forgedObligation])
  });
  const forgedOwner = Object.freeze({
    ...forgedOwnerCanonical,
    evidenceDigest: sha256(forgedOwnerCanonical)
  });
  const intentEvidence = Object.freeze([forgedOwner]);
  const source = Object.freeze({
    ...baseline.source,
    intentEvidenceDigest: sha256(intentEvidence)
  });
  const { evidenceDigest: _digest, ...withoutDigest } = baseline;
  const forgedCanonical = Object.freeze({
    ...withoutDigest,
    actionKey: sha256({ identity: baseline.identity, source }),
    source,
    intentEvidence
  });
  const forged = Object.freeze({
    ...forgedCanonical,
    evidenceDigest: sha256(forgedCanonical)
  });

  expect(() => parseSourceProgramSupersessionEvidence(forged))
    .toThrow('not canonical or action-bound');
});

test('supersession blocks a missing required production behavior', () => {
  const baseline = operationBaseline ??= compileSupersessionSnapshot(operationSources);
  const current = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute(): string { return 'changed'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('changed'));\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toContainEqual(expect.objectContaining({
    code: 'required-production-behavior-missing',
    baselinePaths: ['src/example/operation.ts']
  }));
});

test('supersession retains unchanged unresolved evidence across identical and different revision locators', () => {
  const fixture = dynamicBaseline ??= compileSupersessionFixture(dynamicSources);
  const unchanged = compileSourceProgramSupersessionReceipt({
    baseline: fixture.evidence, current: fixture.evidence
  });
  expect(unchanged.status).toBe('equivalent');
  expect(unchanged.findings).toEqual([]);
  expect(unchanged.lifecycleCost.current).toEqual(unchanged.lifecycleCost.baseline);
  const currentIdentity = compileSourceProgramSupersessionEvidenceIdentity({
    ...fixture.identityInput,
    revisionDigest: sha256({ revision: 'same-tree-current-commit' })
  });
  const current = compileSourceProgramSupersessionEvidence({
    ...fixture.full,
    identity: currentIdentity
  });

  expect(current.actionKey).not.toBe(fixture.evidence.actionKey);
  const receipt = compileSourceProgramSupersessionReceipt({
    baseline: fixture.evidence,
    current
  });
  expect(receipt.status).toBe('equivalent');
  expect(receipt.findings).toEqual([]);
  expect(receipt.lifecycleCost.current).toEqual(receipt.lifecycleCost.baseline);
  const controller = new AbortController();
  const operation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() + 30_000,
    signal: controller.signal
  });
  controller.abort();

  expect(() => compileSourceProgramSupersessionReceipt({
    baseline: fixture.evidence,
    current: fixture.evidence,
    operation
  })).toThrow('source-program-compilation-cancelled:supersession-receipt');
});

test('supersession blocks changed dynamic or external observations instead of inventing intent', () => {
  const baseline = (dynamicBaseline ??= compileSupersessionFixture(dynamicSources)).evidence;
  const current = compileSupersessionSnapshot({
    'src/example/operation.ts': "export async function execute(specifier: string) { return import(`prefix/${specifier}`); }\n",
    'tests/example.test.ts': "import { test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', async () => { await execute('external'); });\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toContainEqual(expect.objectContaining({
    code: 'dynamic-or-external-observation-unresolved'
  }));
});

test('supersession requires owner obligations only when a declared operation is replaced', () => {
  const baseline = compileSupersessionSnapshot({
    'src/example/legacy.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/legacy.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  }, true, false);
  const current = compileSupersessionSnapshot({
    'src/example/current.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/current.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  }, true, false);

  const receipt = compileSourceProgramSupersessionReceipt({
    baseline,
    current
  });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toContainEqual(expect.objectContaining({
    code: 'operation-obligation-unresolved',
    owner: 'example'
  }));
});

test('supersession resolves duplicate bytes by semantic target and never by relative path similarity', () => {
  const provider = "import { VALUE } from './value.ts';\nexport function execute(): number { return VALUE; }\n";
  const baseline = compileSupersessionSnapshot({
    'src/example/legacy/provider.ts': provider,
    'src/example/legacy/value.ts': 'export const VALUE = 1;\n',
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/legacy/provider.ts';\ntest('executes', () => expect(execute()).toBe(1));\n"
  });
  const current = compileSupersessionSnapshot({
    'src/example/a/provider.ts': provider,
    'src/example/a/value.ts': 'export const VALUE = 1;\n',
    'src/example/b/provider.ts': provider,
    'src/example/b/value.ts': 'export const VALUE = 2;\n',
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/a/provider.ts';\ntest('executes', () => expect(execute()).toBe(1));\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.findings).not.toContainEqual(expect.objectContaining({
    code: 'replacement-ambiguous',
    baselinePaths: ['src/example/legacy/provider.ts']
  }));
  expect(receipt.replacements).toContainEqual(expect.objectContaining({
    kind: 'production',
    baselinePaths: ['src/example/legacy/provider.ts'],
    currentPaths: ['src/example/a/provider.ts']
  }));
});
