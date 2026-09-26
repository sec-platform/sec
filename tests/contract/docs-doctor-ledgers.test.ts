import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { stringify as stringifyYaml } from 'yaml';

import { LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH, WINDOWS_CONTROL_CLI_PROFILE_ID, WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON, WINDOWS_CONTROL_CLI_SESSION_SURFACE } from '../../src/adapters/providers/windows-control-cli/contract/environment.ts';
import { scanMachineLedgers, type CapabilityLedgerIssue } from '../../src/adapters/verification/platform/provider/capability-ledger-validation.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const WINDOWS_CONTROL_CLI_SPEC_RELATIVE_PATH = WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH;

async function scan(root: string): Promise<CapabilityLedgerIssue[]> {
  const issues: CapabilityLedgerIssue[] = [];
  await scanMachineLedgers(root, issues);
  return issues;
}

const FORBIDDEN_AUTHORITY = [
  'AgentOperationsAuthority',
  'EngineeringIR',
  'actualDelta',
  'canonicalImpact',
  'sourceWriter'
];

function windowsControlCliProvider(): Record<string, unknown> {
  return {
    id: 'windows-native-control-cli',
    category: 'runtime',
    capability: 'host-command-execution',
    decision: 'integrate-provider',
    lifecycle: 'revalidation-required',
    activeRoutingProfile: WINDOWS_CONTROL_CLI_PROFILE_ID,
    surfaces: { cli: [WINDOWS_CONTROL_CLI_SESSION_SURFACE], standingMcp: [] },
    forbiddenAuthority: [...FORBIDDEN_AUTHORITY],
    unresolved: [WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON]
  };
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
      repository: 'sec-platform/sec'
    },
    policy: { owner: 'docs/架构/实现供给与替换.md' },
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
        lifecycle: 'revalidation-required'
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
      deferCannotAuthorizeCustomSubstitute: true,
      maxStandingGraphProviders: 1,
      providerOutputCannotBecomeCanonical: true,
      providerWriteRequiresWorkPackage: true,
      terminalConsumerHorizonRequired: true
    }
  };
}

interface FixtureState {
  external: Record<string, unknown>;
}

function fixtureState(): FixtureState {
  return {
    external: externalLedger()
  };
}

async function withLedgerFixture(
  execute: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-docs-ledgers-'));
  try {
    await mkdir(path.join(root, 'config/external-capabilities'), { recursive: true });
    await execute(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeFixture(root: string, state: FixtureState): Promise<void> {
  const specPath = path.join(root, ...WINDOWS_CONTROL_CLI_SPEC_RELATIVE_PATH.split('/'));
  await mkdir(path.dirname(specPath), { recursive: true });
  const canonicalSpecSource = await readFile(
    path.join(REPOSITORY_ROOT, ...WINDOWS_CONTROL_CLI_SPEC_RELATIVE_PATH.split('/')),
    'utf8'
  );
  await rm(specPath, { recursive: true, force: true });
  await Promise.all([
    writeFile(
      path.join(root, 'config/external-capabilities/ledger.yaml'),
      stringifyYaml(state.external),
      'utf8'
    ),
    writeFile(specPath, canonicalSpecSource, 'utf8')
  ]);
}

function machineErrors(issues: CapabilityLedgerIssue[]): CapabilityLedgerIssue[] {
  return issues.filter((issue) => issue.code === 'machine-ledger-invalid');
}

async function expectZeroErrors(
  root: string,
  state: FixtureState
): Promise<void> {
  await writeFixture(root, state);
  expect(machineErrors(await scan(root))).toEqual([]);
}

async function expectOneError(
  root: string,
  state: FixtureState,
  file: string,
  message: string
): Promise<void> {
  await writeFixture(root, state);
  expect(machineErrors(await scan(root)).map((issue) => ({
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
  expect(machineErrors(await scan(REPOSITORY_ROOT))).toEqual([]);
});

test('external provider state transitions are ledger-only and graph standing count is typed', async () => {
  await withLedgerFixture(async (root) => {
    const base = fixtureState();
    await expectZeroErrors(root, base);

    const transitioned = structuredClone(base);
    transitioned.external.status = 'active';
    provider(transitioned.external, 'package-graph').lifecycle = 'active';
    await expectZeroErrors(root, transitioned);
  });
});

test('the canonical EnvironmentSpec route remains valid while unrelated ledger revalidation stays negative', async () => {
  await withLedgerFixture(async (root) => {
    const state = fixtureState();
    (state.external.providers as Array<Record<string, unknown>>).push(
      windowsControlCliProvider()
    );
    await expectZeroErrors(root, state);
    expect(state.external.status).toBe('revalidation-required');

    const unrelatedRevalidation = structuredClone(state);
    const architectureGraph = provider(unrelatedRevalidation.external, 'package-graph');
    architectureGraph.lifecycle = 'revalidation-required';
    await expectZeroErrors(root, unrelatedRevalidation);
  });
});

test('docs doctor reads the supplied EnvironmentSpec with no-follow and rejects file-shape drift', async () => {
  await withLedgerFixture(async (root) => {
    const state = fixtureState();
    (state.external.providers as Array<Record<string, unknown>>).push(
      windowsControlCliProvider()
    );
    const specPath = path.join(root, ...WINDOWS_CONTROL_CLI_SPEC_RELATIVE_PATH.split('/'));
    const file = 'config/external-capabilities/ledger.yaml';
    const expectSpecError = async (
      mutate: () => Promise<void>,
      message: string
    ): Promise<void> => {
      await writeFixture(root, state);
      await mutate();
      expect(machineErrors(await scan(root)).map((issue) => ({
        file: issue.file,
        message: issue.message
      }))).toEqual([{ file, message }]);
    };

    await expectSpecError(
      async () => {
        await rm(specPath, { force: true });
      },
      'EnvironmentSpec src/adapters/providers/windows-control-cli/profile/default.json is missing.'
    );

    await expectSpecError(
      async () => {
        await rm(specPath, { force: true });
        await mkdir(specPath);
      },
      'EnvironmentSpec src/adapters/providers/windows-control-cli/profile/default.json '
        + 'is not an ordinary file.'
    );

    const canonical = await readFile(
      path.join(REPOSITORY_ROOT, ...WINDOWS_CONTROL_CLI_SPEC_RELATIVE_PATH.split('/')),
      'utf8'
    );
    await writeFixture(root, state);
    const duplicate = canonical.replace(
      '  "profileId": "sec-windows-control-cli-v1",',
      '  "profileId": "sec-windows-control-cli-v1",\n  "profileId": "sec-windows-control-cli-v1",'
    );
    await writeFile(specPath, duplicate, 'utf8');
    const duplicateIssues = machineErrors(await scan(root));
    expect(duplicateIssues).toHaveLength(1);
    expect(duplicateIssues[0]?.message).toContain(
      'EnvironmentSpec src/adapters/providers/windows-control-cli/profile/default.json '
        + 'has duplicate or invalid object keys:'
    );

    await writeFixture(root, state);
    const unknown = canonical.replace(
      '  "profileId": "sec-windows-control-cli-v1",',
      '  "profileId": "sec-windows-control-cli-v1",\n  "unknown": true,'
    );
    await writeFile(specPath, unknown, 'utf8');
    const unknownIssues = machineErrors(await scan(root));
    expect(unknownIssues).toHaveLength(1);
  });
});

test('host-command-execution has one exhaustive provider closure with no null or alias route', async () => {
  await withLedgerFixture(async (root) => {
    const file = 'config/external-capabilities/ledger.yaml';
    const cases: Array<[
      string,
      (provider: Record<string, unknown>) => void,
      string
    ]> = [
      ['alias provider id', (entry) => {
        entry.id = 'windows-native-control-cli-alias';
      }, 'External capability provider windows-native-control-cli-alias host-command-execution provider closure is invalid.'],
      ['wrong surface', (entry) => {
        (entry.surfaces as Record<string, unknown>).cli = ['foreign-cli-surface'];
      }, 'External capability provider windows-native-control-cli host-command-execution provider surfaces are invalid.'],
      ['parser-only surface', (entry) => {
        (entry.surfaces as Record<string, unknown>).cli = ['windows-control-cli-environment'];
      }, 'External capability provider windows-native-control-cli host-command-execution provider surfaces are invalid.'],
      ['wrong lifecycle', (entry) => {
        entry.lifecycle = 'active';
      }, 'External capability provider windows-native-control-cli.unresolved is not allowed.'],
      ['missing closure reason', (entry) => {
        entry.unresolved = [];
      }, `External capability provider windows-native-control-cli.unresolved must contain exactly ${
        WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON
      }.`]
    ];
    for (const [, mutate, message] of cases) {
      const state = fixtureState();
      (state.external.providers as Array<Record<string, unknown>>).push(
        windowsControlCliProvider()
      );
      mutate(provider(state.external, 'windows-native-control-cli'));
      await expectOneError(root, state, file, message);
    }
  });
});

test('docs doctor uses the hosted capability epoch window for every observation', async () => {
  await withLedgerFixture(async (root) => {
    const state = fixtureState();
    const capability = (state.external.verification as Record<string, unknown>).capabilities as Array<Record<string, unknown>>;
    capability[0]!.observedAt = '2026-08-10T23:59:59.999Z';
    await expectOneError(root, state, 'config/external-capabilities/ledger.yaml',
      'VerificationProviderCapability capability codex-review observation must fall within the availability epoch.');
  });
});

test('docs doctor preserves the verification ledger parser failure reason', async () => {
  await withLedgerFixture(async (root) => {
    const state = fixtureState();
    const verification = state.external.verification as Record<string, unknown>;
    verification.legacyEpoch = 'v0';
    await expectOneError(root, state, 'config/external-capabilities/ledger.yaml',
      'External capability ledger.verification.legacyEpoch is not allowed.');
  });
});

test('docs doctor delegates static positive capability projections to the canonical normalizer', async () => {
  await withLedgerFixture(async (root) => {
    const state = fixtureState();
    const capability = (state.external.verification as Record<string, unknown>)
      .capabilities as Array<Record<string, unknown>>;
    capability[0]!.availability = 'available';
    capability[0]!.reasonCode = null;
    capability[0]!.receiptRef = `sha256:${'a'.repeat(64)}`;
    await expectZeroErrors(root, state);
  });
});

test('external provider schema and cross-field negatives report the exact failing field', async () => {
  await withLedgerFixture(async (root) => {
    const base = fixtureState();
    await expectZeroErrors(root, base);
    const file = 'config/external-capabilities/ledger.yaml';

    const wrongSchema = structuredClone(base);
    wrongSchema.external.schema = 'sec-external-capability-ledger-v2';
    await expectOneError(
      root,
      wrongSchema,
      file,
      'External capability ledger schema must be sec-external-capability-ledger-v4.'
    );

    const wrongStatus = structuredClone(base);
    wrongStatus.external.status = 'active';
    await expectOneError(
      root,
      wrongStatus,
      file,
      'External capability ledger status must be revalidation-required while any provider requires revalidation.'
    );

    const wrongCapability = structuredClone(base);
    provider(wrongCapability.external, 'package-graph').capability = 'security-analysis';
    await expectOneError(
      root,
      wrongCapability,
      file,
      'External capability provider package-graph.capability security-analysis requires category security.'
    );

    const platformSubstitution = structuredClone(base);
    fixtureRecord(fixtureRecord(platformSubstitution.external.executionTopology).invariants)
      .noPlatformSubstitution = false;
    await expectOneError(
      root,
      platformSubstitution,
      file,
      'External capability ledger.executionTopology.invariants must all be true.'
    );

    const weakAuthority = structuredClone(base);
    provider(weakAuthority.external, 'package-graph').forbiddenAuthority =
      FORBIDDEN_AUTHORITY.slice(0, -1);
    await expectOneError(
      root,
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
      duplicateSurface,
      file,
      'Standing MCP surface architecture-query is owned by both package-graph and security-query.'
    );

    const blankCliSurface = structuredClone(base);
    fixtureRecord(provider(blankCliSurface.external, 'package-graph').surfaces).cli = ['   '];
    await expectOneError(
      root,
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
      overlongCliSurface,
      file,
      'External capability provider package-graph.surfaces.cli[0] '
      + 'must be at most 128 characters.'
    );

    const nonKebabSurface = structuredClone(base);
    fixtureRecord(provider(nonKebabSurface.external, 'package-graph').surfaces).cli = [
      'Workspace.Query/v2'
    ];
    await expectZeroErrors(root, nonKebabSurface);

    const watchCli = structuredClone(base);
    (provider(watchCli.external, 'codegraph').surfaces as Record<string, unknown>).cli = ['query'];
    await expectOneError(
      root,
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
      retiredCli,
      file,
      'External capability provider retired-graph cannot expose active surfaces '
      + 'without an active routing profile.'
    );

    const superseded = structuredClone(base);
    provider(superseded.external, 'retired-graph').decision = 'superseded';
    delete provider(superseded.external, 'retired-graph').rationale;
    await expectZeroErrors(root, superseded);
    const supersededCli = structuredClone(superseded);
    (provider(supersededCli.external, 'retired-graph').surfaces as Record<string, unknown>).cli = [
      'query'
    ];
    await expectOneError(
      root,
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
      secondStandingGraph,
      file,
      'External capability ledger has 2 standing graph providers; maximum is 1.'
    );
  });
});

test('ledger schemas reject missing, unknown, nested, and legacy alias fields', async () => {
  await withLedgerFixture(async (root) => {
    const base = fixtureState();
    await expectZeroErrors(root, base);
    const externalFile = 'config/external-capabilities/ledger.yaml';
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

    for (const variant of variants) {
      await expectOneError(
        root,
        variant.state,
        variant.file,
        variant.message
      );
    }
  });
});

test('external runner release authority binds exact primary-source archive and base image digests', async () => {
  await withLedgerFixture(async (root) => {
    const base = fixtureState();
    const environment = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
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
        destructiveIdentityAuthority: {
          endpointBinding: [
            'github-api-host-principal-repository', 'docker-context-endpoint-daemon'
          ],
          immutableEffects: ['exact-image-id', 'exact-container-id', 'exact-runner-id'],
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
        cli: ['src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts'],
        standingMcp: []
      },
      forbiddenAuthority: [...FORBIDDEN_AUTHORITY]
    };
    (base.external.providers as Array<Record<string, unknown>>).push(localRunner);
    await expectZeroErrors(root, base);

    const digestDrift = structuredClone(base);
    const drifted = provider(digestDrift.external, 'github-actions-local-runner');
    (drifted.versionAuthority as Record<string, unknown>).artifactSha256 = 'bad';
    await expectOneError(
      root,
      digestDrift,
      'config/external-capabilities/ledger.yaml',
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
      capabilityDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.'
        + 'outerSutContainerCapabilities must bind the exact constructor boundary.'
    );

    const releaseDrift = structuredClone(base);
    const release = provider(releaseDrift.external, 'github-actions-local-runner');
    (release.versionAuthority as Record<string, unknown>).release =
      'https://github.com/actions/runner/releases/tag/v2.335.0';
    await expectOneError(
      root,
      releaseDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority '
        + 'GitHub Actions runner release identity is invalid.'
    );

    const nodeDigestDrift = structuredClone(base);
    const nodeAuthority = provider(nodeDigestDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    nodeAuthority.nodeArtifactSha256 = '0'.repeat(64);
    await expectOneError(
      root,
      nodeDigestDrift,
      'config/external-capabilities/ledger.yaml',
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
      githubCliDigestDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority '
        + 'GitHub CLI identity is invalid.'
    );

    const pythonDrift = structuredClone(base);
    const pythonAuthority = provider(pythonDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    pythonAuthority.pythonVersion = '3.12.2';
    await expectOneError(
      root,
      pythonDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.pythonVersion '
        + 'must bind the archive-inspection runtime.'
    );

    const zipDrift = structuredClone(base);
    const zipAuthority = provider(zipDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    zipAuthority.zipExtractionCapability = 'missing';
    await expectOneError(
      root,
      zipDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.'
        + 'zipExtractionCapability must bind setup archive extraction.'
    );

    const imageDrift = structuredClone(base);
    const imageAuthority = provider(imageDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    imageAuthority.imageId = `sha256:${'f'.repeat(64)}`;
    await expectOneError(
      root,
      imageDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.imageId '
        + 'must be an exact built image digest.'
    );

    const initDrift = structuredClone(base);
    const initAuthority = provider(initDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    initAuthority.containerInitCapability = 'ambient-pid1';
    await expectOneError(
      root,
      initDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.containerInitCapability '
        + 'must bind persistent child reaping.'
    );

    const roleDrift = structuredClone(base);
    const roleAuthority = provider(roleDrift.external, 'github-actions-local-runner')
      .versionAuthority as Record<string, unknown>;
    roleAuthority.roleProfiles = ['sec-linux-verification-sut-v1'];
    await expectOneError(
      root,
      roleDrift,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.roleProfiles '
        + 'must bind the exact trust-domain roles.'
    );

    const authorityKindEscape = structuredClone(base);
    const escaped = provider(authorityKindEscape.external, 'github-actions-local-runner');
    escaped.observedVersion = '1.6.3';
    escaped.versionAuthority = {
      kind: 'package'
    };
    await expectOneError(
      root,
      authorityKindEscape,
      'config/external-capabilities/ledger.yaml',
      'External capability provider github-actions-local-runner.versionAuthority.kind '
        + 'must be external-release for the workflow-execution capability.'
    );
  });
});
