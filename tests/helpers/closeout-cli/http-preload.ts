/** Child-only provider fixture. Every request is handled locally; no network fallback exists. */
import { mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GITHUB_PRINCIPAL_NODE_QUERY } from '../../../src/adapters/providers/github-api/verification-queries.ts';
import { observeCloseoutFixtureWork } from './work-observation.ts';

const require = createRequire(import.meta.url);
const { ZipFile } = require('yazl');
const statePath = process.env.SEC_CLOSEOUT_TEST_STATE;
if (!statePath) throw new Error('Closeout HTTP fixture requires its state path');
const token = 'ghp_closeout_fixture_token_000000000000';
const read = (): Record<string, any> => JSON.parse(readFileSync(statePath, 'utf8'));
const save = (state: Record<string, any>) => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' }
});
const archives = new Map<string, Promise<Buffer>>();
function archive(state: Record<string, any>, id: string): Promise<Buffer> {
  const record = state.artifactDetails[id];
  const files = state.artifactFiles[record?.name];
  if (!files) throw new Error(`No artifact files for fixture id ${id}`);
  const key = JSON.stringify(files);
  let result = archives.get(key);
  if (result === undefined) {
    result = new Promise<Buffer>((resolve, reject) => {
      const zip = new ZipFile();
      const chunks: Buffer[] = [];
      let length = 0;
      zip.on('error', reject);
      zip.outputStream.on('error', reject);
      zip.outputStream.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 32 * 1024 * 1024) {
          zip.outputStream.destroy(new Error('Fixture ZIP exceeds archive limit'));
          return;
        }
        chunks.push(chunk);
      });
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks, length)));
      const entries = Object.entries(files);
      if (entries.length > 16) throw new Error('Fixture ZIP member limit exceeded');
      for (const [name, text] of entries) {
        const bytes = Buffer.from(String(text));
        if (bytes.length > 10 * 1024 * 1024) throw new Error('Fixture member exceeds limit');
        zip.addBuffer(bytes, name, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644 });
      }
      zip.end();
    });
    archives.set(key, result);
  }
  return result;
}
async function metadata(state: Record<string, any>, id: string) {
  const record = state.artifactDetails[id];
  if (!record) throw new Error(`Unknown fixture artifact ${id}`);
  // An unrelated stable artifact has metadata but is never downloaded by these cases.
  if (!state.artifactFiles[record.name]) return record;
  const bytes = await archive(state, id);
  return { ...record, size_in_bytes: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

globalThis.fetch = (async (target: string | URL | Request, init?: RequestInit) => {
  const url = new URL(target instanceof Request ? target.url : String(target));
  const method = init?.method ?? (target instanceof Request ? target.method : 'GET');
  const headers = new Headers(init?.headers ?? (target instanceof Request ? target.headers : undefined));
  const state = read();
  if (url.origin === 'https://results-receiver.actions.githubusercontent.com') {
    if (method !== 'GET' || !/^\/closeout-fixture\/[1-9][0-9]*$/u.test(url.pathname)
        || url.search !== '?fixture=1' || headers.has('authorization') || headers.has('cookie')
        || init?.credentials !== 'omit' || init.redirect !== 'error') {
      throw new Error('Artifact second-hop fixture contract violated');
    }
    state.httpArtifactDownloadCount = Number(state.httpArtifactDownloadCount ?? 0) + 1;
    save(state);
    return new Response(await archive(state, url.pathname.split('/').at(-1)!));
  }
  if (url.origin !== 'https://api.github.com' || url.username || url.password || url.hash
      || headers.get('authorization') !== `Bearer ${token}`) {
    throw new Error('Unexpected closeout HTTP target or credential');
  }
  const repo = `/repos/${state.repository}`;
  const endpoint = url.pathname;
  const query = url.searchParams;
  const paged = (extra: readonly string[] = []) => {
    if ([...query.keys()].some(key => !['per_page', 'page', ...extra].includes(key))
        || query.get('per_page') !== '100' || query.get('page') !== '1') {
      throw new Error('Unexpected fixture pagination');
    }
  };
  if (method === 'POST' && endpoint === '/graphql' && !url.search) {
    const body = JSON.parse(String(init?.body));
    if (body.query !== GITHUB_PRINCIPAL_NODE_QUERY || Object.keys(body.variables).join() !== 'id') {
      throw new Error('Unexpected fixture GraphQL operation');
    }
    const principal = Object.entries(state.principals).find(([, value]) =>
      (value as { nodeId: string }).nodeId === body.variables.id);
    if (!principal) throw new Error('Unknown fixture principal node');
    return json({ data: { node: { id: body.variables.id, login: principal[0] } } });
  }
  if (method !== 'GET') throw new Error('Unexpected fixture HTTP method');
  state.httpReadCount = Number(state.httpReadCount ?? 0) + 1;
  save(state);
  if (endpoint === repo && !url.search) return json({ id: Number(state.repositoryId),
    node_id: 'FIXTURE_REPOSITORY', full_name: state.repository, default_branch: 'main', delete_branch_on_merge: true });
  if (endpoint === '/user' && !url.search) return json({ login: 'integrator', node_id: 'INTEGRATOR', id: 501 });
  let match = /^\/users\/([^/]+)$/u.exec(endpoint);
  if (match && !url.search) {
    const login = decodeURIComponent(match[1]!);
    const principal = state.principals[login];
    if (!principal) throw new Error('Unknown fixture user');
    state.principalUserLookups.push(login); save(state);
    return json({ login, node_id: principal.nodeId });
  }
  if (!endpoint.startsWith(`${repo}/`)) throw new Error('Unexpected fixture repository');
  const relative = endpoint.slice(repo.length);
  match = /^\/collaborators\/([^/]+)\/permission$/u.exec(relative);
  if (match && !url.search) {
    const login = decodeURIComponent(match[1]!);
    const principal = state.principals[login];
    if (!principal) throw new Error('Unknown fixture collaborator');
    state.principalPermissionLookups.push(login); save(state);
    return json({ permission: principal.permission });
  }
  if (relative === '/pulls/42' && !url.search) return json({ number: 42, state: 'closed', merged: true,
    draft: false, user: { node_id: 'AUTHOR' }, title: 'Legacy marker-bound closeout candidate', body: '',
    head: { ref: state.branch, sha: state.headSha, repo: { full_name: state.repository } },
    base: { ref: 'main', sha: state.baseSha, repo: { full_name: state.repository } },
    merge_commit_sha: state.mergeCommitSha });
  if (relative === '/contents/src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts'
      && [...query.keys()].join() === 'ref' && [state.baseSha, state.mergeCommitSha].includes(query.get('ref'))) {
    return json({ message: 'Not found' }, 404);
  }
  if (relative === '/pulls') {
    paged(['state', 'sort', 'direction']);
    if (query.get('state') !== 'open' || query.get('sort') !== 'created' || query.get('direction') !== 'asc') {
      throw new Error('Unexpected fixture pull census');
    }
    return json(state.inventoryPrState === 'OPEN' ? [{ number: 42, state: 'open',
      head: { sha: state.headSha }, base: { ref: 'main' } }] : []);
  }
  match = /^\/git\/commits\/([0-9a-f]{40})$/u.exec(relative);
  if (match && !url.search) {
    const sha = match[1];
    if (![state.baseSha, state.headSha, state.mergeCommitSha].includes(sha)) throw new Error('Unknown fixture commit');
    return json({ sha, tree: { sha: sha === state.baseSha ? state.baseTreeSha : state.headTreeSha },
      message: sha === state.mergeCommitSha ? state.mergeMessage : '', parents: [{ sha: state.baseSha }] });
  }
  if (/^\/compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/u.test(relative) && !url.search) {
    const key = relative.slice('/compare/'.length);
    // The fixture declares ancestry independently of the requested pair. A
    // missing relation is never inferred from whichever SHAs a caller supplies.
    if (!Object.hasOwn(state.comparisonObservations ?? {}, key)) {
      throw new Error('Unmodeled fixture ancestry relation');
    }
    return json(state.comparisonObservations[key]);
  }
  if (relative === '/actions/runs') {
    paged(['head_sha']);
    if (query.get('head_sha') !== state.baseSha) throw new Error('Unexpected fixture run head');
    const current = state.runs['200'];
    return json({ total_count: 1, workflow_runs: [{ ...current,
      name: 'integrate compiler session run 100 attempt 1', display_title: 'integrate compiler session run 100 attempt 1',
      status: 'in_progress', conclusion: null, updated_at: '2026-08-09T14:05:00.000Z' }] });
  }
  match = /^\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)\/jobs$/u.exec(relative);
  if (match) {
    paged();
    const [, runId, attempt] = match;
    const isCurrent = Number(attempt) === Number(state.runs[runId!].run_attempt);
    const order = ['recoveryPreparation', 'integration', 'closeoutMutation', 'closeoutPublication'];
    const currentIndex = order.indexOf(state.currentPhase);
    const steps = order.map((phase, index) => ({ name: state.phaseStepNames[phase], number: index + 1,
      status: index < currentIndex || !isCurrent ? 'completed' : index === currentIndex ? 'in_progress' : 'queued',
      conclusion: index < currentIndex ? 'success' : !isCurrent ? 'skipped' : null,
      started_at: index < currentIndex ? '2026-08-09T14:00:00.000Z'
        : isCurrent && index === currentIndex ? '2026-08-09T14:05:00.000Z' : null,
      completed_at: index < currentIndex || !isCurrent ? '2026-08-09T14:04:00.000Z' : null }));
    return json({ total_count: 1, jobs: [{ id: 300 + Number(attempt), run_id: Number(runId), run_attempt: Number(attempt),
      name: 'integrate', status: isCurrent ? 'in_progress' : 'completed', conclusion: isCurrent ? null : 'success',
      head_sha: state.baseSha, started_at: '2026-08-09T14:00:00.000Z', completed_at: null, steps }] });
  }
  match = /^\/actions\/runs\/([1-9][0-9]*)\/artifacts$/u.exec(relative);
  if (match) {
    paged();
    const records = state.artifactsByRun[match[1]!] ?? [];
    return json({ total_count: records.length, artifacts: await Promise.all(records.map((record: { id: number }) => metadata(state, String(record.id)))) });
  }
  match = /^\/actions\/runs\/([1-9][0-9]*)(?:\/attempts\/([1-9][0-9]*))?$/u.exec(relative);
  if (match && !url.search) {
    const record = state.runs[match[1]!];
    if (!record || (match[2] !== undefined && Number(match[2]) > record.run_attempt)) return json({ message: 'Not found' }, 404);
    return json({ ...record, run_attempt: match[2] === undefined ? record.run_attempt : Number(match[2])
      + (state.historicalAttemptMismatch && match[1] === '200' ? 1 : 0) });
  }
  match = /^\/actions\/artifacts\/([1-9][0-9]*)(\/zip)?$/u.exec(relative);
  if (match && !url.search) {
    if (!match[2]) return json(await metadata(state, match[1]!));
    if (init?.redirect !== 'manual') throw new Error('Artifact first hop must be manual');
    return new Response(null, { status: 302, headers: {
      location: `https://results-receiver.actions.githubusercontent.com/closeout-fixture/${match[1]}?fixture=1`
    } });
  }
  if (relative === '/issues/42/comments') { paged(); return json(state.comments); }
  match = /^\/issues\/comments\/([1-9][0-9]*)$/u.exec(relative);
  if (match && !url.search) {
    const comment = state.comments.find((entry: { id: number }) => entry.id === Number(match![1]));
    return comment ? json(comment) : json({ message: 'Not found' }, 404);
  }
  throw new Error(`Unsupported closeout fixture HTTP read: ${endpoint}`);
}) as typeof fetch;

// Replace only the Work producer in this child. Keep the real public CLI and
// closeout consumers, including opaque observation and active/invalid checks.
const workOwnerPath = '../../../src/adapters/self-hosting/control/documentation/document-control-plane.ts';
const workOwner = await import(workOwnerPath);
mock.module(workOwnerPath, () => ({
  ...workOwner,
  observeActiveWorkPackage: async (repositoryRoot: string) => observeCloseoutFixtureWork(repositoryRoot)
}));
