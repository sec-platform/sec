import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { stringify as stringifyYaml } from 'yaml';

import { scanMachineLedgers } from '../../docs/scripts/docs-doctor-ledgers.ts';
import type { DocsDoctorIssue } from '../../docs/scripts/docs-doctor.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1 } from '../../platform/runtime/environments/sec-linux-verification-v1/authority.ts';
import {
  parseDocumentationAuthorityRegistry,
  type DocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

async function repositoryRegistry(): Promise<DocumentationAuthorityRegistry> {
  return parseDocumentationAuthorityRegistry(
    await readFile(path.join(REPOSITORY_ROOT, 'docs/authority.json'), 'utf8')
  );
}

async function scan(root: string, registry: DocumentationAuthorityRegistry): Promise<DocsDoctorIssue[]> {
  const issues: DocsDoctorIssue[] = [];
  await scanMachineLedgers(root, registry, issues);
  return issues;
}

const FORBIDDEN_AUTHORITY = [
  'AgentOperationsAuthority',
  'EngineeringIR',
  'actualDelta',
  'canonicalImpact',
  'sourceWriter'
];

const NEXUS_COMPLETE_UNSUPPORTED = (
  'Nexus status complete is unsupported until a typed materialized-record validator '
  + 'binds source identity and coverage counters.'
);

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function executionTopology(): Record<string, unknown> {
  return {
    schema: 'sec-verification-execution-topology-v1',
    semanticControlPlane: 'platform-neutral',
    selection: 'required-closure-intersect-missing-or-stale',
    environments: [
      {
        id: 'windows-native-control',
        availability: 'available',
        capabilities: ['semantic-control', 'windows-native'],
        evidenceRole: 'owning-environment-only'
      },
      {
        id: 'docker-linux-x64',
        availability: 'available',
        capabilities: ['linux-native-runtime'],
        substrate: { wsl2: 'implementation-only-not-independent-evidence' },
        localRemoteSwitch: 'same-profile-conformance-no-workflow-change'
      },
      {
        id: 'web-runtime',
        availability: 'on-demand',
        capabilities: ['chromium-playwright'],
        applicability: 'browser-impact-only',
        cache: 'exact-revision-content-addressed'
      },
      {
        id: 'darwin-native',
        availability: 'unavailable',
        capabilities: ['darwin-native'],
        unrelatedDelta: 'not-applicable',
        requiredDelta: 'typed-provider-unavailable'
      }
    ],
    invariants: {
      noPlatformSubstitution: true,
      noSubstrateDoubleCounting: true,
      noUnavailableProviderPass: true,
      noWorkflowEditForLocalRemoteSwitch: true
    }
  };
}

function externalLedger(): Record<string, unknown> {
  const provider = (
    id: string,
    category: string,
    capability: string,
    profile: string | null,
    standingMcp: string[]
  ): Record<string, unknown> => ({
    id,
    category,
    capability,
    decision: 'use-as-development-tool',
    lifecycle: 'active',
    observedVersion: null,
    versionAuthority: null,
    activeRoutingProfile: profile,
    surfaces: { cli: profile ? ['query'] : [], standingMcp },
    forbiddenAuthority: [...FORBIDDEN_AUTHORITY]
  });
  return {
    schema: 'sec-external-capability-ledger-v4',
    status: 'revalidation-required',
    binding: {
      repository: 'sec-platform/sec',
      packageAuthority: 'package.json',
      lockAuthority: 'bun.lock'
    },
    policy: { owner: 'docs/external-provider-policy.md' },
    verification: {
      schema: 'sec-verification-provider-availability-ledger-v1',
      epochId: 'test-epoch-v1',
      observedAt: '2026-08-11T00:00:00.000Z',
      expiresAt: '2026-08-12T00:00:00.000Z',
      diagnosticRetention: {
        rawProviderProse: 'disposable-after-normalization',
        positiveClaimsRequireDurableEvidence: true
      },
      capabilities: [{
        capability: 'codex-review',
        role: 'reviewer',
        provider: 'codex-code-review',
        availability: 'unknown',
        reasonCode: 'provider-not-observed',
        receiptRef: null,
        observedAt: '2026-08-11T00:00:00.000Z'
      }]
    },
    executionTopology: executionTopology(),
    providers: [
      {
        id: 'codegraph',
        category: 'graph',
        capability: 'source-context',
        decision: 'watch-with-trigger',
        lifecycle: 'discovered',
        observedVersion: null,
        versionAuthority: null,
        activeRoutingProfile: null,
        surfaces: { cli: [], standingMcp: [] },
        forbiddenAuthority: [...FORBIDDEN_AUTHORITY],
        unresolved: ['exact-version']
      },
      {
        ...provider('package-graph', 'graph', 'architecture-analysis', 'architecture', [
          'architecture-query'
        ]),
        lifecycle: 'revalidation-required',
        observedVersion: '1.6.3',
        versionAuthority: {
          kind: 'package',
          dependency: 'gitnexus',
          section: 'devDependencies',
          declaredSpec: '1.6.3'
        }
      },
      provider('security-query', 'security', 'security-analysis', 'security', [
        'security-query'
      ]),
      provider('context-query', 'graph', 'source-context', 'daily-context', []),
      {
        id: 'retired-graph',
        category: 'graph',
        capability: 'source-context',
        decision: 'reject-with-rationale',
        lifecycle: 'retired',
        observedVersion: null,
        versionAuthority: null,
        activeRoutingProfile: null,
        surfaces: { cli: [], standingMcp: [] },
        forbiddenAuthority: [...FORBIDDEN_AUTHORITY],
        rationale: 'fixture'
      }
    ],
    invariants: {
      maxStandingGraphProviders: 1,
      providerOutputCannotBecomeCanonical: true,
      providerWriteRequiresWorkPackage: true
    }
  };
}

function censusRequiredNexusLedger(): Record<string, unknown> {
  return {
    schema: 'sec-nexus-corpus-ledger-v2',
    status: 'census-required',
    source: {
      repository: 'QzCrane/nexus',
      baselineCommit: null,
      baselineTree: null,
      trackedPaths: null
    },
    coverage: {
      pathClassification: { materialized: false, classified: 0, total: null },
      mechanismDecisions: { decided: 0, total: null },
      eprBindings: { bound: 0, expected: 29 },
      skillBindings: { bound: 0, expected: null },
      executableEntrypoints: { materialized: false },
      acceptedParity: { proven: 0, accepted: 0 },
      unexplainedDeltaCount: null
    },
    completion: {
      censusComplete: false,
      parityComplete: false,
      retirementComplete: false,
      noOmissionProven: false
    },
    invalidation: {
      reason: 'fixture-needs-census',
      requiresExactTreeCensus: true
    },
    notes: ['null totals are not zero']
  };
}

function candidateNexusLedger(): Record<string, unknown> {
  return {
    schema: 'sec-nexus-corpus-ledger-v2',
    status: 'candidate-complete',
    source: {
      repository: 'QzCrane/nexus',
      baselineCommit: 'a'.repeat(40),
      baselineTree: 'b'.repeat(40),
      trackedPaths: 10
    },
    coverage: {
      pathClassification: { materialized: true, classified: 10, total: 10 },
      mechanismDecisions: { decided: 4, total: 4 },
      eprBindings: { bound: 29, expected: 29 },
      skillBindings: { bound: 17, expected: 17 },
      executableEntrypoints: { materialized: true },
      acceptedParity: { proven: 3, accepted: 3 },
      unexplainedDeltaCount: 0
    },
    completion: {
      censusComplete: true,
      parityComplete: true,
      retirementComplete: true,
      noOmissionProven: true
    },
    invalidation: {
      reason: 'candidate-awaits-independent-materialization',
      requiresExactTreeCensus: true
    }
  };
}

function identifiedNexusLedger(
  status: 'incomplete' | 'blocked' | 'invalidated',
  materializedSource = true
): Record<string, unknown> {
  const ledger = censusRequiredNexusLedger();
  ledger.status = status;
  if (materializedSource) {
    ledger.source = {
      repository: 'QzCrane/nexus',
      baselineCommit: 'a'.repeat(40),
      baselineTree: 'b'.repeat(40),
      trackedPaths: 10
    };
  }
  return ledger;
}

function packageJsonFixture(): Record<string, unknown> {
  return { devDependencies: { gitnexus: '1.6.3' } };
}

function bunLockFixture(): Record<string, unknown> {
  return {
    lockfileVersion: 1,
    workspaces: { '': { devDependencies: { gitnexus: '1.6.3' } } },
    packages: { gitnexus: ['gitnexus@1.6.3', '', {}] }
  };
}

interface FixtureState {
  external: Record<string, unknown>;
  nexus: Record<string, unknown>;
  packageJson: Record<string, unknown>;
  bunLock: Record<string, unknown>;
}

function fixtureState(): FixtureState {
  return {
    external: externalLedger(),
    nexus: censusRequiredNexusLedger(),
    packageJson: packageJsonFixture(),
    bunLock: bunLockFixture()
  };
}

async function withLedgerFixture(
  execute: (root: string, registry: DocumentationAuthorityRegistry) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-docs-ledgers-'));
  try {
    await mkdir(path.join(root, 'docs/governance'), { recursive: true });
    await execute(root, await repositoryRegistry());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeFixture(root: string, state: FixtureState): Promise<void> {
  await Promise.all([
    writeFile(path.join(root, 'package.json'), JSON.stringify(state.packageJson), 'utf8'),
    writeFile(path.join(root, 'bun.lock'), stringifyYaml(state.bunLock), 'utf8'),
    writeFile(
      path.join(root, 'docs/governance/external-capability-ledger.yaml'),
      stringifyYaml(state.external),
      'utf8'
    ),
    writeFile(
      path.join(root, 'docs/governance/nexus-absorption-ledger.yaml'),
      stringifyYaml(state.nexus),
      'utf8'
    )
  ]);
}

function machineErrors(issues: DocsDoctorIssue[]): DocsDoctorIssue[] {
  return issues.filter((issue) => issue.code === 'machine-ledger-invalid');
}

async function expectZeroErrors(
  root: string,
  registry: DocumentationAuthorityRegistry,
  state: FixtureState
): Promise<void> {
  await writeFixture(root, state);
  expect(machineErrors(await scan(root, registry))).toEqual([]);
}

async function expectOneError(
  root: string,
  registry: DocumentationAuthorityRegistry,
  state: FixtureState,
  file: string,
  message: string
): Promise<void> {
  await writeFixture(root, state);
  expect(machineErrors(await scan(root, registry)).map((issue) => ({
    file: issue.file,
    message: issue.message
  }))).toEqual([{ file, message }]);
}

function provider(ledger: Record<string, unknown>, id: string): Record<string, unknown> {
  return (ledger.providers as Array<Record<string, unknown>>)
    .find((entry) => entry.id === id)!;
}

function fixtureRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

test('current repository machine ledgers satisfy their canonical contracts', async () => {
  expect(machineErrors(await scan(REPOSITORY_ROOT, await repositoryRegistry()))).toEqual([]);
});

test('external provider state transitions are ledger-only and graph standing count is typed', async () => {
  await withLedgerFixture(async (root, registry) => {
    const base = fixtureState();
    await expectZeroErrors(root, registry, base);

    const transitioned = structuredClone(base);
    transitioned.external.status = 'active';
    provider(transitioned.external, 'package-graph').lifecycle = 'active';
    await expectZeroErrors(root, registry, transitioned);
  });
});

test('docs doctor uses the hosted capability epoch window for every observation', async () => {
  await withLedgerFixture(async (root, registry) => {
    const state = fixtureState();
    const capability = (state.external.verification as Record<string, unknown>).capabilities as Array<Record<string, unknown>>;
    capability[0]!.observedAt = '2026-08-10T23:59:59.999Z';
    await expectOneError(root, registry, state, 'docs/governance/external-capability-ledger.yaml',
      'VerificationProviderCapability capability codex-review observation must fall within the availability epoch.');
  });
});

test('docs doctor delegates static positive capability projections to the canonical normalizer', async () => {
  await withLedgerFixture(async (root, registry) => {
    const state = fixtureState();
    const capability = (state.external.verification as Record<string, unknown>)
      .capabilities as Array<Record<string, unknown>>;
    capability[0]!.availability = 'available';
    capability[0]!.reasonCode = null;
    capability[0]!.receiptRef = `sha256:${'a'.repeat(64)}`;
    await expectZeroErrors(root, registry, state);
  });
});

test('external provider policy keeps availability as a deny-only routing projection', async () => {
  const policy = await readFile(path.join(REPOSITORY_ROOT, 'docs/external-provider-policy.md'), 'utf8');
  expect(policy).toContain('availability/health 是路由和同一 epoch 的 negative circuit-breaker projection，不是 effect authorization');
  expect(policy).toContain('`unknown` 不能支持 positive availability claim，也不授予 effect');
  expect(policy).toContain('operation-specific authority、idempotency/recovery 与 exact readback 授权的 provider operation');
  expect(policy).toContain('只有 current-epoch 的 explicit `unavailable` 禁止重复');
  expect(policy).toContain('实际 provider response/readback 才产生 availability evidence');
  expect(policy).not.toContain('Evidence 缺失、过期或无法复核时一律解析为 `unknown` 并阻止调用');
});

test('external provider schema and cross-field negatives report the exact failing field', async () => {
  await withLedgerFixture(async (root, registry) => {
    const base = fixtureState();
    await expectZeroErrors(root, registry, base);
    const file = 'docs/governance/external-capability-ledger.yaml';

    const wrongSchema = structuredClone(base);
    wrongSchema.external.schema = 'sec-external-capability-ledger-v2';
    await expectOneError(
      root,
      registry,
      wrongSchema,
      file,
      'External capability ledger schema must be sec-external-capability-ledger-v4.'
    );

    const wrongStatus = structuredClone(base);
    wrongStatus.external.status = 'active';
    await expectOneError(
      root,
      registry,
      wrongStatus,
      file,
      'External capability ledger status must be revalidation-required while any provider requires revalidation.'
    );

    const wrongCapability = structuredClone(base);
    provider(wrongCapability.external, 'package-graph').capability = 'security-analysis';
    await expectOneError(
      root,
      registry,
      wrongCapability,
      file,
      'External capability provider package-graph.capability security-analysis requires category security.'
    );

    const platformSubstitution = structuredClone(base);
    fixtureRecord(fixtureRecord(platformSubstitution.external.executionTopology).invariants)
      .noPlatformSubstitution = false;
    await expectOneError(
      root,
      registry,
      platformSubstitution,
      file,
      'External capability ledger.executionTopology.invariants must all be true.'
    );

    const weakAuthority = structuredClone(base);
    provider(weakAuthority.external, 'package-graph').forbiddenAuthority =
      FORBIDDEN_AUTHORITY.slice(0, -1);
    await expectOneError(
      root,
      registry,
      weakAuthority,
      file,
      'External capability provider package-graph.forbiddenAuthority must contain exactly '
      + 'AgentOperationsAuthority, EngineeringIR, actualDelta, canonicalImpact, sourceWriter.'
    );

    const duplicateSurface = structuredClone(base);
    (provider(duplicateSurface.external, 'security-query').surfaces as Record<string, unknown>)
      .standingMcp = ['architecture-query'];
    await expectOneError(
      root,
      registry,
      duplicateSurface,
      file,
      'Standing MCP surface architecture-query is owned by both package-graph and security-query.'
    );

    const blankCliSurface = structuredClone(base);
    fixtureRecord(provider(blankCliSurface.external, 'package-graph').surfaces).cli = ['   '];
    await expectOneError(
      root,
      registry,
      blankCliSurface,
      file,
      'External capability provider package-graph.surfaces.cli[0] '
      + 'must be non-empty and trimmed.'
    );

    for (const control of ['\u0000', '\u0085', '\u009f']) {
      const controlStandingSurface = structuredClone(base);
      fixtureRecord(
        provider(controlStandingSurface.external, 'package-graph').surfaces
      ).standingMcp = [`architecture${control}query`];
      await expectOneError(
        root,
        registry,
        controlStandingSurface,
        file,
        'External capability provider package-graph.surfaces.standingMcp[0] '
        + 'must not contain C0, DEL, C1, or bidirectional control characters.'
      );
    }

    const decomposedSurface = structuredClone(base);
    fixtureRecord(provider(decomposedSurface.external, 'package-graph').surfaces).cli = [
      'cafe\u0301'
    ];
    await expectOneError(
      root,
      registry,
      decomposedSurface,
      file,
      'External capability provider package-graph.surfaces.cli[0] must be NFC-normalized.'
    );

    const overlongCliSurface = structuredClone(base);
    fixtureRecord(provider(overlongCliSurface.external, 'package-graph').surfaces).cli = [
      'a'.repeat(129)
    ];
    await expectOneError(
      root,
      registry,
      overlongCliSurface,
      file,
      'External capability provider package-graph.surfaces.cli[0] '
      + 'must be at most 128 characters.'
    );

    const nonKebabSurface = structuredClone(base);
    fixtureRecord(provider(nonKebabSurface.external, 'package-graph').surfaces).cli = [
      'Workspace.Query/v2'
    ];
    await expectZeroErrors(root, registry, nonKebabSurface);

    const watchCli = structuredClone(base);
    (provider(watchCli.external, 'codegraph').surfaces as Record<string, unknown>).cli = ['query'];
    await expectOneError(
      root,
      registry,
      watchCli,
      file,
      'External capability provider codegraph cannot expose active surfaces '
      + 'without an active routing profile.'
    );

    const retiredCli = structuredClone(base);
    (provider(retiredCli.external, 'retired-graph').surfaces as Record<string, unknown>).cli = [
      'query'
    ];
    await expectOneError(
      root,
      registry,
      retiredCli,
      file,
      'External capability provider retired-graph cannot expose active surfaces '
      + 'without an active routing profile.'
    );

    const superseded = structuredClone(base);
    provider(superseded.external, 'retired-graph').decision = 'superseded';
    delete provider(superseded.external, 'retired-graph').rationale;
    await expectZeroErrors(root, registry, superseded);
    const supersededCli = structuredClone(superseded);
    (provider(supersededCli.external, 'retired-graph').surfaces as Record<string, unknown>).cli = [
      'query'
    ];
    await expectOneError(
      root,
      registry,
      supersededCli,
      file,
      'External capability provider retired-graph cannot expose active surfaces '
      + 'without an active routing profile.'
    );

    const secondStandingGraph = structuredClone(base);
    (provider(secondStandingGraph.external, 'context-query').surfaces as Record<string, unknown>)
      .standingMcp = ['context-query'];
    await expectOneError(
      root,
      registry,
      secondStandingGraph,
      file,
      'External capability ledger has 2 standing graph providers; maximum is 1.'
    );
  });
});

test('ledger schemas reject missing, unknown, nested, and legacy alias fields', async () => {
  await withLedgerFixture(async (root, registry) => {
    const base = fixtureState();
    await expectZeroErrors(root, registry, base);
    const externalFile = 'docs/governance/external-capability-ledger.yaml';
    const nexusFile = 'docs/governance/nexus-absorption-ledger.yaml';
    const variants: Array<{
      state: FixtureState;
      file: string;
      message: string;
    }> = [];

    const externalRootRoute = structuredClone(base);
    externalRootRoute.external.route = 'architecture';
    variants.push({
      state: externalRootRoute,
      file: externalFile,
      message: 'External capability ledger.route is not allowed.'
    });

    const bindingComplete = structuredClone(base);
    (bindingComplete.external.binding as Record<string, unknown>).complete = true;
    variants.push({
      state: bindingComplete,
      file: externalFile,
      message: 'External capability ledger.binding.complete is not allowed.'
    });

    const missingBindingAuthority = structuredClone(base);
    delete (
      missingBindingAuthority.external.binding as Record<string, unknown>
    ).lockAuthority;
    variants.push({
      state: missingBindingAuthority,
      file: externalFile,
      message: 'External capability ledger.binding.lockAuthority is required.'
    });

    const policyRoute = structuredClone(base);
    (policyRoute.external.policy as Record<string, unknown>).route = 'architecture';
    variants.push({
      state: policyRoute,
      file: externalFile,
      message: 'External capability ledger.policy.route is not allowed.'
    });

    const providerRoute = structuredClone(base);
    provider(providerRoute.external, 'package-graph').route = 'architecture';
    variants.push({
      state: providerRoute,
      file: externalFile,
      message: 'External capability provider package-graph.route is not allowed.'
    });

    const providerSurfaceComplete = structuredClone(base);
    fixtureRecord(
      provider(providerSurfaceComplete.external, 'package-graph').surfaces
    ).complete = true;
    variants.push({
      state: providerSurfaceComplete,
      file: externalFile,
      message: 'External capability provider package-graph.surfaces.complete is not allowed.'
    });

    const versionAuthorityRoute = structuredClone(base);
    fixtureRecord(
      provider(versionAuthorityRoute.external, 'package-graph').versionAuthority
    ).route = 'architecture';
    variants.push({
      state: versionAuthorityRoute,
      file: externalFile,
      message: 'External capability provider package-graph.versionAuthority.route is not allowed.'
    });

    const invariantComplete = structuredClone(base);
    (invariantComplete.external.invariants as Record<string, unknown>).complete = true;
    variants.push({
      state: invariantComplete,
      file: externalFile,
      message: 'External capability ledger.invariants.complete is not allowed.'
    });

    const nonRejectRationale = structuredClone(base);
    provider(nonRejectRationale.external, 'package-graph').rationale = 'competing decision';
    variants.push({
      state: nonRejectRationale,
      file: externalFile,
      message: 'External capability provider package-graph.rationale is not allowed.'
    });

    const rejectedUnresolved = structuredClone(base);
    provider(rejectedUnresolved.external, 'retired-graph').unresolved = ['competing state'];
    variants.push({
      state: rejectedUnresolved,
      file: externalFile,
      message: 'External capability provider retired-graph.unresolved is not allowed.'
    });

    const missingWatchUnresolved = structuredClone(base);
    delete provider(missingWatchUnresolved.external, 'codegraph').unresolved;
    variants.push({
      state: missingWatchUnresolved,
      file: externalFile,
      message: 'External capability provider codegraph.unresolved is required.'
    });

    const nexusCompleteAlias = structuredClone(base);
    nexusCompleteAlias.nexus.complete = true;
    variants.push({
      state: nexusCompleteAlias,
      file: nexusFile,
      message: 'Nexus ledger.complete is not allowed.'
    });

    const nexusMaterialization = structuredClone(base);
    nexusMaterialization.nexus.materialization = {};
    variants.push({
      state: nexusMaterialization,
      file: nexusFile,
      message: 'Nexus ledger.materialization is not allowed.'
    });

    const nexusMissingSource = structuredClone(base);
    delete nexusMissingSource.nexus.source;
    variants.push({
      state: nexusMissingSource,
      file: nexusFile,
      message: 'Nexus ledger.source is required.'
    });

    const nexusSourceRoute = structuredClone(base);
    (nexusSourceRoute.nexus.source as Record<string, unknown>).route = 'baseline';
    variants.push({
      state: nexusSourceRoute,
      file: nexusFile,
      message: 'Nexus ledger.source.route is not allowed.'
    });

    const nexusCoverageComplete = structuredClone(base);
    (nexusCoverageComplete.nexus.coverage as Record<string, unknown>).complete = true;
    variants.push({
      state: nexusCoverageComplete,
      file: nexusFile,
      message: 'Nexus ledger.coverage.complete is not allowed.'
    });

    const nexusPathRoute = structuredClone(base);
    fixtureRecord(
      fixtureRecord(nexusPathRoute.nexus.coverage).pathClassification
    ).route = 'classified';
    variants.push({
      state: nexusPathRoute,
      file: nexusFile,
      message: 'Nexus ledger.coverage.pathClassification.route is not allowed.'
    });

    const nexusMechanismComplete = structuredClone(base);
    fixtureRecord(
      fixtureRecord(nexusMechanismComplete.nexus.coverage).mechanismDecisions
    ).complete = true;
    variants.push({
      state: nexusMechanismComplete,
      file: nexusFile,
      message: 'Nexus ledger.coverage.mechanismDecisions.complete is not allowed.'
    });

    const nexusMechanismMissingTotal = structuredClone(base);
    delete fixtureRecord(
      fixtureRecord(nexusMechanismMissingTotal.nexus.coverage).mechanismDecisions
    ).total;
    variants.push({
      state: nexusMechanismMissingTotal,
      file: nexusFile,
      message: 'Nexus ledger.coverage.mechanismDecisions.total is required.'
    });

    const nexusEprRoute = structuredClone(base);
    fixtureRecord(
      fixtureRecord(nexusEprRoute.nexus.coverage).eprBindings
    ).route = 'bound';
    variants.push({
      state: nexusEprRoute,
      file: nexusFile,
      message: 'Nexus ledger.coverage.eprBindings.route is not allowed.'
    });

    const nexusSkillComplete = structuredClone(base);
    fixtureRecord(
      fixtureRecord(nexusSkillComplete.nexus.coverage).skillBindings
    ).complete = true;
    variants.push({
      state: nexusSkillComplete,
      file: nexusFile,
      message: 'Nexus ledger.coverage.skillBindings.complete is not allowed.'
    });

    const nexusEntrypointRoute = structuredClone(base);
    fixtureRecord(
      fixtureRecord(nexusEntrypointRoute.nexus.coverage).executableEntrypoints
    ).route = 'executed';
    variants.push({
      state: nexusEntrypointRoute,
      file: nexusFile,
      message: 'Nexus ledger.coverage.executableEntrypoints.route is not allowed.'
    });

    const nexusParityComplete = structuredClone(base);
    fixtureRecord(
      fixtureRecord(nexusParityComplete.nexus.coverage).acceptedParity
    ).complete = true;
    variants.push({
      state: nexusParityComplete,
      file: nexusFile,
      message: 'Nexus ledger.coverage.acceptedParity.complete is not allowed.'
    });

    const nexusCompletionAlias = structuredClone(base);
    (nexusCompletionAlias.nexus.completion as Record<string, unknown>).complete = true;
    variants.push({
      state: nexusCompletionAlias,
      file: nexusFile,
      message: 'Nexus ledger.completion.complete is not allowed.'
    });

    const nexusInvalidationRoute = structuredClone(base);
    (nexusInvalidationRoute.nexus.invalidation as Record<string, unknown>).route = 'retry';
    variants.push({
      state: nexusInvalidationRoute,
      file: nexusFile,
      message: 'Nexus ledger.invalidation.route is not allowed.'
    });

    const invalidNotes = structuredClone(base);
    invalidNotes.nexus.notes = { text: 'ignored object' };
    variants.push({
      state: invalidNotes,
      file: nexusFile,
      message: 'Nexus ledger.notes must be a string array.'
    });

    for (const variant of variants) {
      await expectOneError(
        root,
        registry,
        variant.state,
        variant.file,
        variant.message
      );
    }
  });
});

test('every package version authority binds package.json and bun.lock exact identities', async () => {
  await withLedgerFixture(async (root, registry) => {
    const base = fixtureState();
    await expectZeroErrors(root, registry, base);
    const file = 'docs/governance/external-capability-ledger.yaml';

    const observedDrift = structuredClone(base);
    provider(observedDrift.external, 'package-graph').observedVersion = '1.6.4';
    await expectOneError(
      root,
      registry,
      observedDrift,
      file,
      'External capability provider package-graph.observedVersion 1.6.4 '
      + 'does not satisfy declared spec 1.6.3.'
    );

    const packageDrift = structuredClone(base);
    (packageDrift.packageJson.devDependencies as Record<string, unknown>).gitnexus = '1.6.4';
    await expectOneError(
      root,
      registry,
      packageDrift,
      file,
      'External capability provider package-graph.versionAuthority.declaredSpec 1.6.3 '
      + 'does not match package.json devDependencies.gitnexus 1.6.4.'
    );

    const workspaceLockDrift = structuredClone(base);
    const rootWorkspace = (
      workspaceLockDrift.bunLock.workspaces as Record<string, unknown>
    )[''] as Record<string, unknown>;
    (rootWorkspace.devDependencies as Record<string, unknown>).gitnexus = '1.6.4';
    await expectOneError(
      root,
      registry,
      workspaceLockDrift,
      file,
      'bun.lock root workspace devDependencies.gitnexus 1.6.4 '
      + 'does not match declared spec 1.6.3.'
    );

    const resolvedDrift = structuredClone(base);
    (resolvedDrift.bunLock.packages as Record<string, unknown>).gitnexus =
      ['gitnexus@1.6.4', '', {}];
    await expectOneError(
      root,
      registry,
      resolvedDrift,
      file,
      'bun.lock packages.gitnexus resolved gitnexus@1.6.4 does not match gitnexus@1.6.3.'
    );
  });
});

test('external runner release authority binds exact primary-source archive and base image digests', async () => {
  await withLedgerFixture(async (root, registry) => {
    const base = fixtureState();
    const environment = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1;
    const localRunner = {
      id: 'github-actions-local-runner',
      category: 'workflow-runtime',
      capability: 'workflow-execution',
      decision: 'integrate-adapter',
      lifecycle: 'active',
      observedVersion: environment.archives.runner.version,
      versionAuthority: {
        kind: 'external-release',
        release: `https://github.com/actions/runner/releases/tag/v${environment.archives.runner.version}`,
        artifact: environment.archives.runner.url,
        artifactSha256: environment.archives.runner.digest.slice(7),
        baseImage: environment.ubuntu.baseReference,
        imageId: environment.image.dockerProjectionDigest,
        imageBuildRevision: environment.image.buildRevision,
        nodeVersion: environment.archives.node.version,
        nodeArtifact: environment.archives.node.url,
        nodeArtifactSha256: environment.archives.node.digest.slice(7),
        githubCliVersion: environment.archives.githubCli.version,
        githubCliArtifact: environment.archives.githubCli.url,
        githubCliArtifactSha256: environment.archives.githubCli.digest.slice(7),
        pythonVersion: environment.runtime.pythonVersion,
        zipExtractionCapability: 'info-zip-unzip-6.00',
        containerInitCapability: environment.runtime.containerInitCapability,
        sandboxRevision: 'sandbox-v4',
        outerSutContainerCapabilities: [
          'CHOWN', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_CHROOT'
        ],
        sutResources: {
          cpus: 2,
          wallSeconds: 3_600,
          aggregateCpuSeconds: 7_200,
          perProcessCpuSeconds: 7_200,
          memoryBytes: 4_294_967_296,
          pids: 256
        },
        roleProfiles: Object.values(environment.runtime.roleLabels).sort(),
        providerLeaseRef: `refs/tags/sec-provider-lease-${environment.environmentId}`,
        providerLedgerSchema: 'sec-local-github-actions-provider-ledger-v3',
        providerLedgerAuthority: 'remote-cas-immutable-generations',
        providerLedgerObjectModel: 'git-commit-parent-chain-with-canonical-ledger-tree',
        destructiveIdentityAuthority: {
          endpointBinding: [
            'github-api-host-principal-repository', 'docker-context-endpoint-daemon'
          ],
          immutableEffects: ['exact-image-id', 'exact-container-id', 'exact-runner-id'],
          localState: 'projection-only',
          mutableLocators: ['image-tag', 'container-name', 'runner-name', 'labels']
        },
        imageRetirement: {
          ordinaryStopAuthority: 'none',
          superseded: structuredClone(environment.image.retirements),
          requires: [
            'canonical-superseded-decision',
            'exact-daemon-zero-reference-readback',
            'immutable-image-id-effect-and-readback'
          ]
        },
        license: 'MIT'
      },
      activeRoutingProfile: 'sec-linux-verification-v1',
      surfaces: {
        cli: ['scripts/codex/local-github-actions-runner.ts'],
        standingMcp: []
      },
      forbiddenAuthority: [...FORBIDDEN_AUTHORITY]
    };
    (base.external.providers as Array<Record<string, unknown>>).push(localRunner);
    await expectZeroErrors(root, registry, base);

    const digestDrift = structuredClone(base);
    const drifted = provider(digestDrift.external, 'github-actions-local-runner');
    (drifted.versionAuthority as Record<string, unknown>).artifactSha256 = 'bad';
    await expectOneError(
      root,
      registry,
      digestDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.artifactSha256 '
        + 'must be an exact SHA-256 digest.'
    );

    const capabilityDrift = structuredClone(base);
    const capabilityProvider = provider(capabilityDrift.external, 'github-actions-local-runner');
    (capabilityProvider.versionAuthority as Record<string, unknown>).outerSutContainerCapabilities = [
      'SYS_ADMIN', 'SYS_CHROOT'
    ];
    await expectOneError(
      root,
      registry,
      capabilityDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.'
        + 'outerSutContainerCapabilities must bind the exact constructor boundary.'
    );

    const releaseDrift = structuredClone(base);
    const release = provider(releaseDrift.external, 'github-actions-local-runner');
    (release.versionAuthority as Record<string, unknown>).release =
      'https://github.com/actions/runner/releases/tag/v2.335.0';
    await expectOneError(
      root,
      registry,
      releaseDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority '
        + 'GitHub Actions runner release identity is invalid.'
    );

    const nodeDigestDrift = structuredClone(base);
    const nodeAuthority = provider(nodeDigestDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    nodeAuthority.nodeArtifactSha256 = '0'.repeat(64);
    await expectOneError(
      root,
      registry,
      nodeDigestDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.nodeArtifactSha256 '
        + 'must bind the exact Node.js binary.'
    );

    const githubCliDigestDrift = structuredClone(base);
    const githubCliAuthority = provider(
      githubCliDigestDrift.external,
      'github-actions-local-runner'
    ).versionAuthority as Record<string, unknown>;
    githubCliAuthority.githubCliArtifactSha256 = '0'.repeat(64);
    await expectOneError(
      root,
      registry,
      githubCliDigestDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority '
        + 'GitHub CLI identity is invalid.'
    );

    const pythonDrift = structuredClone(base);
    const pythonAuthority = provider(pythonDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    pythonAuthority.pythonVersion = '3.12.2';
    await expectOneError(
      root,
      registry,
      pythonDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.pythonVersion '
        + 'must bind the archive-inspection runtime.'
    );

    const zipDrift = structuredClone(base);
    const zipAuthority = provider(zipDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    zipAuthority.zipExtractionCapability = 'missing';
    await expectOneError(
      root,
      registry,
      zipDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.'
        + 'zipExtractionCapability must bind setup archive extraction.'
    );

    const imageDrift = structuredClone(base);
    const imageAuthority = provider(imageDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    imageAuthority.imageId = `sha256:${'f'.repeat(64)}`;
    await expectOneError(
      root,
      registry,
      imageDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.imageId '
        + 'must be an exact built image digest.'
    );

    const initDrift = structuredClone(base);
    const initAuthority = provider(initDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    initAuthority.containerInitCapability = 'ambient-pid1';
    await expectOneError(
      root,
      registry,
      initDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.containerInitCapability '
        + 'must bind persistent child reaping.'
    );

    const roleDrift = structuredClone(base);
    const roleAuthority = provider(roleDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    roleAuthority.roleProfiles = ['sec-linux-verification-sut-v1'];
    await expectOneError(
      root,
      registry,
      roleDrift,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.roleProfiles '
        + 'must bind the exact trust-domain roles.'
    );

    const authorityKindEscape = structuredClone(base);
    const escaped = provider(authorityKindEscape.external, 'github-actions-local-runner');
    escaped.observedVersion = '1.6.3';
    escaped.versionAuthority = {
      kind: 'package',
      dependency: 'gitnexus',
      section: 'devDependencies',
      declaredSpec: '1.6.3'
    };
    await expectOneError(
      root,
      registry,
      authorityKindEscape,
      'docs/governance/external-capability-ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.kind '
        + 'must be external-release for the workflow-execution capability.'
    );
  });
});

test('Nexus non-complete statuses validate source identity, nullable counters, and ranges', async () => {
  await withLedgerFixture(async (root, registry) => {
    const file = 'docs/governance/nexus-absorption-ledger.yaml';

    for (const status of ['incomplete', 'blocked', 'invalidated'] as const) {
      const nullableSource = fixtureState();
      nullableSource.nexus = identifiedNexusLedger(status, false);
      await expectZeroErrors(root, registry, nullableSource);

      const unboundTrackedPaths = structuredClone(nullableSource);
      fixtureRecord(unboundTrackedPaths.nexus.source).trackedPaths = 10;
      await expectOneError(
        root,
        registry,
        unboundTrackedPaths,
        file,
        'Nexus source.trackedPaths requires exact baselineCommit and baselineTree.'
      );
    }

    const unboundProgressCases: Array<(nexus: Record<string, unknown>) => void> = [
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).pathClassification).materialized = true;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).pathClassification).classified = 1;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).pathClassification).total = 0;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).mechanismDecisions).decided = 1;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).mechanismDecisions).total = 0;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).eprBindings).bound = 1;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).skillBindings).expected = 0;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).executableEntrypoints).materialized = true;
      },
      (nexus) => {
        fixtureRecord(fixtureRecord(nexus.coverage).acceptedParity).accepted = 1;
      },
      (nexus) => {
        fixtureRecord(nexus.coverage).unexplainedDeltaCount = 0;
      },
      (nexus) => {
        fixtureRecord(nexus.completion).censusComplete = true;
      },
      (nexus) => {
        fixtureRecord(nexus.invalidation).requiresExactTreeCensus = false;
      }
    ];
    for (const mutate of unboundProgressCases) {
      const unboundProgress = fixtureState();
      unboundProgress.nexus = identifiedNexusLedger('incomplete', false);
      mutate(unboundProgress.nexus);
      await expectOneError(
        root,
        registry,
        unboundProgress,
        file,
        'Nexus unbound source cannot carry source-derived progress or completion claims.'
      );
    }

    const identityBeforeTrackedCount = fixtureState();
    identityBeforeTrackedCount.nexus = identifiedNexusLedger('incomplete');
    fixtureRecord(identityBeforeTrackedCount.nexus.source).trackedPaths = null;
    await expectZeroErrors(root, registry, identityBeforeTrackedCount);

    for (const trackedPaths of [null, 10] as const) {
      const mismatchedPathTotal = fixtureState();
      mismatchedPathTotal.nexus = identifiedNexusLedger('incomplete');
      fixtureRecord(mismatchedPathTotal.nexus.source).trackedPaths = trackedPaths;
      fixtureRecord(
        fixtureRecord(mismatchedPathTotal.nexus.coverage).pathClassification
      ).total = 9;
      await expectOneError(
        root,
        registry,
        mismatchedPathTotal,
        file,
        'Nexus pathClassification.total requires matching source.trackedPaths.'
      );
    }

    const materializeCensus = (nexus: Record<string, unknown>): void => {
      const coverage = fixtureRecord(nexus.coverage);
      const trackedPaths = fixtureRecord(nexus.source).trackedPaths;
      Object.assign(fixtureRecord(coverage.pathClassification), {
        materialized: true,
        classified: trackedPaths,
        total: trackedPaths
      });
      Object.assign(fixtureRecord(coverage.mechanismDecisions), {
        decided: 0,
        total: 0
      });
      fixtureRecord(coverage.executableEntrypoints).materialized = true;
      fixtureRecord(nexus.completion).censusComplete = true;
    };

    const coherentCompletionDag = fixtureState();
    coherentCompletionDag.nexus = identifiedNexusLedger('incomplete');
    materializeCensus(coherentCompletionDag.nexus);
    fixtureRecord(coherentCompletionDag.nexus.coverage).unexplainedDeltaCount = 0;
    Object.assign(fixtureRecord(coherentCompletionDag.nexus.completion), {
      parityComplete: true,
      retirementComplete: true
    });
    await expectZeroErrors(root, registry, coherentCompletionDag);

    const incompleteCensusClaim = fixtureState();
    incompleteCensusClaim.nexus = identifiedNexusLedger('incomplete');
    fixtureRecord(incompleteCensusClaim.nexus.completion).censusComplete = true;
    await expectOneError(
      root,
      registry,
      incompleteCensusClaim,
      file,
      'Nexus completion.censusComplete requires bound tracked paths, complete materialized '
      + 'path/entrypoint census, and decided mechanism totals.'
    );

    const parityWithoutCensus = fixtureState();
    parityWithoutCensus.nexus = identifiedNexusLedger('blocked');
    fixtureRecord(parityWithoutCensus.nexus.completion).parityComplete = true;
    await expectOneError(
      root,
      registry,
      parityWithoutCensus,
      file,
      'Nexus completion.parityComplete requires censusComplete, proven=accepted, '
      + 'and unexplainedDeltaCount=0.'
    );

    for (const parityMutation of [
      (nexus: Record<string, unknown>) => {
        fixtureRecord(nexus.coverage).unexplainedDeltaCount = null;
      },
      (nexus: Record<string, unknown>) => {
        const parity = fixtureRecord(
          fixtureRecord(nexus.coverage).acceptedParity
        );
        parity.accepted = 1;
        parity.proven = 0;
      }
    ]) {
      const incoherentParity = fixtureState();
      incoherentParity.nexus = identifiedNexusLedger('invalidated');
      materializeCensus(incoherentParity.nexus);
      fixtureRecord(incoherentParity.nexus.completion).parityComplete = true;
      fixtureRecord(incoherentParity.nexus.coverage).unexplainedDeltaCount = 0;
      parityMutation(incoherentParity.nexus);
      await expectOneError(
        root,
        registry,
        incoherentParity,
        file,
        'Nexus completion.parityComplete requires censusComplete, proven=accepted, '
        + 'and unexplainedDeltaCount=0.'
      );
    }

    const retirementWithoutParity = fixtureState();
    retirementWithoutParity.nexus = identifiedNexusLedger('incomplete');
    fixtureRecord(retirementWithoutParity.nexus.completion).retirementComplete = true;
    await expectOneError(
      root,
      registry,
      retirementWithoutParity,
      file,
      'Nexus completion.retirementComplete requires parityComplete.'
    );

    const badIncompleteSource = fixtureState();
    badIncompleteSource.nexus = identifiedNexusLedger('incomplete');
    fixtureRecord(badIncompleteSource.nexus.source).repository = 'QzCrane/other';
    await expectOneError(
      root,
      registry,
      badIncompleteSource,
      file,
      'Nexus ledger source repository must be QzCrane/nexus.'
    );

    const materializedCensusSource = fixtureState();
    fixtureRecord(materializedCensusSource.nexus.source).baselineCommit = 'a'.repeat(40);
    fixtureRecord(materializedCensusSource.nexus.source).baselineTree = 'b'.repeat(40);
    await expectOneError(
      root,
      registry,
      materializedCensusSource,
      file,
      'Nexus status census-required requires source.baselineCommit, source.baselineTree, '
      + 'and source.trackedPaths to be null.'
    );

    const nullBlockedBaseline = fixtureState();
    nullBlockedBaseline.nexus = identifiedNexusLedger('blocked');
    fixtureRecord(nullBlockedBaseline.nexus.source).baselineTree = null;
    await expectOneError(
      root,
      registry,
      nullBlockedBaseline,
      file,
      'Nexus source.baselineCommit and baselineTree must be both null or both exact Git object IDs.'
    );

    const negativeBlockedCounter = fixtureState();
    negativeBlockedCounter.nexus = identifiedNexusLedger('blocked');
    fixtureRecord(
      fixtureRecord(negativeBlockedCounter.nexus.coverage).pathClassification
    ).classified = -1;
    await expectOneError(
      root,
      registry,
      negativeBlockedCounter,
      file,
      'Nexus pathClassification.classified must be a finite non-negative safe integer.'
    );

    const invalidNullableCounter = fixtureState();
    invalidNullableCounter.nexus = identifiedNexusLedger('invalidated');
    fixtureRecord(
      fixtureRecord(invalidNullableCounter.nexus.coverage).skillBindings
    ).expected = 'unknown';
    await expectOneError(
      root,
      registry,
      invalidNullableCounter,
      file,
      'Nexus skillBindings.expected must be a finite non-negative safe integer.'
    );

    const unsafeIncompleteCounter = fixtureState();
    unsafeIncompleteCounter.nexus = identifiedNexusLedger('incomplete');
    fixtureRecord(
      fixtureRecord(unsafeIncompleteCounter.nexus.coverage).mechanismDecisions
    ).decided = Number.MAX_SAFE_INTEGER + 1;
    await expectOneError(
      root,
      registry,
      unsafeIncompleteCounter,
      file,
      'Nexus mechanismDecisions.decided must be a finite non-negative safe integer.'
    );

    const invalidatedRange = fixtureState();
    invalidatedRange.nexus = identifiedNexusLedger('invalidated');
    fixtureRecord(
      fixtureRecord(invalidatedRange.nexus.coverage).acceptedParity
    ).proven = 1;
    await expectOneError(
      root,
      registry,
      invalidatedRange,
      file,
      'Nexus acceptedParity.proven cannot exceed accepted.'
    );

    const nullCandidateSource = fixtureState();
    nullCandidateSource.nexus = candidateNexusLedger();
    nullCandidateSource.nexus.source = {
      repository: 'QzCrane/nexus',
      baselineCommit: null,
      baselineTree: null,
      trackedPaths: null
    };
    await expectOneError(
      root,
      registry,
      nullCandidateSource,
      file,
      'Nexus status candidate-complete requires non-null source and coverage counters.'
    );
  });
});

test('Nexus complete fails closed until typed materialized-record validation exists', async () => {
  await withLedgerFixture(async (root, registry) => {
    const census = fixtureState();
    await expectZeroErrors(root, registry, census);
    const file = 'docs/governance/nexus-absorption-ledger.yaml';

    const prematureComplete = structuredClone(census);
    prematureComplete.nexus.status = 'complete';
    await expectOneError(
      root,
      registry,
      prematureComplete,
      file,
      NEXUS_COMPLETE_UNSUPPORTED
    );

    const candidate = fixtureState();
    candidate.nexus = candidateNexusLedger();
    await expectZeroErrors(root, registry, candidate);

    const unmaterializedComplete = structuredClone(candidate);
    unmaterializedComplete.nexus.status = 'complete';
    await expectOneError(
      root,
      registry,
      unmaterializedComplete,
      file,
      NEXUS_COMPLETE_UNSUPPORTED
    );

    const counterMismatchComplete = structuredClone(candidate);
    counterMismatchComplete.nexus.status = 'complete';
    (counterMismatchComplete.nexus.source as Record<string, unknown>).trackedPaths = 9;
    await expectOneError(
      root,
      registry,
      counterMismatchComplete,
      file,
      NEXUS_COMPLETE_UNSUPPORTED
    );

    const untypedMaterialization = structuredClone(candidate);
    untypedMaterialization.nexus.materialization = {
      record: {
        path: 'package.json',
        digest: sha256(JSON.stringify(untypedMaterialization.packageJson))
      },
      artifact: {
        path: 'bun.lock',
        digest: sha256(stringifyYaml(untypedMaterialization.bunLock))
      }
    };
    await expectOneError(
      root,
      registry,
      untypedMaterialization,
      file,
      'Nexus ledger.materialization is not allowed.'
    );
    const materializedComplete = structuredClone(untypedMaterialization);
    materializedComplete.nexus.status = 'complete';
    await expectOneError(
      root,
      registry,
      materializedComplete,
      file,
      NEXUS_COMPLETE_UNSUPPORTED
    );

    const unprovenCandidate = structuredClone(candidate);
    (unprovenCandidate.nexus.completion as Record<string, unknown>).noOmissionProven = false;
    await expectOneError(
      root,
      registry,
      unprovenCandidate,
      file,
      'Nexus status candidate-complete requires completion.noOmissionProven=true.'
    );

    const nonMaterializedCensus = structuredClone(candidate);
    const pathClassification = (
      nonMaterializedCensus.nexus.coverage as Record<string, unknown>
    ).pathClassification as Record<string, unknown>;
    pathClassification.materialized = false;
    await expectOneError(
      root,
      registry,
      nonMaterializedCensus,
      file,
      'Nexus status candidate-complete requires complete materialized '
      + 'census/entrypoints/parity/retirement.'
    );

    const mismatchedCount = structuredClone(candidate);
    (mismatchedCount.nexus.source as Record<string, unknown>).trackedPaths = 9;
    await expectOneError(
      root,
      registry,
      mismatchedCount,
      file,
      'Nexus status candidate-complete conflicts with source or coverage counters.'
    );

    const invalidCommit = structuredClone(candidate);
    (invalidCommit.nexus.source as Record<string, unknown>).baselineCommit = 'not-exact';
    await expectOneError(
      root,
      registry,
      invalidCommit,
      file,
      'Nexus source.baselineCommit must be an exact lowercase 40-character Git object ID.'
    );
  });
});
