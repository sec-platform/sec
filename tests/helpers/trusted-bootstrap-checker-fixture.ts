import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { materializeTrustedBootstrapCheckerProgram } from '../../src/adapters/verification/platform/trust/runtime/trusted-bootstrap-checker-program.ts';
import { compilerRoot } from '../../src/adapters/workspace-context.ts';

export const TRUSTED_CHECKER_NATIVE = 'src/adapters/verification/platform/trust/runtime/trusted-bootstrap-checker-native.ts';

const PROGRAM_CHECK = "if (import.meta.path !== expected) throw new Error('Trusted bootstrap executable is not the PRE checker artifact.');";
const PROGRAM_EXPECTED = "const expected = path.join(facts.evidenceRoot, 'checker.mjs');";

export const TRUSTED_CHECKER_HOSTILE_MUTATIONS = Object.freeze([
  { name: 'a second native path read', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: `${PROGRAM_CHECK}\n      void import.meta.path;` },
  { name: 'source-relative dir', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: PROGRAM_CHECK.replace('import.meta.path', 'import.meta.dir') },
  { name: 'source-relative url', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: PROGRAM_CHECK.replace('import.meta.path', 'import.meta.url') },
  { name: 'source-relative resolve', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: PROGRAM_CHECK.replace('import.meta.path', 'import.meta.resolve("./resource")') },
  { name: 'computed path access', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: `${PROGRAM_CHECK}\n      void import.meta['path'];` },
  { name: 'an aliased meta object', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: `${PROGRAM_CHECK}\n      const meta = import.meta; void meta;` },
  { name: 'a shadowed expected binding', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: `{ const expected = '/wrong/checker.mjs'; ${PROGRAM_CHECK} }` },
  { name: 'the wrong artifact slot', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_EXPECTED, after: PROGRAM_EXPECTED.replace("'checker.mjs'", "'other.mjs'") },
  { name: 'a missing identity check', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK, after: 'void expected;' },
  { name: 'a decoy same-named method', source: TRUSTED_CHECKER_NATIVE,
    before: PROGRAM_CHECK,
    after: `const decoy = { checkerProgramBytes() { requireOpen(); ${PROGRAM_EXPECTED} ${PROGRAM_CHECK} } }; void decoy;` },
  { name: 'a computed method replacement', source: TRUSTED_CHECKER_NATIVE,
    before: '    gitBlob(root:', after: "    ['checkerProgramBytes']() { return new Uint8Array(); },\n    gitBlob(root:" },
  { name: 'an ordinary imported module path read', source: 'src/application/trusted-bootstrap-verification.ts',
    before: "const parseJson =", after: 'void import.meta.path;\nconst parseJson =' },
  { name: 'an ordinary imported resource URL', source: 'src/application/trusted-bootstrap-verification.ts',
    before: "const parseJson =", after: 'void new URL("./resource", import.meta.url);\nconst parseJson =' }
]);

export async function mutateTrustedCheckerSource(trustedRoot: string,
  mutation: typeof TRUSTED_CHECKER_HOSTILE_MUTATIONS[number]): Promise<void> {
  const sourcePath = path.join(trustedRoot, mutation.source);
  const source = await readFile(sourcePath, 'utf8');
  if (source.split(mutation.before).length !== 2) throw new Error('Checker mutation preimage is not unique.');
  await writeFile(sourcePath, source.replace(mutation.before, mutation.after));
}

const SOURCE_ENVIRONMENT_KEYS = [
  'TRUSTED_BASE_ROOT', 'CANDIDATE_ROOT', 'BOOTSTRAP_EVIDENCE_ROOT',
  'SEC_BOOTSTRAP_BASE', 'SEC_BOOTSTRAP_BASE_TREE', 'SEC_BOOTSTRAP_HEAD',
  'SEC_BOOTSTRAP_TREE', 'SEC_BOOTSTRAP_REGISTRY_DIGEST'
] as const;

let fixtureActive = false;

function fixtureGit(root: string, args: readonly string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, env: {
      PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Checker fixture', GIT_AUTHOR_EMAIL: 'checker@example.invalid',
      GIT_COMMITTER_NAME: 'Checker fixture', GIT_COMMITTER_EMAIL: 'checker@example.invalid'
    }
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Checker fixture Git ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

/** Independent runtime-tool observation, not a PRE/POST checker execution or
 * proof that an arbitrary host preserves loaded bytes against later writers. */
export async function observeBundledCheckerIdentityFixture(): Promise<Readonly<{
  artifactPath: string; sourcePath: string; bundleBytes: Uint8Array;
  observedPath: unknown; observedDigest: unknown;
}>> {
  let root = await mkdtemp(path.join(tmpdir(), 'sec-checker-identity-'));
  try {
    root = await realpath(root);
    const sourcePath = path.join(root, 'native.ts');
    const entry = path.join(root, 'entry.ts');
    const artifactPath = path.join(root, 'checker.mjs');
    await writeFile(sourcePath, `import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export function observe() {
  return { path: import.meta.path,
    digest: createHash('sha256').update(readFileSync(import.meta.path)).digest('hex') };
}
`);
    await writeFile(entry, `import { observe } from './native.ts';
process.argv[1] = '/caller-controlled/not-the-artifact.mjs';
process.stdout.write(JSON.stringify(observe()));
`);
    const build = await Bun.build({ entrypoints: [entry], target: 'bun', format: 'esm',
      splitting: false, minify: false, sourcemap: 'none' });
    if (!build.success || build.outputs.length !== 1) throw new Error('Checker identity fixture did not bundle.');
    const bundleBytes = new Uint8Array(await build.outputs[0]!.arrayBuffer());
    await writeFile(artifactPath, bundleBytes, { flag: 'wx' });
    const result = spawnSync(process.execPath, ['--no-env-file', artifactPath], {
      cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH }
    });
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(`Checker identity fixture failed: ${result.error?.message ?? result.stderr}`);
    }
    const observed: { path?: unknown; digest?: unknown } = JSON.parse(result.stdout);
    return Object.freeze({ artifactPath, sourcePath, bundleBytes,
      observedPath: observed.path, observedDigest: observed.digest });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Build only: fixture Git establishes real clean source identities. No checker
 * entry, PRE/POST stage, candidate program or hosted process is executed. */
export async function withTrustedBootstrapCheckerFixture<T>(
  mutate: ((trustedRoot: string) => Promise<void>) | null,
  inspect: (fixture: Readonly<{
    root: string; trustedRoot: string; evidenceRoot: string; sourceTree: string;
    materialize: () => ReturnType<typeof materializeTrustedBootstrapCheckerProgram>;
  }>) => Promise<T>
): Promise<T> {
  if (fixtureActive) throw new Error('Checker build fixture requires serial process-local ownership.');
  fixtureActive = true;
  const cwd = process.cwd();
  const prior = SOURCE_ENVIRONMENT_KEYS.map(key => [key, process.env[key]] as const);
  let root: string | null = null;
  try {
    root = await mkdtemp(path.join(tmpdir(), 'sec-checker-build-'));
    root = await realpath(root);
    const trustedRoot = path.join(root, 'base');
    const candidateRoot = path.join(root, 'candidate');
    const evidenceRoot = path.join(root, 'evidence');
    await mkdir(trustedRoot);
    await mkdir(evidenceRoot);
    // Bun's actual onLoad/metafile census remains authoritative. Copying the
    // source tree does not substitute a second import/closure scanner.
    await cp(path.join(compilerRoot, 'src'), path.join(trustedRoot, 'src'), { recursive: true });
    if (mutate !== null) await mutate(trustedRoot);
    fixtureGit(trustedRoot, ['init', '--quiet']);
    fixtureGit(trustedRoot, ['add', 'src']);
    fixtureGit(trustedRoot, ['commit', '--quiet', '-m', 'Trusted checker fixture source']);
    const base = fixtureGit(trustedRoot, ['rev-parse', 'HEAD']);
    const sourceTree = fixtureGit(trustedRoot, ['rev-parse', 'HEAD^{tree}']);
    fixtureGit(root, ['clone', '--quiet', '--no-hardlinks', trustedRoot, candidateRoot]);
    fixtureGit(candidateRoot, ['commit', '--quiet', '--allow-empty', '-m', 'Candidate data fixture']);
    Object.assign(process.env, {
      TRUSTED_BASE_ROOT: trustedRoot, CANDIDATE_ROOT: candidateRoot,
      BOOTSTRAP_EVIDENCE_ROOT: evidenceRoot, SEC_BOOTSTRAP_BASE: base,
      SEC_BOOTSTRAP_BASE_TREE: sourceTree,
      SEC_BOOTSTRAP_HEAD: fixtureGit(candidateRoot, ['rev-parse', 'HEAD']),
      SEC_BOOTSTRAP_TREE: fixtureGit(candidateRoot, ['rev-parse', 'HEAD^{tree}']),
      // Materialization validates shape only; this fixture issues no receipt.
      SEC_BOOTSTRAP_REGISTRY_DIGEST: `sha256:${'0'.repeat(64)}`
    });
    process.chdir(trustedRoot);
    return await inspect(Object.freeze({ root, trustedRoot, evidenceRoot, sourceTree,
      materialize: () => materializeTrustedBootstrapCheckerProgram(path.join(evidenceRoot, 'checker.mjs')) }));
  } finally {
    process.chdir(cwd);
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { if (root !== null) await rm(root, { recursive: true, force: true }); }
    finally { fixtureActive = false; }
  }
}
