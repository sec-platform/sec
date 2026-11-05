import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Preserve the Git tree, loose worktree bytes, index and branch ref while
// replacing add + commit + rev-parse with fast-import + read-tree.
// Every caller must supply its own newly initialized repository.
function fastImportPath(repositoryPath: string): string {
  const escaped = [...Buffer.from(repositoryPath, 'utf8')].map((byte) => {
    if (byte === 34) return '\\"';
    if (byte === 92) return '\\\\';
    if (byte < 32 || byte >= 127) return `\\${byte.toString(8).padStart(3, '0')}`;
    return String.fromCharCode(byte);
  }).join('');
  return `"${escaped}"`;
}

export function commitTestImpactFixtureSources(
  repositoryRoot: string,
  sources: Readonly<Record<string, string>>,
  environment: NodeJS.ProcessEnv,
  identity: Readonly<{ name: string; email: string }>
): string {
  const head = readFileSync(path.join(repositoryRoot, '.git', 'HEAD'), 'utf8').trim();
  const match = /^ref: (refs\/heads\/[A-Za-z0-9._/-]+)$/u.exec(head);
  if (match === null) throw new Error('TestImpact fixture requires a newly initialized symbolic Git HEAD.');
  const message = 'test-impact-fixture';
  const records: Buffer[] = [];
  const append = (value: string): void => { records.push(Buffer.from(value, 'utf8')); };
  append(`commit ${match[1]}\nmark :1\n`);
  append(`author ${identity.name} <${identity.email}> 0 +0000\n`);
  append(`committer ${identity.name} <${identity.email}> 0 +0000\n`);
  append(`data ${Buffer.byteLength(message, 'utf8')}\n${message}\n`);
  for (const [repositoryPath, source] of Object.entries(sources)) {
    append(`M 100644 inline ${fastImportPath(repositoryPath)}\n`);
    append(`data ${Buffer.byteLength(source, 'utf8')}\n`);
    append(source);
    append('\n');
  }
  append('get-mark :1\n');
  const run = (args: readonly string[], input?: Buffer): string => {
    const result = spawnSync('git', [...args], {
      cwd: repositoryRoot,
      env: environment,
      input,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(`TestImpact Git fixture ${args[0]} failed: ${result.stderr || result.error}`);
    }
    return result.stdout.trim();
  };
  const commitSha = run(['fast-import', '--quiet'], Buffer.concat(records));
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commitSha)) {
    throw new Error('TestImpact fast-import failed to return an exact commit object ID.');
  }
  // fast-import updates HEAD and the object database but not the index.
  // Read the committed tree into this fixture's own index; the caller already
  // wrote identical loose files, so no checkout or shared mutable seed occurs.
  run(['read-tree', 'HEAD']);
  return commitSha;
}
