import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prepareBranchCloseout, rehydratePreparedBranchCloseoutRecoveryArtifact } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { HOSTED_INTEGRATION_PHASE_STEP_NAMES } from '../../../src/adapters/self-hosting/control/integration/integration-authorization-publication.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../src/adapters/verification/platform/action/contract/provider.ts';
import { compileTcbClosureIdentity } from '../../../src/adapters/verification/platform/trust/compiler.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../../src/adapters/verification/platform/trust/contract/root.ts';
import { observeCloseoutFixtureWork } from './work-observation.ts';

export type CloseoutCliHarnessState = Record<string, any> & {
  activeWorkPackageSelected: boolean;
};

export function readCloseoutCliHarnessState(statePath: string): CloseoutCliHarnessState {
  return JSON.parse(readFileSync(statePath, 'utf8')) as CloseoutCliHarnessState;
}

export function writeCloseoutCliHarnessState(statePath: string, state: CloseoutCliHarnessState): void {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function compileCloseoutCliProviderShims(root: string, runtimeCommand: string): string {
  const shimRoot = path.join(root, 'provider-shims');
  mkdirSync(shimRoot, { recursive: true });
  const gitProgram = path.join(shimRoot, 'git-shim.ts');
  const ghProgram = path.join(shimRoot, 'gh-shim.ts');
  writeFileSync(gitProgram, `
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const statePath = process.env.SEC_CLOSEOUT_TEST_STATE;
if (!statePath) throw new Error('SEC_CLOSEOUT_TEST_STATE is required');
const read = () => JSON.parse(readFileSync(statePath, 'utf8'));
const save = (value) => writeFileSync(statePath, JSON.stringify(value, null, 2) + '\\n', 'utf8');
const state = read();
const args = process.argv.slice(2);
const out = (value = '') => { process.stdout.write(String(value)); process.exit(0); };
const fail = (value) => { process.stderr.write(String(value)); process.exit(1); };
const branchRef = 'refs/heads/' + state.branch;
if (args[0] === 'init' && args[1] === '--bare' && args[2] === '.') out('');
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') out(state.repositoryRoot);
if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') out(state.commonDir);
if (JSON.stringify(args) === JSON.stringify(['rev-parse', '--path-format=absolute', '--git-common-dir'])) out(state.commonDir + '\\n');
if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
  state.headReadValues = [...(state.headReadValues || []), state.baseSha];
  save(state);
  out(state.baseSha);
}
if (args[0] === 'rev-parse' && args[1] === 'refs/remotes/origin/main') out(state.localDefaultSha);
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  const ref = args.at(-1);
  if (ref === 'refs/heads/recovery-main^{commit}') out(state.recoveryMainSha);
  if (ref === 'refs/heads/recovery') out(state.headSha);
  if (ref === state.headSha + '^{tree}') out(state.headTreeSha);
  if (ref === state.baseSha + '^{tree}') out(state.baseTreeSha);
  if (ref === state.mergeCommitSha + '^{tree}') out(state.headTreeSha);
  if (ref === state.headSha + '^{commit}') out(state.headSha);
  if (ref === state.baseSha + '^{commit}') out(state.baseSha);
  if (ref === state.mergeCommitSha + '^{commit}') out(state.mergeCommitSha);
  if (ref === 'refs/heads/main' || ref === 'refs/remotes/origin/main') out(state.localDefaultSha);
  if (ref === branchRef || ref === state.headSha) out(state.headSha);
  fail('unsupported fixture verified ref: ' + ref);
}
if (args[0] === 'rev-parse' && args[1] === state.headSha + '^{tree}') out(state.headTreeSha);
if (args[0] === 'rev-parse' && typeof args[1] === 'string' && args[1].includes(':')) {
  const file = args[1].slice(args[1].indexOf(':') + 1);
  out(state.tcbBlobs[file] || state.runtimeBlob);
}
if (args[0] === 'hash-object') {
  const file = args[args.length - 1];
  out(state.tcbBlobs[file] || state.runtimeBlob);
}
if (args[0] === 'branch' && args[1] === '--show-current') out('main');
if (args[0] === 'status') out('');
if (args[0] === '-C' && args.includes('status')) out('');
if (args[0] === 'remote' && args[1] === 'get-url') out('https://github.com/' + state.repository + '.git');
if (args[0] === 'symbolic-ref') out('origin/main');
if (JSON.stringify(args) === JSON.stringify(['for-each-ref', '--stdin', '--count=2', '--format=%(refname)%00%(symref)%00%(objectname)%00'])) {
  const patterns = readFileSync(0, 'utf8');
  if (patterns !== 'refs/[h]eads/' + state.branch + '\\n') fail('unexpected scoped ref patterns');
  state.localRefObservationCount = Number(state.localRefObservationCount || 0) + 1; save(state);
  out(state.localPresent ? branchRef + '\\0\\0' + state.headSha + '\\0\\n' : '');
}
if (JSON.stringify(args) === JSON.stringify(['for-each-ref', '--format=%(refname:short)%00%(objectname)%00', 'refs/heads'])) {
  let value = 'main\\0' + state.baseSha + '\\0\\n';
  if (state.localPresent) value += state.branch + '\\0' + state.headSha + '\\0\\n';
  out(value);
}
if (args[0] === 'ls-remote') fail('plain ls-remote is forbidden');
if (args[0] === '-c'
  && args[1] === 'http.extraHeader='
  && args[2] === '-c'
  && args[3] === 'http.https://github.com/.extraheader='
  && args[4] === '-c'
  && args[5] === 'credential.helper='
  && args[6] === '-c'
  && args[7] === 'credential.helper=!gh auth git-credential'
  && args[8] === 'ls-remote') {
  const inventoryExpected = ['-c', 'http.extraHeader=', '-c',
    'http.https://github.com/.extraheader=', '-c', 'credential.helper=', '-c',
    'credential.helper=!gh auth git-credential', 'ls-remote', '--heads', 'origin'];
  if (JSON.stringify(args) === JSON.stringify(inventoryExpected)) {
    let value = state.liveDefaultSha + '\\trefs/heads/main\\n';
    if (state.remotePresent) value += state.headSha + '\\t' + branchRef + '\\n';
    out(value);
  }
  const requested = args[args.length - 1];
  const expected = ['-c', 'http.extraHeader=', '-c', 'http.https://github.com/.extraheader=',
    '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'ls-remote', '--exit-code', 'origin', requested];
  if (JSON.stringify(args) !== JSON.stringify(expected)) fail('non-canonical remote default readback');
  if (requested === 'refs/heads/main') {
    state.liveDefaultReadCount = Number(state.liveDefaultReadCount || 0) + 1;
    if (state.raceAfterRefOnlyFetch === true && Number(state.refOnlyFetchCount || 0) > 0) {
      state.liveDefaultSha = state.racedDefaultSha;
    }
    save(state);
    out(state.liveDefaultSha + '\\trefs/heads/main\\n');
  }
  if (requested === branchRef) {
    state.credentialBoundBranchReadCount = Number(state.credentialBoundBranchReadCount || 0) + 1;
    save(state);
    if (state.remotePresent) out(state.headSha + '\\t' + branchRef + '\\n');
    process.exit(2);
  }
  fail('unexpected credential-bound remote ref');
}
if (args[0] === 'worktree' && args[1] === 'list') {
  out('worktree ' + state.repositoryRoot + '\\0HEAD ' + state.baseSha + '\\0branch refs/heads/main\\0\\0');
}
if (args.length === 5 && JSON.stringify(args.slice(0, 4)) === JSON.stringify(['config', '--local', '--bool', '--get'])
    && ['fetch.prune', 'remote.origin.prune', 'fetch.pruneTags'].includes(args[4])) out('true');
if (args[0] === 'fetch') fail('plain recovery fetch is forbidden');
if (args[0] === '-c'
  && args[1] === 'http.extraHeader='
  && args[2] === '-c'
  && args[3] === 'http.https://github.com/.extraheader='
  && args[4] === '-c'
  && args[5] === 'credential.helper='
  && args[6] === '-c'
  && args[7] === 'credential.helper=!gh auth git-credential'
  && args[8] === 'fetch') {
  const recoveryExpected = ['-c', 'http.extraHeader=', '-c', 'http.https://github.com/.extraheader=',
    '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'fetch', '--no-tags', 'https://github.com/' + state.repository + '.git',
    '+' + branchRef + ':refs/heads/recovery', '+refs/heads/main:refs/heads/recovery-main'];
  if (JSON.stringify(args) === JSON.stringify(recoveryExpected)) {
    state.recoveryMainSha = state.liveDefaultSha;
    state.recoveryFetchCount = Number(state.recoveryFetchCount || 0) + 1;
    save(state); out('');
  }
  const expected = ['-c', 'http.extraHeader=', '-c', 'http.https://github.com/.extraheader=',
    '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'fetch', '--no-tags', '--no-recurse-submodules', 'origin',
    '+refs/heads/main:refs/remotes/origin/main'];
  if (JSON.stringify(args) !== JSON.stringify(expected)) fail('non-canonical ref-only fetch');
  state.refOnlyFetchCount = Number(state.refOnlyFetchCount || 0) + 1;
  save(state);
  if (state.refOnlyFetchFailure === true) fail('simulated ref-only fetch failure');
  state.localDefaultSha = state.liveDefaultSha;
  save(state);
  out('');
}
if (JSON.stringify(args) === JSON.stringify(['rev-list', '--count', 'refs/heads/recovery', '^refs/heads/recovery-main'])) out('1');
if (args[0] === 'bundle' && args[1] === 'list-heads' && args.length === 3) {
  if (!existsSync(args[2])) fail('fixture bundle missing');
  out(state.headSha + ' refs/heads/recovery');
}
if (args[0] === 'bundle' && args[1] === 'create') {
  if (args.length !== 5 || args[3] !== 'refs/heads/recovery' || args[4] !== '^refs/heads/recovery-main') {
    fail('noncanonical fixture bundle creation');
  }
  mkdirSync(path.dirname(args[2]), { recursive: true });
  writeFileSync(args[2], Buffer.from('canonical V6 recovery bundle bytes'));
  out('');
}
if (args[0] === 'bundle' && args[1] === 'verify') out('verified V6 recovery bundle');
if (args[0] === 'cat-file' && args[1] === '-e') {
  if (String(args[2]).includes('src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts')) fail('missing enforcement marker');
  out('');
}
if (JSON.stringify(args) === JSON.stringify(['update-ref', '--no-deref', '--stdin'])) {
  const transcript = readFileSync(0, 'utf8');
  const expected = 'start\\ndelete ' + branchRef + ' ' + state.headSha + '\\nprepare\\ncommit\\n';
  if (transcript !== expected || !state.localPresent) fail('local CAS preimage/transcript mismatch');
  state.localPresent = false;
  state.localDeleteCount += 1;
  save(state);
  out('start: ok\\nprepare: ok\\ncommit: ok\\n');
}
if (args[0] === '-c'
  && args[1] === 'http.extraHeader='
  && args[2] === '-c'
  && args[3] === 'http.https://github.com/.extraheader='
  && args[4] === '-c'
  && args[5] === 'credential.helper='
  && args[6] === '-c'
  && args[7] === 'credential.helper=!gh auth git-credential'
  && args[8] === 'push'
  && args.includes(':' + branchRef)) {
  const expected = ['-c', 'http.extraHeader=', '-c', 'http.https://github.com/.extraheader=',
    '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'push', '--porcelain', '--force-with-lease=' + branchRef + ':' + state.headSha,
    'origin', ':' + branchRef];
  if (JSON.stringify(args) !== JSON.stringify(expected)) fail('noncanonical remote CAS delete');
  state.remoteDeleteCount += 1;
  state.remotePresent = false;
  const crash = state.crashAfterDelete === true && state.crashInjected !== true;
  if (crash) {
    state.crashInjected = true;
    state.crashShimPid = process.pid;
  }
  save(state);
  if (crash) {
    if (typeof state.crashReleasePath !== 'string' || state.crashReleasePath.length === 0) {
      fail('crashReleasePath is required for the closeout crash barrier');
    }
    while (!existsSync(state.crashReleasePath)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    process.exit(0);
  }
  out('deleted ' + branchRef);
}
if (JSON.stringify(args) === JSON.stringify(['remote', 'prune', 'origin'])) {
  state.pruneCount += 1;
  save(state);
  out('');
}
fail('unsupported test git command: ' + args.join(' '));
`, 'utf8');
  writeFileSync(ghProgram, `
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const statePath = process.env.SEC_CLOSEOUT_TEST_STATE;
if (!statePath) throw new Error('SEC_CLOSEOUT_TEST_STATE is required');
const read = () => JSON.parse(readFileSync(statePath, 'utf8'));
const save = (value) => writeFileSync(statePath, JSON.stringify(value, null, 2) + '\\n', 'utf8');
const state = read();
const args = process.argv.slice(2);
const out = (value) => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0); };
const fail = (value) => { process.stderr.write(String(value)); process.exit(1); };
const endpoint = args.find((arg) => typeof arg === 'string'
  && (arg.startsWith('/repos/') || arg.startsWith('/users/'))) || '';
const run = (id) => state.runs[String(id)];
const actionsComment = (id, body, appMode = 'canonical') => ({
  id,
  body,
  created_at: '2026-08-09T14:05:00.000Z',
  author_association: 'MEMBER',
  user: { login: state.publisher.bot.login, id: state.publisher.bot.id,
    node_id: state.publisher.bot.nodeId, type: state.publisher.bot.type },
  performed_via_github_app: appMode === 'null' ? null : {
    id: appMode === 'wrong' ? state.publisher.app.id + 1 : state.publisher.app.id,
    node_id: state.publisher.app.nodeId,
    slug: state.publisher.app.slug
  }
});
if (args[0] === 'api' && args[1] === 'graphql') {
  const idArgument = args.find((arg) => typeof arg === 'string' && arg.startsWith('id='));
  const nodeId = idArgument?.slice(3) || '';
  const principal = Object.entries(state.principals)
    .find(([, value]) => value.nodeId === nodeId);
  if (!principal) fail('unknown principal node: ' + nodeId);
  out({ data: { node: { id: nodeId, login: principal[0] } } });
}
if (args[0] === 'run' && args[1] === 'download') {
  const name = args[args.indexOf('--name') + 1];
  const directory = args[args.indexOf('--dir') + 1];
  const files = state.artifactFiles[name];
  if (!files) fail('artifact not found: ' + name);
  mkdirSync(directory, { recursive: true });
  for (const [fileName, source] of Object.entries(files)) {
    writeFileSync(path.join(directory, fileName), String(source), 'utf8');
  }
  out('');
}
if (args[0] === 'pr' && args[1] === 'view') {
  state.exactPullRequestReadCount = Number(state.exactPullRequestReadCount || 0) + 1; save(state);
  out({ number: 42, state: 'MERGED', isDraft: false, isCrossRepository: false,
    author: { id: 'AUTHOR' }, baseRefName: 'main', baseRefOid: state.baseSha,
    headRefName: state.branch, headRefOid: state.headSha,
    title: 'Legacy marker-bound closeout candidate', body: '',
    url: 'https://github.com/' + state.repository + '/pull/42',
    mergeCommit: { oid: state.mergeCommitSha }, ...(state.exactPullRequestOverride || {}) });
}
if (args[0] === 'pr' && args[1] === 'list') {
  if (state.listPullRequestOverrides !== undefined) out(state.listPullRequestOverrides);
  out([{ number: 42, headRefName: state.branch, headRefOid: state.headSha,
    baseRefName: 'main', baseRefOid: state.baseSha, state: state.inventoryPrState,
    isDraft: false, isCrossRepository: false, url: 'https://github.com/' + state.repository + '/pull/42' }]);
}
if (endpoint.includes('/contents/src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts')) fail('HTTP 404 Not Found');
if (endpoint === '/repos/' + state.repository && args.includes('.delete_branch_on_merge')) out('true');
if (endpoint === '/repos/' + state.repository) {
  out({ id: Number(state.repositoryId), full_name: state.repository,
    default_branch: 'main', delete_branch_on_merge: true });
}
if (endpoint.startsWith('/repos/' + state.repository + '/collaborators/')) {
  const login = endpoint.split('/').at(-2);
  const principal = state.principals[login];
  if (!principal) fail('unknown collaborator: ' + login);
  state.principalPermissionLookups.push(login);
  save(state);
  out(principal.permission);
}
if (endpoint.startsWith('/users/')) {
  const login = endpoint.split('/').at(-1);
  const principal = state.principals[login];
  if (!principal) fail('unknown user: ' + login);
  state.principalUserLookups.push(login);
  save(state);
  out({ login, node_id: principal.nodeId });
}
if (endpoint === '/repos/' + state.repository + '/git/commits/' + state.baseSha) out(state.baseTreeSha);
if (endpoint === '/repos/' + state.repository + '/git/commits/' + state.headSha) out(state.headTreeSha);
if (endpoint === '/repos/' + state.repository + '/git/commits/' + state.mergeCommitSha) {
  out({ tree: { sha: state.headTreeSha }, message: state.mergeMessage });
}
if (endpoint.startsWith('/repos/' + state.repository + '/compare/')) out({
  status: state.liveDefaultSha === state.mergeCommitSha ? 'identical' : 'ahead',
  ahead_by: state.liveDefaultSha === state.mergeCommitSha ? 0 : 1,
  behind_by: 0,
  base_commit: { sha: state.mergeCommitSha },
  merge_base_commit: { sha: state.mergeCommitSha }
});
if (endpoint.includes('/actions/runs?head_sha=')) {
  const currentRun = run(200);
  out([{ workflow_runs: [{ id: 200,
    name: 'integrate compiler session run 100 attempt 1',
    display_title: 'integrate compiler session run 100 attempt 1',
    path: '.github/workflows/merge-gate.yml', event: 'workflow_run',
    status: 'in_progress', conclusion: null, head_sha: state.baseSha,
    run_attempt: currentRun.run_attempt, updated_at: '2026-08-09T14:05:00.000Z' }] }]);
}
const endpointParts = endpoint.split('/');
const jobInventoryPrefix = '/repos/' + state.repository + '/actions/runs/';
const jobInventorySuffix = '/jobs?per_page=100';
const jobInventoryIdentity = endpoint.startsWith(jobInventoryPrefix)
  && endpoint.endsWith(jobInventorySuffix)
  ? endpoint.slice(jobInventoryPrefix.length, -jobInventorySuffix.length).split('/attempts/')
  : [];
if (args[0] === 'api' && args.length === 4 && args[2] === '--paginate'
  && args[3] === '--slurp' && jobInventoryIdentity.length === 2
  && /^[1-9][0-9]*$/.test(jobInventoryIdentity[0])
  && /^[1-9][0-9]*$/.test(jobInventoryIdentity[1])) {
  const [jobRunId, jobRunAttempt] = jobInventoryIdentity;
  const phaseNames = state.phaseStepNames;
  const current = state.currentPhase;
  const currentRunAttempt = Number(run(jobRunId).run_attempt);
  const isCurrentAttempt = Number(jobRunAttempt) === currentRunAttempt;
  const order = ['recoveryPreparation', 'integration', 'closeoutMutation', 'closeoutPublication'];
  const currentIndex = order.indexOf(current);
  const steps = order.map((phase, index) => !isCurrentAttempt
    ? index < currentIndex
      ? { name: phaseNames[phase], number: index + 1, status: 'completed', conclusion: 'success',
          started_at: '2026-08-09T14:00:00.000Z', completed_at: '2026-08-09T14:04:00.000Z' }
      : { name: phaseNames[phase], number: index + 1, status: 'completed', conclusion: 'skipped',
          started_at: null, completed_at: '2026-08-09T14:04:00.000Z' }
    : index < currentIndex
    ? { name: phaseNames[phase], number: index + 1, status: 'completed', conclusion: 'success',
        started_at: '2026-08-09T14:00:00.000Z', completed_at: '2026-08-09T14:04:00.000Z' }
    : index === currentIndex
      ? { name: phaseNames[phase], number: index + 1, status: 'in_progress', conclusion: null,
          started_at: '2026-08-09T14:05:00.000Z', completed_at: null }
      : { name: phaseNames[phase], number: index + 1, status: 'queued', conclusion: null,
          started_at: null, completed_at: null });
  out([{ jobs: [{ id: 300 + Number(jobRunAttempt), run_id: Number(jobRunId), run_attempt: Number(jobRunAttempt),
    name: 'integrate', status: isCurrentAttempt ? 'in_progress' : 'completed',
    conclusion: isCurrentAttempt ? null : 'success', head_sha: state.baseSha,
    started_at: '2026-08-09T14:00:00.000Z', completed_at: null, steps }] }]);
}
const runArtifactInventoryPrefix = '/repos/' + state.repository + '/actions/runs/';
const runArtifactInventorySuffix = '/artifacts?per_page=100';
const runArtifactInventoryId = endpoint.startsWith(runArtifactInventoryPrefix)
  && endpoint.endsWith(runArtifactInventorySuffix)
  ? endpoint.slice(runArtifactInventoryPrefix.length, -runArtifactInventorySuffix.length)
  : '';
if (args[0] === 'api' && args.length === 4 && args[2] === '--paginate'
  && args[3] === '--slurp' && /^[1-9][0-9]*$/.test(runArtifactInventoryId)) {
  const artifacts = state.artifactsByRun[runArtifactInventoryId] || [];
  out([{ total_count: artifacts.length, artifacts }]);
}
const exactRunAttemptPattern = new RegExp('^/repos/' + state.repository.replace('/', '\\/')
  + '/actions/runs/([1-9][0-9]*)/attempts/([1-9][0-9]*)$');
const exactRunAttempt = exactRunAttemptPattern.exec(endpoint);
if (exactRunAttempt) {
  const historical = run(exactRunAttempt[1]);
  const requestedAttempt = Number(exactRunAttempt[2]);
  if (!historical || requestedAttempt > Number(historical.run_attempt)) {
    fail('historical workflow run attempt not found');
  }
  out({ ...historical, run_attempt: state.historicalAttemptMismatch === true
    && exactRunAttempt[1] === '200' ? requestedAttempt + 1 : requestedAttempt });
}
if (endpoint.includes('/actions/artifacts/')) out(state.artifactDetails[endpointParts.at(-1)]);
if (endpoint.includes('/actions/runs/') && !endpoint.includes('?')
  && !endpoint.includes('/attempts/') && !endpoint.endsWith('/artifacts')) {
  out(run(endpointParts.at(-1)));
}
const commentsEndpoint = '/repos/' + state.repository + '/issues/42/comments';
if (args.includes('-X') && args.includes('POST') && endpoint === commentsEndpoint) {
  const bodyArg = args.find((arg) => typeof arg === 'string' && arg.startsWith('body='));
  if (!bodyArg) fail('missing comment body');
  const created = actionsComment(state.nextCommentId++, bodyArg.slice(5), state.nextPostAppMode || 'canonical');
  state.commentPostCount = Number(state.commentPostCount || 0) + 1;
  state.comments.push(created);
  const lost = state.nextPostDisposition === 'lost';
  state.nextPostDisposition = 'success';
  state.nextPostAppMode = 'canonical';
  save(state);
  if (lost) fail('simulated lost POST response');
  out(created);
}
if (endpoint === commentsEndpoint + '?per_page=100') out([state.comments]);
if (endpoint.includes('/issues/comments/')) {
  const comment = state.comments.find((entry) => entry.id === Number(endpointParts.at(-1)));
  if (!comment) fail('HTTP 404 comment missing');
  out(comment);
}
fail('unsupported test gh command: ' + args.join(' '));
`, 'utf8');
  // Native fixtures also work when the parent runtime is a sealed anonymous image.
  for (const [source, name] of [[gitProgram, 'git'], [ghProgram, 'gh']] as const) {
    if (name === 'git' && process.platform !== 'win32') {
      // Keep the Git fixture within the production executable-byte budget.
      // Its runtime remains the existing held raw-test executable, not a PATH fallback.
      const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
      const launcher = path.join(shimRoot, name);
      writeFileSync(launcher, `#!/bin/sh\nexec ${quote(runtimeCommand)} ${quote(source)} \"$@\"\n`, 'utf8');
      chmodSync(launcher, 0o755);
      continue;
    }
    const output = process.platform === 'win32' ? `${name}.exe` : name;
    const compiled = spawnSync(runtimeCommand, ['build', '--compile', `--compile-executable-path=${runtimeCommand}`, source,
      '--outfile', path.join(shimRoot, output)], {
      cwd: shimRoot, encoding: 'utf8', windowsHide: true, timeout: 30_000
    });
    if (compiled.status !== 0) throw new Error(`cannot compile ${output}: ${compiled.stderr || compiled.stdout}`);
  }
  return shimRoot;
}

function withCloseoutHarnessCommands<T>(
  shimRoot: string,
  statePath: string,
  run: () => T
): T {
  const previous = {
    path: process.env.PATH,
    state: process.env.SEC_CLOSEOUT_TEST_STATE
  };
  process.env.PATH = `${shimRoot}${path.delimiter}${previous.path ?? ''}`;
  process.env.SEC_CLOSEOUT_TEST_STATE = statePath;
  try {
    return run();
  } finally {
    if (previous.path === undefined) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.state === undefined) delete process.env.SEC_CLOSEOUT_TEST_STATE;
    else process.env.SEC_CLOSEOUT_TEST_STATE = previous.state;
  }
}

let closeoutTcbClosureIdentity: ReturnType<typeof compileTcbClosureIdentity> | null = null;

function closeoutTcbModuleBlobs(): Readonly<Record<string, string>> {
  closeoutTcbClosureIdentity ??= compileTcbClosureIdentity();
  return closeoutTcbClosureIdentity.moduleBlobs;
}

export function prepareCloseoutCliScenario(input: {
  harnessRoot: string; recoveryHarnessRoot: string; shimRoot: string; name: string;
  baseSha: string; headSha: string; manifestPath: string;
  crashAfterDelete?: boolean; currentRunAttempt?: number;
  historicalAttemptMismatch?: boolean; postDisposition?: 'success' | 'lost';
  triggeringPrincipal?: Readonly<{login: string; nodeId: string; permission: 'admin' | 'maintain' | 'write'}>;
}) {
  const root = path.join(input.harnessRoot, input.name);
  const commonDir = path.join(root, '.git');
  const providerRecoveryRoot = path.join(input.recoveryHarnessRoot, input.name, 'provider');
  const recoveryRoot = path.join(input.recoveryHarnessRoot, input.name, 'rehydrated');
  mkdirSync(path.join(root, 'config', 'external-capabilities'), { recursive: true });
  writeFileSync(path.join(root, 'config', 'external-capabilities', 'ledger.yaml'),
    readFileSync(path.resolve(import.meta.dir,
      '../../../config/external-capabilities/ledger.yaml')));
  mkdirSync(commonDir, { recursive: true });
  const statePath = path.join(root, 'provider-state.json');
  const tcbBlobs: Record<string, string> = { ...closeoutTcbModuleBlobs() };
  for (const edge of SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedBoundaryEdges) {
    const target = edge.split(' -> ')[1];
    if (target !== undefined && tcbBlobs[target] === undefined) tcbBlobs[target] = 'd'.repeat(40);
  }
  const currentRunAttempt = input.currentRunAttempt ?? 1;
  const triggeringPrincipal = input.triggeringPrincipal ?? {
    login: 'integrator', nodeId: 'INTEGRATOR', permission: 'maintain' as const
  };
  const baseState: CloseoutCliHarnessState = {
    repositoryRoot: root,
    commonDir,
    recoveryRoot,
    repository: 'sec-platform/sec',
    repositoryId: '123',
    branch: 'feat/example',
    baseSha: input.baseSha,
    baseTreeSha: input.baseSha,
    headSha: input.headSha,
    headTreeSha: input.headSha,
    mergeCommitSha: '9'.repeat(40),
    comparisonObservations: {
      [input.baseSha + '...' + '9'.repeat(40)]: {
        status: 'ahead', ahead_by: 1, behind_by: 0,
        base_commit: { sha: input.baseSha }, merge_base_commit: { sha: input.baseSha }
      },
      ['9'.repeat(40) + '...' + '9'.repeat(40)]: {
        status: 'identical', ahead_by: 0, behind_by: 0,
        base_commit: { sha: '9'.repeat(40) }, merge_base_commit: { sha: '9'.repeat(40) }
      }
    },
    liveDefaultSha: input.baseSha,
    localDefaultSha: input.baseSha,
    racedDefaultSha: '8'.repeat(40),
    liveDefaultReadCount: 0,
    refOnlyFetchCount: 0,
    credentialBoundBranchReadCount: 0,
    refOnlyFetchFailure: false,
    raceAfterRefOnlyFetch: false,
    headReadValues: [],
    mergeMessage: '',
    localPresent: true,
    remotePresent: true,
    activeWorkPackageSelected: true,
    activeWorkManifest: input.manifestPath,
    inventoryPrState: 'OPEN',
    remoteDeleteCount: 0,
    mergeRequestCount: 0,
    commentPostCount: 0,
    localDeleteCount: 0,
    pruneCount: 0,
    crashAfterDelete: input.crashAfterDelete === true,
    crashInjected: false,
    crashReleasePath: path.join(root, 'crash-shim.release'),
    crashShimPid: null,
    tcbBlobs,
    runtimeBlob: tcbBlobs['src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts'] ?? 'e'.repeat(40),
    publisher: CI_GITHUB_ACTIONS_IDENTITY_POLICY,
    phaseStepNames: HOSTED_INTEGRATION_PHASE_STEP_NAMES,
    currentPhase: 'closeoutMutation',
    nextCommentId: 1000,
    nextPostDisposition: input.postDisposition ?? 'success',
    nextPostAppMode: 'canonical',
    historicalAttemptMismatch: input.historicalAttemptMismatch === true,
    principals: {
      integrator: { nodeId: 'INTEGRATOR', permission: 'maintain' },
      [CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login]: {
        nodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId, permission: 'none'
      },
      [triggeringPrincipal.login]: {
        nodeId: triggeringPrincipal.nodeId,
        permission: triggeringPrincipal.permission
      }
    },
    principalUserLookups: [],
    principalPermissionLookups: [],
    comments: [],
    artifactsByRun: {},
    artifactDetails: {},
    artifactFiles: {},
    runs: {
      100: { id: 100, run_attempt: 1, status: 'completed', conclusion: 'success',
        workflow_id: 307443415, event: 'repository_dispatch',
        path: '.github/workflows/compiler-pr-validation.yml', head_sha: input.baseSha,
        actor: { login: 'integrator', node_id: 'INTEGRATOR' },
        triggering_actor: { login: 'integrator', node_id: 'INTEGRATOR' },
        repository: { id: 123 } },
      199: { id: 199, run_attempt: 1, event: 'workflow_run',
        path: '.github/workflows/merge-gate.yml', head_sha: input.baseSha,
        actor: { login: 'integrator', node_id: 'INTEGRATOR', type: 'User' },
        triggering_actor: { login: 'integrator', node_id: 'INTEGRATOR' }, repository: { id: 123 } },
      200: { id: 200, run_attempt: currentRunAttempt, event: 'workflow_run',
        path: '.github/workflows/merge-gate.yml', head_sha: input.baseSha,
        actor: { login: 'integrator', node_id: 'INTEGRATOR', type: 'User' }, triggering_actor: {
          login: triggeringPrincipal.login, node_id: triggeringPrincipal.nodeId
        }, repository: { id: 123 } }
    }
  };
  writeCloseoutCliHarnessState(statePath, baseState);
  const prepared = withCloseoutHarnessCommands(input.shimRoot, statePath, () => (
    prepareBranchCloseout({ repositoryRoot: root, recoveryRoot: providerRecoveryRoot,
      activeWorkPackageObservation: observeCloseoutFixtureWork(root) }, {
      branch: 'feat/example', expectedHeadSha: input.headSha, pullRequestNumber: 42
    })
  ));
  const recoveryBundleBytes = readFileSync(prepared.preparation.recovery.path);
  const state = readCloseoutCliHarnessState(statePath);
  state.inventoryPrState = 'MERGED';
  state.activeWorkPackageSelected = false;
  state.liveDefaultSha = state.mergeCommitSha;
  state.localDefaultSha = state.mergeCommitSha;
  writeCloseoutCliHarnessState(statePath, state);
  const rehydratedPrepared = withCloseoutHarnessCommands(input.shimRoot, statePath,
    () => rehydratePreparedBranchCloseoutRecoveryArtifact({
      scope: { repositoryRoot: root, recoveryRoot, activeWorkPackageObservation: observeCloseoutFixtureWork(root) },
      remote: prepared,
      recoveryBundleBytes
    }));
  return { root, statePath, recoveryRoot, prepared, rehydratedPrepared, recoveryBundleBytes, state, baseState };
}
