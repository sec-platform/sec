/** Isolated process for the real MainHealth producer and admission owner.
 * The Container Engine provider/session and GitHub enrollment transport are
 * substituted. Git
 * bundle/read, physical root/state leases, semantic settlement, receipt
 * construction, private qualification and revocation all execute normally.
 * Deterministic transport replies are wiring evidence, never Docker evidence.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { mock } from 'bun:test';

import type { ContainerEngineOperation, ContainerEngineSession, OpenContainerEngineSessionInput } from '../../../src/adapters/providers/docker/contract/container-engine-session.ts';
import { createDockerEndpointIdentity } from '../../../src/adapters/providers/docker/contract/daemon.ts';
import { withGitHubApiTestEnrollmentSession } from '../../../src/adapters/providers/github-api/test/operation-session.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY as environment } from '../../../src/adapters/providers/linux-verification/contract.ts';
import { resolveSecRuntimeStateForRepository } from '../../../src/adapters/runtime-state/workspace-state/paths.ts';
import { createMainHealthLedger } from '../../../src/adapters/self-hosting/control/main-health/contract.ts';
import { createTrustedRuntimeMainHealthReceipt, parseTrustedRuntimeMainHealthReceipt, trustedRuntimeMainHealthReceiptLocator, type TrustedRuntimeMainHealthReceipt } from '../../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';
import { issueSecProviderSettlementReceipt, type SecBoundSemanticOperation, type SecOperationDigest } from '../../../src/execution/operation/semantic.ts';

const scenario = process.argv[2]!;
const root = process.argv[3]!;
const events: string[] = [];
const commands: string[] = [];
const supportedOperations = Object.freeze([
  'image-inspect', 'container-list', 'container-create', 'container-start',
  'container-inspect', 'network-disconnect', 'container-remove', 'container-exec'
] as const satisfies readonly ContainerEngineOperation['kind'][]);
const endpoint = createDockerEndpointIdentity({ contextName: 'test-only',
  endpointHost: 'unix:///var/run/docker.sock', daemonId: 'test-only', osType: 'linux', architecture: 'x86_64' });
const providerIdentityDigest = sha256({ provider: 'deterministic-main-health-transport' }) as SecOperationDigest;
const id = 'c'.repeat(64);
const imageLabels = {
  'sec.trusted-runtime.image-schema': environment.trustedRuntime.imageSchema,
  'sec.trusted-runtime.base-image-id': environment.image.dockerProjectionDigest,
  'sec.trusted-runtime.bun-archive-sha256': environment.trustedRuntime.bunArchiveDigest,
  'sec.trusted-runtime.bun-executable-sha256': environment.trustedRuntime.bunExecutableDigest,
  'sec.trusted-runtime.bun-version': environment.trustedRuntime.bunVersion
};
function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}
git(['init', '--quiet']);
writeFileSync(path.join(root, 'bun.lock'), '{"lockfileVersion":1,"workspaces":{}}\n');
git(['add', '--', 'bun.lock']);
git(['commit', '--quiet', '-m', 'MainHealth fixture input']);
const mainSha = git(['rev-parse', 'HEAD']);
const mainTreeSha = git(['rev-parse', 'HEAD^{tree}']);
const input = { repositoryRoot: root, repository: 'sec-platform/sec', mainSha, mainTreeSha };
const realDateNow = Date.now;
const admittedAt = Date.now();
let clock = admittedAt;
Date.now = () => clock;
let deadline = 0;
let scope: { operation: SecBoundSemanticOperation; index: number } | null = null;
let scopeCount = 0;
let producerCount = 0;
let identityReads = 0;
let endpointReads = 0;
let networks = { bridge: {} } as Record<string, unknown>;
let createArgs: readonly string[] = [];
let bundlePath = '';
let callbackCount = 0;
let retained: TrustedRuntimeMainHealthReceipt | undefined;
let consumption: Record<string, unknown> = {};
const reply = (value: unknown = '', code = 0) => ({ code,
  stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  stderr: Buffer.from(code === 0 ? '' : 'controlled transport failure') });
const argumentValues = (args: readonly string[], flag: string) => args.flatMap((arg, index) => arg === flag ? [args[index + 1]!] : []);
const engine = await import('../../../src/adapters/providers/docker/runtime/container-engine-session.ts');
const github = await import('../../../src/adapters/providers/github-api/operation-session.ts');
mock.module('../../../src/adapters/providers/github-api/operation-session.ts', () => ({
  ...github,
  // Reuse the existing test-only enrollment and request/settlement owner.
  // Do not replace MainHealth observation or either authority issuer/assertion.
  withGitHubApiReadSession: async <T>(request: Parameters<typeof github.withGitHubApiReadSession<T>>[0]) =>
    await withGitHubApiTestEnrollmentSession({
      repository: request.repository, effect: 'read',
      readToken: async () => 'test-token-main-health-0123456789',
      transport: async (target) => {
        const url = String(target);
        if (url.endsWith('/user')) return Response.json({ login: 'maintainer', node_id: 'USER_test' });
        if (url.endsWith('/permission')) return Response.json({ permission: 'maintain' });
        if (url.includes('/check-runs?')) return Response.json({ total_count: 0, check_runs: [] });
        throw new Error(`Unexpected GitHub transport request ${url}`);
      },
      operation: request.operation
    })
}));
mock.module('../../../src/adapters/providers/docker/runtime/installed-command-provider.ts', () => ({
  openDockerCommandProvider: async () => ({ providerIdentityDigest })
}));
mock.module('../../../src/adapters/providers/docker/runtime/container-engine-session.ts', () => ({
  ...engine,
  openContainerEngineSession: async (opening: OpenContainerEngineSessionInput): Promise<ContainerEngineSession> => {
    producerCount++;
    scopeCount = 0;
    identityReads = 0;
    endpointReads = 0;
    networks = { bridge: {} };
    deadline = opening.operation.plan.attempt.deadlineAtUnixMs;
    events.push('session-open');
    return {
      endpoint, cwd: root, executable: 'test-only', commandProtocol: 'docker-cli', supportedOperations,
      deadlineAtUnixMs: deadline, providerIdentityDigest,
      openOperationScope(binding) {
        assert.equal(scope, null, 'provider scopes cannot nest or overlap');
        engine.assertContainerEngineOperationScopeAdmission({ ...binding, providerIdentityDigest,
          sessionDeadlineAtUnixMs: deadline });
        const index = ++scopeCount;
        scope = { operation: binding.operation, index };
        events.push(`scope-open:${index}`);
        return { operationIdentityDigest: binding.operation.plan.identity.identityDigest,
          boundAttemptDigest: binding.operation.boundAttemptDigest, requirementId: binding.requirementId,
          settle() {
            assert.equal(scope?.index, index);
            scope = null;
            events.push(`scope-settle:${index}`);
            if (scenario === `settlement-throw-${index}`) throw new Error(`TEST_SETTLEMENT_${index}`);
            return issueSecProviderSettlementReceipt(binding.operation, {
              requirementId: binding.requirementId,
              physicalDisposition: scenario === `settlement-unknown-${index}` ? 'unknown'
                : scenario === `settlement-not-started-${index}` ? 'not-started' : 'settled',
              providerSettlementReferenceDigest: sha256({ index, events: [...events] }) as SecOperationDigest
            });
          }
        };
      },
      async observeEndpoint() {
        // Preserve the actual provider contract: endpoint readback is outside
        // the settled Effect scope. Allowing this while active masks a bug.
        assert.equal(scope, null, 'independent endpoint readback requires the operation scope to be settled');
        events.push(`endpoint:${++endpointReads}`);
        return scenario === 'endpoint-drift' && endpointReads >= 2
          ? { ...endpoint, daemonId: 'another-daemon' } : endpoint;
      },
      async execute(operation: ContainerEngineOperation) {
        assert.notEqual(scope, null, 'transport requires an open scope');
        assert.ok((supportedOperations as readonly string[]).includes(operation.kind),
          'transport command family must be explicitly admitted');
        const args = operation.arguments;
        events.push(`transport:${operation.kind}`);
        switch (operation.kind) {
          case 'image-inspect': return reply([{ Id: environment.trustedRuntime.imageDigest, Config: { Labels: imageLabels } }]);
          case 'container-list': return reply('');
          case 'container-create': {
            createArgs = args;
            const mounts = argumentValues(args, '--mount');
            assert.equal(mounts.some((mount) => mount.startsWith('type=volume,')), false,
              'authority preparation must never mount the candidate-writable dependency cache');
            bundlePath = mounts[0]!.match(/source=(.*),target=/u)![1]!;
            return reply(id);
          }
          case 'container-start': return reply(id);
          case 'container-inspect': {
            if (args[0] === '--format') return reply(networks);
            const labels = Object.fromEntries(argumentValues(createArgs, '--label').map((label) => {
              const split = label.indexOf('='); return [label.slice(0, split), label.slice(split + 1)];
            }));
            const tmpfs = Object.fromEntries(argumentValues(createArgs, '--tmpfs').map((entry) => {
              const split = entry.indexOf(':'); return [entry.slice(0, split), entry.slice(split + 1)];
            }));
            return reply([{ Id: id, Name: `/${argumentValues(createArgs, '--name')[0]}`,
              Image: environment.trustedRuntime.imageDigest, Config: { Labels: labels },
              HostConfig: { ReadonlyRootfs: true, Init: true, Tmpfs: tmpfs },
              Mounts: [{ Type: 'bind', RW: false, Source: bundlePath, Destination: '/candidate.bundle' }] }]);
          }
          case 'network-disconnect': if (scenario !== 'network-attached') networks = {}; return reply('');
          case 'container-remove': events.push('container-removed'); return reply('', scenario === 'cleanup-failed' ? 1 : 0);
          case 'container-exec': {
            if (args.includes('/bin/bash') && args.includes('-ceu')) {
              // Independently observe the real bundle bytes handed to transport.
              const bytes = readFileSync(bundlePath);
              assert.equal(Number(args.at(-2)), bytes.length);
              const digest = `sha256:${(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')}`;
              assert.equal(args.at(-1), digest);
              return reply(digest);
            }
            if (args.includes('/bin/mkdir')) return reply('');
            if (args.includes('/bin/bash') && args.includes('-lc')) {
              events.push('dependency-setup');
              return reply('', scenario === 'setup-failed' ? 1 : 0);
            }
            const gitIndex = args.indexOf('git');
            if (gitIndex >= 0) {
              const command = args.slice(gitIndex + 1).join(' ');
              if (command === 'rev-parse HEAD') {
                identityReads++;
                return reply(scenario === `main-drift-${identityReads}` ? 'a'.repeat(40) : mainSha);
              }
              if (command === 'rev-parse HEAD^{tree}') return reply(scenario === `tree-drift-${identityReads}` ? 'b'.repeat(40) : mainTreeSha);
              if (command === 'status --porcelain=v1 --untracked-files=all') return reply(scenario === `dirty-${identityReads}` ? ' M bun.lock' : '');
            }
            const bun = args.indexOf('bun');
            if (bun >= 0) {
              const command = args.slice(bun).join(' ');
              commands.push(command);
              return reply(`output:${producerCount}:${command}`, scenario === `command-failed-${commands.length}` ? 1 : 0);
            }
            throw new Error(`Unexpected controlled command ${args.join(' ')}`);
          }
          default: throw new Error(`Unexpected transport operation ${operation.kind}`);
        }
      },
      close() {
        assert.equal(scope, null);
        events.push('session-closed');
        if (scenario === 'close-failed') throw new Error('TEST_SESSION_CLOSE');
        // Simulate producer time without sleeping or replenishing admission.
        clock += 30_000;
      }
    };
  }
}));

const { assertTrustedRuntimeMainHealthQualification: qualify,
  executeTrustedRuntimeMainHealth, withTrustedRuntimeMainHealthQualification } =
  await import('../../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts');
const { observeCanonicalMainHealthForPublication: observePublication,
  assertMainHealthPublicationAuthorityStable: assertStable,
  assertMainHealthPublicationLedger: assertLedger } =
  await import('../../../src/adapters/self-hosting/control/main-health/work-selection-main-health.ts');
function storeReceipt(receipt: TrustedRuntimeMainHealthReceipt): void {
  const layout = resolveSecRuntimeStateForRepository(input);
  const locator = trustedRuntimeMainHealthReceiptLocator({ repositoryStateRoot: layout.repositoryStateRoot,
    mainSha, receiptDigest: receipt.receiptDigest });
  mkdirSync(locator.directory, { recursive: true });
  writeFileSync(path.join(locator.directory, locator.fileName), `${encodeVerificationActionData(receipt)}\n`);
}
const { compileTrustedRuntimePostMainIssueDispositionHealthReadback: postMainHealth } =
  await import('../../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts');
const publication = (receipt?: TrustedRuntimeMainHealthReceipt) => observePublication({ ...input,
  defaultBranch: 'main', ...(receipt === undefined ? {} : { qualifiedLocalReceipt: receipt }) });
let failure: string | null = null;
try {
  if (scenario === 'unscoped-producer') {
    retained = await executeTrustedRuntimeMainHealth(input);
    assert.throws(() => qualify({ ...input, receipt: retained! }), /live production execution qualification/u);
    consumption = { unscopedRejected: true };
  } else await withTrustedRuntimeMainHealthQualification({ ...input,
    ...(scenario === 'parent-budget' ? { deadlineAtUnixMs: admittedAt + 60_000 } : {}),
    ...(scenario === 'expired-parent' ? { deadlineAtUnixMs: admittedAt } : {}),
    ...(scenario === 'invalid-parent' ? { deadlineAtUnixMs: Number.NaN } : {})
  }, async (receipt) => {
    callbackCount++;
    retained = receipt;
    events.push('consumer');
    const first = qualify({ ...input, receipt });
    assert.equal(Date.parse(first.expiresAt), deadline);
    assert.equal(deadline, admittedAt + (scenario === 'parent-budget' ? 60_000 : 4 * 60 * 60_000));
    const layout = resolveSecRuntimeStateForRepository(input);
    const leases = path.join(layout.repositoryStateRoot, 'trusted-runtime-container-leases', 'v1');
    assert.deepEqual(readdirSync(leases).filter((name) => name.endsWith('.lock')), []);
    consumption = { firstExpiresAt: first.expiresAt, dependencyCacheKey: receipt.dependencyCacheKey,
      dependencyPreparation: receipt.dependencyPreparation, producerSettledBeforeConsumer: events.at(-2) === 'session-closed' };
    for (const copy of [{ ...receipt }, JSON.parse(JSON.stringify(receipt)),
      parseTrustedRuntimeMainHealthReceipt(JSON.stringify(receipt)), createTrustedRuntimeMainHealthReceipt(receipt)]) {
      assert.throws(() => qualify({ ...input, receipt: copy }), /live production execution qualification/u);
    }
    for (const mismatch of [{ repository: 'another/repo' }, { mainSha: 'd'.repeat(40) },
      { mainTreeSha: 'e'.repeat(40) }, { repositoryRoot: path.dirname(root) }]) {
      assert.throws(() => qualify({ ...input, ...mismatch, receipt }), /live production execution qualification/u);
    }
    if (scenario.startsWith('publication') || scenario === 'post-main-health') {
      storeReceipt(receipt);
      const firstObservation = await publication(receipt);
      assert.equal(firstObservation.projection.state, 'healthy');
      assert.notEqual(firstObservation.ledger, null);
      assert.equal(firstObservation.ledger!.producer.sourceTransport, 'trusted-runtime-durable-readback');
      assertLedger({ authority: firstObservation.authority, ledger: firstObservation.ledger!, now: firstObservation.observedAt });
      assert.throws(() => assertLedger({ authority: { ...firstObservation.authority },
        ledger: firstObservation.ledger!, now: firstObservation.observedAt }), /forged or not issued/u);
      for (const changed of [{ sourceDigest: `sha256:${'f'.repeat(64)}` as const },
        { sourceRunId: 'another-execution' },
        { sourceRef: `runtime-state:trusted-main-health/v1/main-${mainSha}.json` }]) {
        const substituted = createMainHealthLedger({ ...firstObservation.ledger!,
          producer: { ...firstObservation.ledger!.producer, ...changed } });
        assert.throws(() => assertLedger({ authority: firstObservation.authority,
          ledger: substituted, now: firstObservation.observedAt }), /exact current canonical publication selection/u);
      }
      if (scenario === 'post-main-health') {
        const healthInput = { repository: input.repository, newMainSha: mainSha,
          newMainTreeSha: mainTreeSha, observedAt: firstObservation.observedAt,
          ledger: firstObservation.ledger!, admission: { authority: firstObservation.authority,
            receipt, repositoryRoot: root } };
        assert.equal(postMainHealth(healthInput), firstObservation.ledger);
        for (const changed of [{ newMainSha: 'a'.repeat(40) },
          { newMainTreeSha: 'b'.repeat(40) }, { repository: 'another/repo' }]) {
          assert.throws(() => postMainHealth({ ...healthInput, ...changed }));
        }
        assert.throws(() => postMainHealth({ ...healthInput, admission: {
          ...healthInput.admission, receipt: { ...receipt } } }));
        assert.throws(() => postMainHealth({ ...healthInput, admission: {
          ...healthInput.admission, authority: { ...firstObservation.authority } } }));
        clock = deadline;
        assert.throws(() => postMainHealth(healthInput));
        clock = admittedAt;
        consumption.postMainAccepted = true;
        consumption.postMainMismatchRejected = true;
      }
      const secondObservation = await publication(receipt);
      assertStable(firstObservation.authority, secondObservation.authority);
      assertLedger({ authority: secondObservation.authority, ledger: secondObservation.ledger!, now: secondObservation.observedAt });
      // Stored canonical bytes and parsed/copy receipts cannot reconstitute
      // the WeakMap capability, even while the genuine sibling is live.
      for (const copied of [undefined, { ...receipt }, parseTrustedRuntimeMainHealthReceipt(JSON.stringify(receipt))]) {
        const raw = await publication(copied);
        assert.equal(raw.projection.state, 'unresolved');
        assert.equal(raw.ledger, null);
      }
      if (scenario === 'publication-source-drift') {
        await withTrustedRuntimeMainHealthQualification(input, async (nextReceipt) => {
          storeReceipt(nextReceipt);
          const next = await publication(nextReceipt);
          assert.equal(next.projection.state, 'healthy');
          assert.notEqual(next.ledger!.producer.sourceDigest, firstObservation.ledger!.producer.sourceDigest);
          assert.throws(() => assertStable(firstObservation.authority, next.authority), /drifted between live snapshots/u);
          consumption.sourceDriftRejected = true;
        });
      }
      consumption.publicationAccepted = true;
      consumption.copiedAuthorityRejected = true;
      consumption.unqualifiedJsonRejected = true;
    }
    if (scenario === 'consumer-throw') throw new Error('TEST_CONSUMER_THROW');
    if (scenario === 'consumer-cancel') {
      const controller = new AbortController();
      controller.abort(new Error('TEST_CONSUMER_CANCEL'));
      await Promise.resolve();
      controller.signal.throwIfAborted();
    }
    if (scenario === 'root-replaced') {
      renameSync(root, `${root}-original`);
      mkdirSync(root);
      assert.throws(() => qualify({ ...input, receipt }));
      consumption.rootReplacementRejected = true;
    }
    if (scenario === 'expiry' || scenario === 'parent-budget') {
      clock = deadline - 1;
      qualify({ ...input, receipt });
      clock = deadline;
      assert.throws(() => qualify({ ...input, receipt }), /live production execution qualification/u);
      consumption.deadlineBoundaryRejected = true;
    }
    if (scenario === 'long-t2') {
      clock = admittedAt + 2 * 60 * 60_000;
      const second = qualify({ ...input, receipt });
      assert.equal(second.expiresAt, first.expiresAt);
      consumption.longT2Accepted = true;
    }
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (retained !== undefined) {
    assert.throws(() => qualify({ ...input, receipt: retained! }), /live production execution qualification/u);
    if (scenario.startsWith('publication')) {
      const expired = await publication(retained);
      assert.equal(expired.projection.state, 'unresolved');
      assert.equal(expired.ledger, null);
      consumption.revokedPublicationRejected = true;
    }
  }
  Date.now = realDateNow;
}
process.stdout.write(JSON.stringify({ scenario, failure, callbackCount, commands, events, consumption,
  admittedAt, deadline, retainedRevoked: retained !== undefined }) + '\n');
