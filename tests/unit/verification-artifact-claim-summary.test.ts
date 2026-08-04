import { expect, test } from 'bun:test';

import {
  classifySemanticMutationIsolatedVerificationArtifactSet,
  type SemanticMutationIsolatedVerificationArtifactSet
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  buildClaimSummary
} from '../../platform/compiler/verify/verify-project.ts';
import {
  buildProductVerificationClaimPlan,
  projectProductVerificationGateClaim
} from '../../platform/shared/product-verification-claim-plan.ts';
import {
  isCanonicalVerificationArtifactSet,
  type CurrentCanonicalVerificationReport
} from '../../platform/shared/verification-artifact-contract.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentAssertVerificationAggregateResultV1,
  type VerificationGateResultV1,
  type VerificationResultStatus
} from '../../platform/shared/verification-result-contract.ts';
import type { VerificationReport } from '../../platform/shared/verification-types.ts';

const INPUT_REVISION = `sha256:${'1'.repeat(64)}`;
const SEMANTIC_REVISION = `sha256:${'2'.repeat(64)}`;

type ClassifierProxyTrap =
  | 'get'
  | 'getPrototypeOf'
  | 'ownKeys'
  | 'getOwnPropertyDescriptor'
  | 'has';

function classifierProxyHandler<T extends object>(
  trapCalls: ClassifierProxyTrap[],
  throwOnTrap: boolean
): ProxyHandler<T> {
  const record = (trap: ClassifierProxyTrap): void => {
    trapCalls.push(trap);
    if (throwOnTrap) throw new Error(`classifier candidate Proxy trap executed: ${trap}`);
  };
  return {
    get(target, property, receiver) {
      record('get');
      return Reflect.get(target, property, receiver);
    },
    getPrototypeOf(target) {
      record('getPrototypeOf');
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      record('ownKeys');
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      record('getOwnPropertyDescriptor');
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      record('has');
      return Reflect.has(target, property);
    }
  };
}

function classifierProxy<T extends object>(target: T, throwOnTrap: boolean = false) {
  const trapCalls: ClassifierProxyTrap[] = [];
  return {
    proxy: new Proxy(target, classifierProxyHandler(trapCalls, throwOnTrap)),
    trapCalls
  };
}

function revokedClassifierProxy<T extends object>(target: T) {
  const trapCalls: ClassifierProxyTrap[] = [];
  const revocable = Proxy.revocable(target, classifierProxyHandler(trapCalls, true));
  revocable.revoke();
  return { proxy: revocable.proxy, trapCalls };
}

function runtimeProductBinding(supportsClaim: boolean = true) {
  return projectProductVerificationGateClaim('runtime', supportsClaim);
}

function policyReport() {
  return {
    status: 'passed' as const,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

function semanticBundle() {
  return {
    snapshot: {
      ir: {
        inputRevision: INPUT_REVISION,
        semanticRevision: SEMANTIC_REVISION
      }
    },
    generatorPlan: {
      inputRevision: INPUT_REVISION,
      semanticRevision: SEMANTIC_REVISION,
      tasks: []
    },
    semanticViews: {
      formatVersion: '1',
      inputRevision: INPUT_REVISION,
      semanticRevision: SEMANTIC_REVISION,
      views: []
    },
    semanticContractSources: []
  };
}

function artifactSet(status: 'passed' | 'failed'): SemanticMutationIsolatedVerificationArtifactSet {
  const policy = policyReport();
  const fastLogs = { stdout: 'fast-verification', stderr: '' };
  const runtimeLogs = status === 'passed'
    ? { stdout: 'runtime-verification', stderr: '' }
    : { stdout: '', stderr: 'runtime-verification-failed' };
  const fast = {
    status: 'passed' as const,
    build: { status: 'passed' as const },
    unit: { status: 'passed' as const, passed: [] },
    acceptance: { status: 'passed' as const, passed: [], failed: [] },
    policy: { status: 'passed' as const, violations: [] },
    policyReport: policy,
    logs: fastLogs
  };
  const runtime = status === 'passed' ? {
    status: 'passed' as const,
    build: { status: 'passed' as const, passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed' as const, passed: ['runtime-unit'], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'passed' as const,
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: runtimeLogs
  } : {
    status: 'failed' as const,
    build: { status: 'failed' as const, passed: [], failed: ['next build'], command: 'bun run build' },
    unit: { status: 'skipped' as const, passed: [], failed: [], command: null },
    acceptance: { status: 'skipped' as const, passed: [], failed: [], command: null },
    logs: runtimeLogs
  };
  const claimSummary = buildClaimSummary('all', fast, runtime, 'full', policy);
  const legacyStatus = claimSummary.overall.overallStatus === 'passed' ? 'passed' : 'failed';

  return {
    childExitCode: status === 'passed' ? 0 : 1,
    verificationReport: {
      build: fast.build,
      unit: fast.unit,
      acceptance: fast.acceptance,
      policy: fast.policy,
      fast,
      runtime,
      summary: {
        status: legacyStatus,
        requestedLane: 'all' as const,
        failedLanes: status === 'passed' ? [] : ['runtime'],
        claimSummary
      },
      logs: {
        stdout: [fastLogs.stdout, runtimeLogs.stdout].filter(Boolean).join('\n'),
        stderr: [fastLogs.stderr, runtimeLogs.stderr].filter(Boolean).join('\n')
      }
    },
    runtimeReport: runtime,
    policyReport: policy,
    acceptanceCoverage: {
      formatVersion: '1',
      status: runtime.status,
      acceptancePassed: [],
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    },
    semanticBundle: semanticBundle()
  };
}

function canonicalReport(
  artifacts: SemanticMutationIsolatedVerificationArtifactSet
): CurrentCanonicalVerificationReport {
  return artifacts.verificationReport as CurrentCanonicalVerificationReport;
}

function artifactSetWithUnifiedRuntimeStatus(
  status: Exclude<VerificationResultStatus, 'passed' | 'failed'>
): SemanticMutationIsolatedVerificationArtifactSet {
  const candidate = structuredClone(artifactSet('passed'));
  const report = canonicalReport(candidate);
  const gates = report.summary.claimSummary.gates;
  const runtimeGate = gates.find((gate) => gate.gateId === runtimeProductBinding().gateId);
  if (!runtimeGate) throw new Error('current buildClaimSummary runtime gate is missing');

  runtimeGate.status = status;
  runtimeGate.disposition = 'not-executed';
  runtimeGate.reasonCode = status === 'not-run'
    ? 'current-runner-not-owning-environment'
    : status === 'unsupported'
      ? 'capability-unsupported'
      : 'input-invalidated';
  runtimeGate.applicability = status === 'invalidated' ? 'unresolved' : 'required';
  runtimeGate.supportedClaims = [];
  runtimeGate.environment = null;
  runtimeGate.execution = null;

  const overall = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: buildProductVerificationClaimPlan('all'),
    gateResults: gates
  });
  Object.assign(report.summary.claimSummary.overall, overall);
  report.summary.status = 'failed';
  report.summary.failedLanes = [];
  return { ...candidate, childExitCode: 1 };
}

test('actual all-lane claim summaries traverse the isolated classifier for pass and failure', () => {
  const passed = artifactSet('passed');
  const failed = artifactSet('failed');

  expect(isCanonicalVerificationArtifactSet(passed)).toBe(true);
  expect(isCanonicalVerificationArtifactSet(failed)).toBe(true);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(passed)).toBe('passed');
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(failed)).toBe('failed');
});

test('normal JSON artifacts retain every canonical serialized key set', () => {
  const parsed = JSON.parse(JSON.stringify(artifactSet('passed'))) as
    SemanticMutationIsolatedVerificationArtifactSet;
  const report = canonicalReport(parsed);
  const claim = report.summary.claimSummary.overall.claimResults[0]!;
  const gate = report.summary.claimSummary.gates[0]!;

  expect(isCanonicalVerificationArtifactSet(parsed)).toBe(true);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(parsed)).toBe('passed');
  expect(Object.keys(report.summary.claimSummary.overall)).toEqual([
    'overallStatus', 'overallReasonCode', 'claimResults'
  ]);
  expect(Object.keys(claim)).toEqual([
    'claimId', 'status', 'reasonCode', 'contributingGateIds', 'coverageComplete'
  ]);
  expect(Object.keys(gate)).toEqual([
    'schema', 'gateId', 'gateRevision', 'owner', 'requirementKey', 'subjectRevision',
    'inputDigest', 'applicability', 'status', 'disposition', 'reasonCode',
    'requiredForClaims', 'supportedClaims', 'environment', 'execution',
    'evidenceRefs', 'invalidationRules', 'diagnostic'
  ]);
});

test('isolated classifier rejects top-level and nested Proxy views before traps execute', () => {
  const views: Array<{
    candidate: SemanticMutationIsolatedVerificationArtifactSet;
    trapCalls: ClassifierProxyTrap[];
  }> = [];

  const transparentTopLevel = classifierProxy(artifactSet('passed'));
  views.push({
    candidate: transparentTopLevel.proxy,
    trapCalls: transparentTopLevel.trapCalls
  });

  const statefulTopLevel = classifierProxy(artifactSet('passed'), true);
  views.push({
    candidate: statefulTopLevel.proxy,
    trapCalls: statefulTopLevel.trapCalls
  });

  const reportTarget = artifactSet('passed');
  const reportView = classifierProxy(canonicalReport(reportTarget), true);
  views.push({
    candidate: { ...reportTarget, verificationReport: reportView.proxy },
    trapCalls: reportView.trapCalls
  });

  const semanticBundleTarget = artifactSet('passed');
  const semanticBundleView = classifierProxy(
    semanticBundleTarget.semanticBundle as ReturnType<typeof semanticBundle>,
    true
  );
  views.push({
    candidate: { ...semanticBundleTarget, semanticBundle: semanticBundleView.proxy },
    trapCalls: semanticBundleView.trapCalls
  });

  const reportArrayTarget = structuredClone(artifactSet('passed'));
  const gateArrayView = classifierProxy(
    canonicalReport(reportArrayTarget).summary.claimSummary.gates,
    true
  );
  (canonicalReport(reportArrayTarget).summary.claimSummary as unknown as {
    gates: readonly VerificationGateResultV1[];
  }).gates = gateArrayView.proxy;
  views.push({ candidate: reportArrayTarget, trapCalls: gateArrayView.trapCalls });

  const semanticArrayTarget = structuredClone(artifactSet('passed'));
  const semanticArrayBundle = semanticArrayTarget.semanticBundle as ReturnType<
    typeof semanticBundle
  >;
  const semanticTaskArrayView = classifierProxy(
    semanticArrayBundle.generatorPlan.tasks,
    true
  );
  (semanticArrayBundle.generatorPlan as unknown as {
    tasks: unknown[];
  }).tasks = semanticTaskArrayView.proxy;
  views.push({ candidate: semanticArrayTarget, trapCalls: semanticTaskArrayView.trapCalls });

  const revokedTopLevel = revokedClassifierProxy(artifactSet('passed'));
  views.push({
    candidate: revokedTopLevel.proxy,
    trapCalls: revokedTopLevel.trapCalls
  });

  const transparentTopPrototype = classifierProxy(Object.prototype);
  const transparentTopPrototypeTarget = artifactSet('passed');
  Object.setPrototypeOf(transparentTopPrototypeTarget, transparentTopPrototype.proxy);
  transparentTopPrototype.trapCalls.length = 0;
  views.push({
    candidate: transparentTopPrototypeTarget,
    trapCalls: transparentTopPrototype.trapCalls
  });

  const reportPrototype = classifierProxy(Object.prototype);
  const reportPrototypeTarget = artifactSet('passed');
  Object.setPrototypeOf(canonicalReport(reportPrototypeTarget), reportPrototype.proxy);
  reportPrototype.trapCalls.length = 0;
  views.push({
    candidate: reportPrototypeTarget,
    trapCalls: reportPrototype.trapCalls
  });

  const bundlePrototype = classifierProxy(Object.prototype);
  const bundlePrototypeTarget = artifactSet('passed');
  Object.setPrototypeOf(bundlePrototypeTarget.semanticBundle as object, bundlePrototype.proxy);
  bundlePrototype.trapCalls.length = 0;
  views.push({
    candidate: bundlePrototypeTarget,
    trapCalls: bundlePrototype.trapCalls
  });

  const reportArrayPrototype = classifierProxy(Array.prototype);
  const reportArrayPrototypeTarget = artifactSet('passed');
  Object.setPrototypeOf(
    canonicalReport(reportArrayPrototypeTarget).summary.claimSummary.gates,
    reportArrayPrototype.proxy
  );
  reportArrayPrototype.trapCalls.length = 0;
  views.push({
    candidate: reportArrayPrototypeTarget,
    trapCalls: reportArrayPrototype.trapCalls
  });

  const bundleArrayPrototype = classifierProxy(Array.prototype);
  const bundleArrayPrototypeTarget = artifactSet('passed');
  const bundleArrayPrototypeBundle = bundleArrayPrototypeTarget.semanticBundle as ReturnType<
    typeof semanticBundle
  >;
  Object.setPrototypeOf(
    bundleArrayPrototypeBundle.generatorPlan.tasks,
    bundleArrayPrototype.proxy
  );
  bundleArrayPrototype.trapCalls.length = 0;
  views.push({
    candidate: bundleArrayPrototypeTarget,
    trapCalls: bundleArrayPrototype.trapCalls
  });

  const revokedPrototypeTrapCalls: ClassifierProxyTrap[] = [];
  const revokedPrototype = Proxy.revocable(
    Object.prototype,
    classifierProxyHandler(revokedPrototypeTrapCalls, false)
  );
  const revokedPrototypeTarget = artifactSet('passed');
  Object.setPrototypeOf(revokedPrototypeTarget, revokedPrototype.proxy);
  revokedPrototypeTrapCalls.length = 0;
  revokedPrototype.revoke();
  views.push({
    candidate: revokedPrototypeTarget,
    trapCalls: revokedPrototypeTrapCalls
  });

  for (const view of views) {
    expect(classifySemanticMutationIsolatedVerificationArtifactSet(view.candidate)).toBe('blocked');
    expect(view.trapCalls).toEqual([]);
  }

  const ordinaryJson = JSON.parse(JSON.stringify(artifactSet('passed'))) as
    SemanticMutationIsolatedVerificationArtifactSet;
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(ordinaryJson)).toBe('passed');
});

test('strict artifact boundary rejects executable, hidden, inherited, and exotic views', () => {
  let candidateCodeExecutions = 0;

  const inheritedToJSON = structuredClone(artifactSet('passed'));
  Object.setPrototypeOf(canonicalReport(inheritedToJSON).summary.claimSummary.overall, {
    toJSON: () => { candidateCodeExecutions += 1; return {}; }
  });

  const hiddenToJSON = structuredClone(artifactSet('passed'));
  Object.defineProperty(canonicalReport(hiddenToJSON).summary.claimSummary.gates[0]!, 'toJSON', {
    value: () => { candidateCodeExecutions += 1; return {}; },
    enumerable: false
  });

  const accessorField = structuredClone(artifactSet('passed'));
  const accessorClaim = canonicalReport(accessorField).summary.claimSummary.overall.claimResults[0]!;
  delete (accessorClaim as unknown as Record<string, unknown>).status;
  Object.defineProperty(accessorClaim, 'status', {
    get: () => { candidateCodeExecutions += 1; return 'passed'; },
    enumerable: true,
    configurable: true
  });

  const customPrototype = structuredClone(artifactSet('passed'));
  Object.setPrototypeOf(customPrototype.policyReport as object, { inherited: true });

  const symbolExtra = structuredClone(artifactSet('passed'));
  (canonicalReport(symbolExtra).summary.claimSummary.gates[0] as unknown as
    Record<PropertyKey, unknown>)[Symbol('forged')] = true;

  const hiddenExtra = structuredClone(artifactSet('passed'));
  Object.defineProperty(canonicalReport(hiddenExtra).summary.claimSummary.overall, 'forged', {
    value: true,
    enumerable: false
  });

  const sparseArray = structuredClone(artifactSet('passed'));
  delete canonicalReport(sparseArray).summary.claimSummary.overall.claimResults[0];

  const overriddenArray = structuredClone(artifactSet('passed'));
  const gates = canonicalReport(overriddenArray).summary.claimSummary.gates;
  (gates as unknown as Record<string, unknown>).map = () => {
    candidateCodeExecutions += 1;
    return [];
  };

  for (const candidate of [
    inheritedToJSON,
    hiddenToJSON,
    accessorField,
    customPrototype,
    symbolExtra,
    hiddenExtra,
    sparseArray,
    overriddenArray
  ]) {
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
    expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
  }
  expect(candidateCodeExecutions).toBe(0);
});

test('real artifact classifier accepts one valid unrelated non-passed extra gate', () => {
  const candidate = structuredClone(artifactSet('passed'));
  const gates = canonicalReport(candidate).summary.claimSummary.gates as unknown as
    VerificationGateResultV1[];
  const extraGate = structuredClone(gates[0]!);
  Object.assign(extraGate, {
    gateId: 'unrelated-extra-gate',
    applicability: 'optional',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'capability-unsupported',
    requiredForClaims: ['unrelated-extra-claim'],
    supportedClaims: [],
    environment: null,
    execution: null
  });
  gates.push(extraGate);

  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(true);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('passed');
});

test('canonical assertion accepts current writer summaries for every requested lane', () => {
  const report = canonicalReport(artifactSet('passed'));
  for (const lane of ['fast', 'runtime', 'all'] as const) {
    const claimSummary = buildClaimSummary(
      lane,
      report.fast,
      report.runtime,
      'full',
      policyReport()
    );
    expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
      claimSummary.overall,
      {
        claims: buildProductVerificationClaimPlan(lane),
        gateResults: claimSummary.gates
      }
    )).not.toThrow();
  }
});

test('all four unified non-passed statuses project to legacy failed', () => {
  const candidates = [
    artifactSet('failed'),
    artifactSetWithUnifiedRuntimeStatus('not-run'),
    artifactSetWithUnifiedRuntimeStatus('unsupported'),
    artifactSetWithUnifiedRuntimeStatus('invalidated')
  ];

  for (const candidate of candidates) {
    const report = canonicalReport(candidate);
    expect(report.summary.claimSummary.overall.overallStatus).not.toBe('passed');
    expect(report.summary.status).toBe('failed');
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(true);
    expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('failed');
  }
});

test('non-passed contributing gates may retain supported claim linkage', () => {
  const candidate = structuredClone(artifactSet('failed'));
  const runtimeBinding = runtimeProductBinding();
  const runtimeGate = canonicalReport(candidate).summary.claimSummary.gates.find(
    (gate) => gate.gateId === runtimeBinding.gateId
  );
  if (!runtimeGate) throw new Error('current buildClaimSummary runtime gate is missing');
  runtimeGate.supportedClaims = runtimeBinding.supportedClaims;

  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(true);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('failed');
});

test('isolated classifier blocks overall passed forged over every non-passed claim status', () => {
  const candidates = [
    artifactSet('failed'),
    artifactSetWithUnifiedRuntimeStatus('not-run'),
    artifactSetWithUnifiedRuntimeStatus('unsupported'),
    artifactSetWithUnifiedRuntimeStatus('invalidated')
  ];

  for (const candidate of candidates) {
    const forged = structuredClone(candidate);
    const report = canonicalReport(forged);
    report.summary.claimSummary.overall.overallStatus = 'passed';
    report.summary.claimSummary.overall.overallReasonCode = 'executed-success';
    report.summary.status = 'passed';
    expect(isCanonicalVerificationArtifactSet(forged)).toBe(false);
    expect(classifySemanticMutationIsolatedVerificationArtifactSet(forged)).toBe('blocked');
  }
});

test('artifact contract binds the nonempty all plan against claim and required-gate omission', () => {
  const runtimeBinding = runtimeProductBinding();
  const runtimeClaimId = runtimeBinding.requiredForClaims[0]!;
  const omittedNonPassedClaim = structuredClone(artifactSet('failed'));
  const omittedNonPassedSummary = canonicalReport(omittedNonPassedClaim).summary.claimSummary;
  omittedNonPassedSummary.overall.claimResults = omittedNonPassedSummary.overall.claimResults.filter(
    (claim) => claim.claimId !== runtimeClaimId
  );

  const omittedClaimAndGate = structuredClone(artifactSet('passed'));
  const omittedClaimAndGateSummary = canonicalReport(omittedClaimAndGate).summary.claimSummary;
  omittedClaimAndGateSummary.overall.claimResults = omittedClaimAndGateSummary.overall.claimResults.filter(
    (claim) => claim.claimId !== runtimeClaimId
  );
  const omittedGateIndex = omittedClaimAndGateSummary.gates.findIndex(
    (gate) => gate.gateId === runtimeBinding.gateId
  );
  (omittedClaimAndGateSummary.gates as VerificationGateResultV1[]).splice(omittedGateIndex, 1);

  const emptyGreen = structuredClone(artifactSet('passed'));
  const emptyGreenSummary = canonicalReport(emptyGreen).summary.claimSummary;
  Object.assign(emptyGreenSummary.overall, {
    overallStatus: 'passed',
    overallReasonCode: 'executed-success',
    claimResults: []
  });
  (emptyGreenSummary.gates as VerificationGateResultV1[]).length = 0;

  const staleClaimMissingGate = structuredClone(artifactSet('passed'));
  const staleClaimMissingGateSummary = canonicalReport(staleClaimMissingGate).summary.claimSummary;
  const staleGateIndex = staleClaimMissingGateSummary.gates.findIndex(
    (gate) => gate.gateId === runtimeBinding.gateId
  );
  (staleClaimMissingGateSummary.gates as VerificationGateResultV1[]).splice(staleGateIndex, 1);

  for (const candidate of [
    omittedNonPassedClaim,
    omittedClaimAndGate,
    emptyGreen,
    staleClaimMissingGate
  ]) {
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
    expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
  }
});

test('legacy claimSummary omission remains ordinary-readable but is noncanonical and blocked', () => {
  const current = artifactSet('passed');
  const report = canonicalReport(current);
  const legacyReport: VerificationReport = {
    ...report,
    summary: {
      status: report.summary.status,
      requestedLane: report.summary.requestedLane,
      failedLanes: [...report.summary.failedLanes]
    }
  };
  const legacyArtifacts = { ...current, verificationReport: legacyReport };

  expect(legacyReport.summary.claimSummary).toBeUndefined();
  expect(isCanonicalVerificationArtifactSet(legacyArtifacts)).toBe(false);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(legacyArtifacts)).toBe('blocked');
});

test('claimSummary overall status must agree with the legacy summary projection', () => {
  const candidate = structuredClone(artifactSet('passed')) as SemanticMutationIsolatedVerificationArtifactSet & {
    verificationReport: {
      summary: {
        status: 'passed' | 'failed';
        claimSummary: {
          overall: {
            overallStatus: 'passed' | 'failed' | 'not-run' | 'unsupported' | 'invalidated';
            overallReasonCode: string;
          };
        };
      };
    };
  };
  candidate.verificationReport.summary.claimSummary.overall.overallStatus = 'invalidated';
  candidate.verificationReport.summary.claimSummary.overall.overallReasonCode = 'selection-unresolved';

  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
});

test('unknown fields at every claim-summary nesting layer remain blocked', () => {
  const summary = structuredClone(artifactSet('passed'));
  (canonicalReport(summary).summary as unknown as Record<string, unknown>).forged = true;

  const claimSummary = structuredClone(artifactSet('passed'));
  (canonicalReport(claimSummary).summary.claimSummary as unknown as Record<string, unknown>).forged =
    true;

  const aggregate = structuredClone(artifactSet('passed'));
  (canonicalReport(aggregate).summary.claimSummary.overall as unknown as Record<string, unknown>)
    .forged = true;

  const claim = structuredClone(artifactSet('passed'));
  (canonicalReport(claim).summary.claimSummary.overall.claimResults[0] as unknown as
    Record<string, unknown>).forged = true;

  const gate = structuredClone(artifactSet('passed'));
  (canonicalReport(gate).summary.claimSummary.gates[0] as unknown as Record<string, unknown>)
    .forged = true;

  const environment = structuredClone(artifactSet('passed'));
  (canonicalReport(environment).summary.claimSummary.gates[0]!.environment as unknown as
    Record<string, unknown>).forged = true;

  const execution = structuredClone(artifactSet('passed'));
  (canonicalReport(execution).summary.claimSummary.gates[0]!.execution as unknown as
    Record<string, unknown>).forged = true;

  for (const candidate of [summary, claimSummary, aggregate, claim, gate, environment, execution]) {
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
    expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
  }
});

test('artifact delegation blocks claim status, coverage, identity, and linkage contradictions', () => {
  const contradictoryStatus = structuredClone(artifactSet('passed'));
  const contradictoryStatusClaim = canonicalReport(contradictoryStatus).summary.claimSummary.overall
    .claimResults[0]!;
  contradictoryStatusClaim.status = 'failed';
  contradictoryStatusClaim.reasonCode = 'executed-failure';

  const contradictoryReason = structuredClone(artifactSet('passed'));
  canonicalReport(contradictoryReason).summary.claimSummary.overall.claimResults[0]!.reasonCode =
    'executed-failure';

  const incompleteCoverage = structuredClone(artifactSet('passed'));
  canonicalReport(incompleteCoverage).summary.claimSummary.overall.claimResults[0]!.coverageComplete =
    false;

  const unknownContributor = structuredClone(artifactSet('passed'));
  canonicalReport(unknownContributor).summary.claimSummary.overall.claimResults[0]!
    .contributingGateIds = ['unknown-gate'];

  const missingContributor = structuredClone(artifactSet('passed'));
  canonicalReport(missingContributor).summary.claimSummary.overall.claimResults[0]!
    .contributingGateIds = [];

  const duplicateGateIdentity = structuredClone(artifactSet('passed'));
  const duplicateGates = canonicalReport(duplicateGateIdentity).summary.claimSummary.gates;
  duplicateGates[1]!.gateId = duplicateGates[0]!.gateId;

  const missingSupportedLink = structuredClone(artifactSet('passed'));
  canonicalReport(missingSupportedLink).summary.claimSummary.gates[0]!.supportedClaims = [];

  const missingRequiredLink = structuredClone(artifactSet('passed'));
  canonicalReport(missingRequiredLink).summary.claimSummary.gates[0]!.requiredForClaims = [];

  const unknownClaimLink = structuredClone(artifactSet('passed'));
  canonicalReport(unknownClaimLink).summary.claimSummary.overall.claimResults[0]!.claimId =
    'unknown-claim';

  for (const candidate of [
    contradictoryStatus,
    contradictoryReason,
    incompleteCoverage,
    unknownContributor,
    missingContributor,
    duplicateGateIdentity,
    missingSupportedLink,
    missingRequiredLink,
    unknownClaimLink
  ]) {
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
    expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
  }
});
