import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { CodexDevelopmentVerificationDigest } from '../platform/shared/ci-evidence-contract.ts';
import { workPackageWorktreeDigestForTests } from './run-work-package-gate.ts';
import {
  syncWorkPackageGateDirectory,
  writeWorkPackageGateJsonAtomic,
  type WorkPackageGateIdentityProbeEvidenceV4
} from './work-package-gate-contract.ts';
import {
  runWorkPackageProfileProbe,
  workPackageProfileProbeExecutablePaths,
  type WorkPackageProfileProbeDiagnosticV1
} from './work-package-profile-probe.ts';

const EXPECTED_HEAD = 'd392479637fd3503c1f3b365580bce5d913ffe5e';
const EXPECTED_TREE = '76b7984f73ae67205c560dc4f269df77a98f5631';
const EXPECTED_TIMEOUT_MS = 30_000;
const EMPTY_SHA256: `sha256:${string}` = `sha256:${createHash('sha256').digest('hex')}`;

const PROTECTED_FILE_DIGESTS = Object.freeze({
  'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json':
    'sha256:205ce268f49596d4b289f555f71a88d5012b805d53941b9f729a4a29d6625e34',
  'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json':
    'sha256:6acd57b02a319268b2ce2b0e81508894addd71b9d20d37d6d463c286a90fe8a3',
  'docs/evidence/v0-4-semantic-mutation-apply-r3-v4-verification.json':
    'sha256:a035318656987a61a8adcc703c40b53826c74c5c5512573359c7248067da6492',
  'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md':
    'sha256:a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6',
  'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md':
    'sha256:158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951',
  'docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md':
    'sha256:752d8c32c01ecf67cda207a900953493d75ab1c949c97c44cb7f0eb8e0ab3d24',
  '.tmp/sm3-r2-work-package-gate/evidence.json':
    'sha256:17c86874b0370a19c1171ed28c275f6cb5315f96e5b7512fb89135b4e04143be',
  '.tmp/sm3-r2-work-package-gate/events.jsonl':
    'sha256:cd0adb9c928b82dbd184d755b95e8199a6e03ef03373067a0a0cc9c6466585e4',
  '.tmp/sm3-r2-work-package-gate/checkpoint.json':
    'sha256:3d1954c975b19c441d01ac46c2504fc2f20b32f27f84087b39364a0084b0f92a',
  '.tmp/sm3-r2-work-package-gate/state.json':
    'sha256:d7406514c1035c03f0d11cffce32154efc75bf08f1aeb6f68a23fb908e81c52a',
  '.tmp/sm3-r3-v4-work-package-gate/evidence.json':
    'sha256:008325046bcaf0c28ec3bb4b557c84db0caa16ee0688cc8be217cfebc725f9f3',
  '.tmp/sm3-r3-v4-work-package-gate/events.jsonl':
    'sha256:4798fd2ef7b0a9d5aa8094dc6a28c1d461abc12d8d6119919d7f84419b3d258f',
  '.tmp/sm3-r3-v4-work-package-gate/checkpoint.json':
    'sha256:296850dd02b47a5455aedc9882434315536e4409f83b9ee13a35fa55148390cd',
  '.tmp/sm3-r3-v4-work-package-gate/state.json':
    'sha256:317acba04091bba3bc7ed61d75b62279f5469288e08cf23685658dacedd2ce3a',
  '.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned.owner-v1.json':
    'sha256:c768992b8c80064e4981cffe5eb191520352b797b8a46c903eb80faadd6f7b51',
  '.tmp/gate-execution-snapshots/gate-460b94157868151fac54fdc20a7e362a-owned.owner-v1.json':
    'sha256:72e107d14e37d8c9b0f3030f3005b71ef63c813ed8ce4ad805d14cd0ff91c62e'
} as const);

const PROTECTED_DIRECTORIES = Object.freeze([
  '.tmp/sm3-r2-work-package-gate',
  '.tmp/sm3-r3-v4-work-package-gate',
  '.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned',
  '.tmp/gate-execution-snapshots/gate-460b94157868151fac54fdc20a7e362a-owned'
]);

interface ProtectedAuthoritySnapshot {
  readonly entryCount: number;
  readonly digest: string;
}

interface DiagnosticAttemptCustody {
  readonly bytesDigest: string;
  readonly physicalIdentityDigest: string;
}

interface DiagnosticAttemptRecordV1 {
  readonly schema: 'sm3-r4-profile-probe-diagnosis-v1';
  readonly recordType: 'profile-probe-diagnostic';
  readonly status: 'attempted';
  readonly probeAttempted: true;
  readonly recordedAt: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly worktreeDigest: string;
  readonly manifestDigest: string;
  readonly sourceDigests: Readonly<{
    readonly runner: string;
    readonly profileProbe: string;
    readonly diagnosticScript: string;
    readonly syntheticTest: string;
    readonly observedProcess: string;
    readonly r3StopEvidence: string;
  }>;
  readonly sourceBlobIds: Readonly<{
    readonly runner: string;
    readonly contract: string;
    readonly contractTest: string;
    readonly executionTest: string;
  }>;
  readonly protectedAuthority: ProtectedAuthoritySnapshot;
  readonly executableIdentityDigest: string;
  readonly timeoutMs: number;
  readonly attemptRecordDigest: string;
}

interface DiagnosticFinalRecordV1 extends Omit<DiagnosticAttemptRecordV1, 'status'> {
  readonly status: 'complete';
  readonly completedAt: string;
  readonly v4Projection: WorkPackageGateIdentityProbeEvidenceV4;
  readonly diagnostic: WorkPackageProfileProbeDiagnosticV1;
  readonly protectedAuthorityAfter: ProtectedAuthoritySnapshot;
  readonly executableIdentityDigestAfter: string;
  readonly evidenceDigest: string;
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function fileDigest(filePath: string): Promise<`sha256:${string}`> {
  return sha256(await readFile(filePath));
}

function gitRevision(repoRoot: string, revision: string): string {
  const result = spawnSync('git', ['rev-parse', revision], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error('R4 git revision is unavailable');
  return result.stdout.trim();
}

function gitBlobId(repoRoot: string, relativePath: string): string {
  const result = spawnSync('git', ['hash-object', '--', relativePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error('R4 source blob identity is unavailable');
  return result.stdout.trim();
}

async function physicalIdentityDigest(
  filePath: string,
  expectedKind: 'file' | 'directory',
  requireExclusiveLink = false
): Promise<string> {
  const absolute = path.resolve(filePath);
  const canonical = await realpath(absolute);
  const metadata = await lstat(absolute, { bigint: true });
  if (metadata.isSymbolicLink() ||
    (expectedKind === 'file' ? !metadata.isFile() : !metadata.isDirectory()) ||
    path.normalize(canonical).toLocaleLowerCase('en-US') !==
      path.normalize(absolute).toLocaleLowerCase('en-US') ||
    (requireExclusiveLink && metadata.nlink !== 1n)) {
    throw new Error('R4 protected object has the wrong physical kind');
  }
  return CodexDevelopmentVerificationDigest({
    domain: 'sm3-r4-physical-identity-v1',
    pathDigest: CodexDevelopmentVerificationDigest(path.normalize(canonical).toLocaleLowerCase('en-US')),
    kind: expectedKind,
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    nlink: String(metadata.nlink),
    size: String(metadata.size)
  });
}

async function protectedAuthoritySnapshot(repoRoot: string): Promise<ProtectedAuthoritySnapshot> {
  const entries: Array<Readonly<{
    pathDigest: string;
    kind: 'file' | 'directory';
    physicalIdentityDigest: string;
    bytesDigest: string | null;
  }>> = [];
  for (const [relativePath, expectedDigest] of Object.entries(PROTECTED_FILE_DIGESTS)) {
    const absolute = path.join(repoRoot, ...relativePath.split('/'));
    const bytesDigest = await fileDigest(absolute);
    if (bytesDigest !== expectedDigest) throw new Error('R4 protected file digest changed');
    entries.push(Object.freeze({
      pathDigest: CodexDevelopmentVerificationDigest(relativePath),
      kind: 'file',
      physicalIdentityDigest: await physicalIdentityDigest(absolute, 'file', true),
      bytesDigest
    }));
  }
  for (const relativePath of PROTECTED_DIRECTORIES) {
    const absolute = path.join(repoRoot, ...relativePath.split('/'));
    entries.push(Object.freeze({
      pathDigest: CodexDevelopmentVerificationDigest(relativePath),
      kind: 'directory',
      physicalIdentityDigest: await physicalIdentityDigest(absolute, 'directory'),
      bytesDigest: null
    }));
  }
  entries.sort((left, right) => left.pathDigest.localeCompare(right.pathDigest));
  return Object.freeze({
    entryCount: entries.length,
    digest: CodexDevelopmentVerificationDigest({
      domain: 'sm3-r4-protected-authority-ledger-v1',
      entries
    })
  });
}

async function executableIdentityDigest(): Promise<string> {
  const executables = workPackageProfileProbeExecutablePaths();
  const [identities, bytesDigests] = await Promise.all([
    Promise.all([
    physicalIdentityDigest(executables.powershell, 'file'),
    physicalIdentityDigest(executables.reg, 'file')
    ]),
    Promise.all([fileDigest(executables.powershell), fileDigest(executables.reg)])
  ]);
  return CodexDevelopmentVerificationDigest({
    domain: 'sm3-r4-profile-probe-executables-v1',
    powershell: Object.freeze({ identity: identities[0], bytes: bytesDigests[0] }),
    reg: Object.freeze({ identity: identities[1], bytes: bytesDigests[1] })
  });
}

function withDigest<T extends Record<string, unknown>, K extends string>(
  value: T,
  key: K,
  domain: string
): T & Record<K, string> {
  return Object.freeze({
    ...value,
    [key]: CodexDevelopmentVerificationDigest({ domain, ...value })
  }) as T & Record<K, string>;
}

export function assertDiagnosticAttemptAvailable(evidenceExists: boolean): void {
  if (evidenceExists) throw new Error('R4 profile probe authority is already consumed');
}

export function assertPersistableProfileDiagnostic(
  diagnostic: WorkPackageProfileProbeDiagnosticV1
): void {
  const serialized = JSON.stringify(diagnostic);
  if (diagnostic.attempted !== true || diagnostic.outcome === null ||
    diagnostic.invocationDigest === null || diagnostic.executableIdentityDigests === null ||
    diagnostic.budget === null) {
    throw new Error('R4 profile diagnostic is incomplete');
  }
  if (!diagnostic.outcome.termination.treeClosed || !diagnostic.outcome.termination.streamsDrained) {
    throw new Error('R4 profile diagnostic process tree is not closed');
  }
  for (const forbidden of ['sec.sm3.', 'S-1-15-', 'HKCU\\', 'C:\\', 'Error:', ' at ']) {
    if (serialized.includes(forbidden)) throw new Error('R4 profile diagnostic contains raw authority text');
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function consumeDiagnosticAttempt(
  evidencePath: string,
  attempt: DiagnosticAttemptRecordV1
): Promise<DiagnosticAttemptCustody> {
  const serialized = JSON.stringify(attempt);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(evidencePath, 'wx');
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await syncWorkPackageGateDirectory(path.dirname(evidencePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('R4 profile probe authority is already consumed');
    }
    throw error;
  } finally {
    await handle?.close();
  }
  const readback = await readFile(evidencePath, 'utf8');
  if (readback !== serialized) throw new Error('R4 durable attempt readback mismatch');
  return Object.freeze({
    bytesDigest: sha256(Buffer.from(readback, 'utf8')),
    physicalIdentityDigest: await physicalIdentityDigest(evidencePath, 'file', true)
  });
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`R4 requires ${name}`);
  return value;
}

async function sourceAuthoritySnapshot(repoRoot: string, manifestPath: string): Promise<Readonly<{
  manifestDigest: string;
  sourceDigests: DiagnosticAttemptRecordV1['sourceDigests'];
  sourceBlobIds: DiagnosticAttemptRecordV1['sourceBlobIds'];
  digest: string;
}>> {
  const manifestDigest = await fileDigest(manifestPath);
  const sourceDigests = Object.freeze({
    runner: await fileDigest(path.join(repoRoot, 'scripts', 'run-work-package-gate.ts')),
    profileProbe: await fileDigest(path.join(repoRoot, 'scripts', 'work-package-profile-probe.ts')),
    diagnosticScript: await fileDigest(path.join(
      repoRoot,
      'scripts',
      'diagnose-work-package-profile-probe.ts'
    )),
    syntheticTest: await fileDigest(path.join(
      repoRoot,
      'tests',
      'unit',
      'work-package-profile-probe-diagnostic.test.ts'
    )),
    observedProcess: await fileDigest(path.join(repoRoot, 'platform', 'shared', 'observed-process.ts')),
    r3StopEvidence: await fileDigest(path.join(
      repoRoot,
      'docs',
      'evidence',
      'v0-4-semantic-mutation-apply-r3-v4-verification.json'
    ))
  });
  const sourceBlobIds = Object.freeze({
    runner: gitBlobId(repoRoot, 'scripts/run-work-package-gate.ts'),
    contract: gitBlobId(repoRoot, 'scripts/work-package-gate-contract.ts'),
    contractTest: gitBlobId(repoRoot, 'tests/unit/work-package-gate-contract.test.ts'),
    executionTest: gitBlobId(repoRoot, 'tests/unit/work-package-gate-execution.test.ts')
  });
  if (sourceDigests.runner !==
      'sha256:d9a96218ca671a6bcd6ef94d2b881361b040b6aca49e5156dd28b92df0cda6c0' ||
    sourceDigests.observedProcess !==
      'sha256:3bd94b7d245505aea7ede73535e63491893dc6038aa19d057e3d76db2265257c' ||
    sourceDigests.r3StopEvidence !==
      'sha256:a035318656987a61a8adcc703c40b53826c74c5c5512573359c7248067da6492' ||
    JSON.stringify(sourceBlobIds) !== JSON.stringify({
      runner: '89148de99abd1b09694b4f5502c8115e21269363',
      contract: '903d0036c90a5426194c284162cb5a3499cb43a1',
      contractTest: 'b609385f9a02d04e88715503c1560e9dbc347dcb',
      executionTest: '379cddbed50786fb7766a61ee1ffaba953724685'
    })) {
    throw new Error('R4 frozen source authority changed');
  }
  return Object.freeze({
    manifestDigest,
    sourceDigests,
    sourceBlobIds,
    digest: CodexDevelopmentVerificationDigest({
      domain: 'sm3-r4-source-authority-v1',
      manifestDigest,
      sourceDigests,
      sourceBlobIds
    })
  });
}

async function assertDiagnosticAuthorityUnchanged(options: Readonly<{
  evidencePath: string;
  attemptCustody: DiagnosticAttemptCustody;
  repoRoot: string;
  manifestPath: string;
  sourceAuthorityDigest: string;
  protectedAuthority: ProtectedAuthoritySnapshot;
  executableIdentityDigest: string;
  headSha: string;
  treeSha: string;
}>): Promise<Readonly<{
  protectedAuthority: ProtectedAuthoritySnapshot;
  executableIdentityDigest: string;
}>> {
  const readback = await readFile(options.evidencePath);
  if (sha256(readback) !== options.attemptCustody.bytesDigest ||
    await physicalIdentityDigest(options.evidencePath, 'file', true) !==
      options.attemptCustody.physicalIdentityDigest) {
    throw new Error('R4 durable attempt authority changed');
  }
  const currentSources = await sourceAuthoritySnapshot(options.repoRoot, options.manifestPath);
  if (currentSources.digest !== options.sourceAuthorityDigest) {
    throw new Error('R4 source authority changed');
  }
  const [currentProtected, currentExecutable] = await Promise.all([
    protectedAuthoritySnapshot(options.repoRoot),
    executableIdentityDigest()
  ]);
  if (currentProtected.digest !== options.protectedAuthority.digest ||
    currentProtected.entryCount !== options.protectedAuthority.entryCount ||
    currentExecutable !== options.executableIdentityDigest) {
    throw new Error('R4 protected authority changed');
  }
  if (gitRevision(options.repoRoot, 'HEAD') !== options.headSha ||
    gitRevision(options.repoRoot, 'HEAD^{tree}') !== options.treeSha) {
    throw new Error('R4 repository authority changed');
  }
  return Object.freeze({
    protectedAuthority: currentProtected,
    executableIdentityDigest: currentExecutable
  });
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dir, '..');
  const manifestRelative = argument('--manifest').replaceAll('\\', '/');
  const evidenceRelative = argument('--evidence').replaceAll('\\', '/');
  const timeoutMs = Number(argument('--timeout-ms'));
  if (manifestRelative !== 'docs/work-packages/sm3-r4-profile-probe-diagnosis-v1.md' ||
    evidenceRelative !== 'docs/evidence/v0-4-semantic-mutation-profile-probe-r4-diagnosis.json' ||
    timeoutMs !== EXPECTED_TIMEOUT_MS) {
    throw new Error('R4 invocation does not match frozen authority');
  }
  const manifestPath = path.join(repoRoot, ...manifestRelative.split('/'));
  const evidencePath = path.join(repoRoot, ...evidenceRelative.split('/'));
  assertDiagnosticAttemptAvailable(await pathExists(evidencePath));

  const headSha = gitRevision(repoRoot, 'HEAD');
  const treeSha = gitRevision(repoRoot, 'HEAD^{tree}');
  if (headSha !== EXPECTED_HEAD || treeSha !== EXPECTED_TREE) {
    throw new Error('R4 repository authority changed');
  }
  const sourceAuthority = await sourceAuthoritySnapshot(repoRoot, manifestPath);
  const protectedAuthority = await protectedAuthoritySnapshot(repoRoot);
  const executableBefore = await executableIdentityDigest();
  const attemptBase = {
    schema: 'sm3-r4-profile-probe-diagnosis-v1' as const,
    recordType: 'profile-probe-diagnostic' as const,
    status: 'attempted' as const,
    probeAttempted: true as const,
    recordedAt: new Date().toISOString(),
    headSha,
    treeSha,
    worktreeDigest: await workPackageWorktreeDigestForTests(repoRoot),
    manifestDigest: sourceAuthority.manifestDigest,
    sourceDigests: sourceAuthority.sourceDigests,
    sourceBlobIds: sourceAuthority.sourceBlobIds,
    protectedAuthority,
    executableIdentityDigest: executableBefore,
    timeoutMs
  };
  const attempt = withDigest(
    attemptBase,
    'attemptRecordDigest',
    'sm3-r4-profile-probe-attempt-v1'
  ) as DiagnosticAttemptRecordV1;
  const attemptCustody = await consumeDiagnosticAttempt(evidencePath, attempt);

  const deadlineAtMs = performance.now() + timeoutMs;
  let authorityValidatedBeforeSpawn = false;
  const result = await runWorkPackageProfileProbe(deadlineAtMs, {
    beforeSpawn: async () => {
      await assertDiagnosticAuthorityUnchanged({
        evidencePath,
        attemptCustody,
        repoRoot,
        manifestPath,
        sourceAuthorityDigest: sourceAuthority.digest,
        protectedAuthority,
        executableIdentityDigest: executableBefore,
        headSha,
        treeSha
      });
      authorityValidatedBeforeSpawn = true;
    }
  });
  if (!authorityValidatedBeforeSpawn) {
    throw new Error('R4 profile spawn was blocked by authority revalidation');
  }
  assertPersistableProfileDiagnostic(result.diagnostic);
  const finalAuthority = await assertDiagnosticAuthorityUnchanged({
    evidencePath,
    attemptCustody,
    repoRoot,
    manifestPath,
    sourceAuthorityDigest: sourceAuthority.digest,
    protectedAuthority,
    executableIdentityDigest: executableBefore,
    headSha,
    treeSha
  });
  const protectedAuthorityAfter = finalAuthority.protectedAuthority;
  const executableAfter = finalAuthority.executableIdentityDigest;
  const finalBase = {
    ...attempt,
    status: 'complete' as const,
    completedAt: new Date().toISOString(),
    v4Projection: result.projectedProbe,
    diagnostic: result.diagnostic,
    protectedAuthorityAfter,
    executableIdentityDigestAfter: executableAfter
  };
  const final = withDigest(
    finalBase,
    'evidenceDigest',
    'sm3-r4-profile-probe-evidence-v1'
  ) as DiagnosticFinalRecordV1;
  await writeWorkPackageGateJsonAtomic(evidencePath, final);
  process.stdout.write(`${result.diagnostic.classification}\n`);
}

if (import.meta.main) {
  await main();
}

export const workPackageProfileProbeEmptyDigestForTests = EMPTY_SHA256;
