import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { withGitHubCredentialStore } from '../../src/adapters/providers/github-api/credential-store.ts';
import { inspectGitHubActionsVerificationCredentialIdentity } from '../../src/adapters/providers/github-api/credential.ts';
import { readArtifactMember } from '../../src/adapters/providers/github-api/internal/artifact-member.ts';
import { executeGitHubApiOperation, GitHubApiGraphqlResponseError } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, withGitHubApiTestSession, type GitHubApiTransport } from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { GITHUB_REVIEWS_QUERY } from '../../src/adapters/providers/github-api/verification-queries.ts';
import { createVerificationSessionGitHubClient } from '../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';
import { ZIP_VECTORS } from './github-api-artifact-fixtures.ts';

const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root,{recursive:true,force:true}); });
let binaryRoot: string | undefined;
async function fixture() {
  if (binaryRoot === undefined) {
    binaryRoot = await mkdtemp(path.join(os.tmpdir(),'sec-http-credential-bin-')); roots.push(binaryRoot);
    const source = path.join(binaryRoot,'credential.ts');
    await writeFile(source, `import {writeFileSync,realpathSync} from 'node:fs';
if (process.argv.slice(-4).join(' ') !== 'auth token --hostname github.com') process.exit(1);
writeFileSync('credential-observation.json',JSON.stringify({config:process.env.GH_CONFIG_DIR ?? null,home:process.env.HOME ?? null,
 token:process.env.GH_TOKEN !== undefined,proxy:process.env.HTTPS_PROXY !== undefined,directory:realpathSync('/proc/self/fd/4')}));
process.stdout.write('ghp_synthetic_credential_000000000000');`);
    const build = Bun.spawn([process.execPath,'build','--compile',source,'--outfile',path.join(binaryRoot,'gh')],{stdout:'pipe',stderr:'pipe'});
    if (await build.exited !== 0) throw new Error(await new Response(build.stderr).text());
  }
  const root = await mkdtemp(path.join(os.tmpdir(),'sec-http-verification-')); roots.push(root);
  const repository = path.join(root,'repository'), store = path.join(root,'store');
  await mkdir(repository); await mkdir(store,{mode:0o700});
  return {repository,store,binaryRoot};
}

for (const explicit of [false,true]) test.serial.skipIf(process.platform !== 'linux')(
  `actual HTTP verification consumer uses ${explicit ? 'explicit' : 'default'} credential source`, async () => {
    const {repository,store,binaryRoot} = await fixture();
    const previous = {...process.env}, priorFetch = globalThis.fetch;
    const requests: string[] = [];
    const customPermission = { permission: 'write', role_name: 'custom-maintainer' };
    try {
      Object.assign(process.env,{PATH:binaryRoot,GH_TOKEN:'poisoned-token',GH_CONFIG_DIR:'/poisoned-config',
        HOME:'/poisoned-home',GH_HOST:'wrong.invalid',HTTPS_PROXY:'http://managed-route-fixture'});
      delete process.env.GITHUB_ACTIONS;
      globalThis.fetch = (async (target,init) => {
        const url = new URL(String(target)); requests.push(url.pathname);
        expect(url.origin).toBe('https://api.github.com');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ghp_synthetic_credential_000000000000');
        const value = url.pathname === '/graphql' ? {data:{repository:{pullRequest:{reviews:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}},
          errors:[{message:"Cannot query field 'privateField' on type 'PullRequest'. PRIVATE_CONTEXT"}]}
          : url.pathname === '/user' || url.pathname === '/users/fixture' ? {login:'fixture',node_id:'FIXTURE',id:1}
          : url.pathname.startsWith('/users/') ? {login:url.pathname.split('/').at(-1),node_id:'OBSERVED',id:2}
          : url.pathname.endsWith('/collaborators/custom/permission') ? customPermission
          : url.pathname.endsWith('/collaborators/writer/permission') ? {permission:'write',role_name:'write'}
          : url.pathname.endsWith('/permission') ? {permission:'write',role_name:'maintain'}
          : url.pathname.endsWith('/pulls/42') ? {number:42,state:'open',merged:false,draft:false,user:{node_id:'AUTHOR'},
            base:{ref:'main',sha:'1'.repeat(40),repo:{full_name:'sec-platform/sec'}},
            head:{ref:'feature',sha:'2'.repeat(40),repo:{full_name:'sec-platform/sec'}},title:'Fixture',body:'',merge_commit_sha:null}
          : {tree:{sha:url.pathname.split('/').at(-1)}};
        return new Response(JSON.stringify(value));
      }) as typeof fetch;
      let escaped: ReturnType<typeof createVerificationSessionGitHubClient> | undefined;
      const observe = async () => {
        const client = createVerificationSessionGitHubClient(repository,'sec-platform/sec'); escaped = client;
        expect(await client.observeViewerPrincipal('sec-platform/sec')).toEqual({login:'fixture',nodeId:'FIXTURE',permission:'maintain'});
        expect(await client.observePrincipal('sec-platform/sec','fixture')).toEqual({login:'fixture',nodeId:'FIXTURE',permission:'maintain'});
        expect(await client.observePrincipal('sec-platform/sec','writer')).toEqual({login:'writer',nodeId:'OBSERVED',permission:'write'});
        let permissionError: unknown;
        try { await client.observePrincipal('sec-platform/sec','custom'); } catch (error) { permissionError = error; }
        expect(permissionError).toMatchObject({ classification:'github-rest-collaborator-permission',
          source:{repository:'sec-platform/sec',login:'custom',source:JSON.stringify(customPermission),parsedValue:customPermission} });
        expect((await client.observeCandidate('sec-platform/sec',42)).headSha).toBe('2'.repeat(40));
        const barrier = await client.observeReviewBarrier({repository:'sec-platform/sec',prNumber:42,headSha:'2'.repeat(40),excludedPrincipalNodeIds:new Set()});
        expect(barrier).toMatchObject({status:'provider-schema-unsupported',reasonCode:'github-graphql-schema-unsupported'});
        expect(JSON.stringify(barrier)).not.toContain('PRIVATE_CONTEXT');
        const before = requests.length;
        await expect(client.observeCandidate('other/repository',42)).rejects.toThrow('binding changed');
        expect(requests).toHaveLength(before);
      };
      if (explicit) await withGitHubCredentialStore({directoryPath:store,repositoryRoot:repository},observe); else await observe();
      expect(JSON.parse(await readFile(path.join(explicit ? store : repository,'credential-observation.json'),'utf8')))
        .toMatchObject({config:explicit ? '/proc/self/fd/4' : null,token:false,proxy:false,directory:explicit ? store : repository});
      if (explicit) {
        const before = requests.length;
        await expect(escaped!.observeViewerPrincipal('sec-platform/sec')).rejects.toThrow('credential binding changed');
        expect(requests).toHaveLength(before);
      }
    } finally { globalThis.fetch = priorFetch; for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env,previous); }
  }
);

function capability(transport: GitHubApiTransport, effect: 'verification-read' | 'verification-dispatch' = 'verification-read') {
  return issueGitHubApiTestCapability({repository:'sec-platform/sec',token:'synthetic-test-token-000000',effect,
    principal:{transport:'github-rest-token',login:'maintainer',nodeId:'MAINTAINER',userId:1,permission:'maintain'},transport});
}
const selected = {kind:'verification-artifact-text' as const,artifactId:'1',artifactName:'fixture',runId:'2',
  archiveDigest:rawSha256(Buffer.from(ZIP_VECTORS.good,'base64')),fileName:'artifact.json'};

function artifactTransport(input: {location?: string; bytes?: Uint8Array; digest?: string; observed?: RequestInit[]}) {
  const bytes = input.bytes ?? Buffer.from(ZIP_VECTORS.good,'base64');
  return (async (target: string | URL,init?: RequestInit) => {
    const url = new URL(String(target)); input.observed?.push(init!);
    if (url.pathname.endsWith('/artifacts/1')) return new Response(JSON.stringify({id:1,name:'fixture',workflow_run:{id:2},
      expired:false,size_in_bytes:bytes.byteLength,digest:input.digest ?? selected.archiveDigest}));
    if (url.pathname.endsWith('/zip')) return new Response(null,{status:302,headers:{location:input.location ?? 'https://fixture.blob.core.windows.net/artifact?sig=SECRET_QUERY'}});
    return new Response(bytes);
  }) satisfies GitHubApiTransport;
}

test('canonical binary owner follows one trusted redirect without forwarding credentials', async () => {
  const observed: RequestInit[] = [];
  const cap = capability(artifactTransport({observed}));
  expect(await withGitHubApiTestSession({capability:cap,operation:async () => await executeGitHubApiOperation(cap,selected)})).toBe('{"ok":true}');
  expect(observed).toHaveLength(3);
  expect(new Headers(observed[1]!.headers).has('authorization')).toBe(true);
  expect(new Headers(observed[2]!.headers).has('authorization')).toBe(false);
  expect(new Headers(observed[2]!.headers).has('cookie')).toBe(false);
  expect(observed[2]!.redirect).toBe('error');
  expect(observed[2]!.credentials).toBe('omit');
});

for (const location of ['https://evil.invalid/a?sig=SECRET_QUERY','http://fixture.blob.core.windows.net/a',
  'https://user:password@fixture.blob.core.windows.net/a','https://fixture.blob.core.windows.net.evil.invalid/a']) {
  test('artifact redirect rejects untrusted destination before unauthenticated fetch: '+location.split('?')[0],async () => {
    const observed: RequestInit[] = [],cap = capability(artifactTransport({location,observed}));
    const error = await withGitHubApiTestSession({capability:cap,operation:async()=>await executeGitHubApiOperation(cap,selected)}).then(()=>null,error=>error);
    expect(error).toBeInstanceOf(Error); expect(error.message).not.toContain('SECRET_QUERY'); expect(observed).toHaveLength(2);
  });
}

test('archive digest drift fails before member parsing',async () => {
  const bytes = Buffer.from(ZIP_VECTORS.good,'base64'); bytes[0] = bytes[0]! ^ 1;
  const cap = capability(artifactTransport({bytes}));
  await expect(withGitHubApiTestSession({capability:cap,operation:async()=>await executeGitHubApiOperation(cap,selected)})).rejects.toThrow('archive identity');
});

for (const kind of ['duplicate','symlink','traversal','oversized','unsupported'] as const) test(`mature ZIP reader rejects ${kind}`,async () => {
  await expect(readArtifactMember({archive:Buffer.from(ZIP_VECTORS[kind],'base64'),fileName:'artifact.json',signal:new AbortController().signal,
    assertCurrent() {}})).rejects.toThrow();
});

test('ZIP rejects output size mismatch and pre-aborted admission',async () => {
  const archive = Buffer.from(ZIP_VECTORS.good,'base64');
  const central = archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); archive.writeUInt32LE(1,central+24);
  await expect(readArtifactMember({archive,fileName:'artifact.json',signal:new AbortController().signal,assertCurrent(){}})).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(readArtifactMember({archive:Buffer.from(ZIP_VECTORS.good,'base64'),fileName:'artifact.json',signal:controller.signal,
    assertCurrent(){if(controller.signal.aborted) throw new Error('cancelled');}})).rejects.toMatchObject({name:'AbortError'});
});

test('closed verification query and write contracts reject before network',async () => {
  let calls = 0; const cap = capability(async()=>{calls++;return new Response('{}');});
  await withGitHubApiTestSession({capability:cap,operation:async()=> {
    await expect(executeGitHubApiOperation(cap,{kind:'verification-query',document:'mutation{evil}',variables:{}})).rejects.toThrow();
    await expect(executeGitHubApiOperation(cap,{kind:'verification-query',document:GITHUB_REVIEWS_QUERY,variables:{owner:'other',name:'repo',number:42}})).rejects.toThrow();
    await expect(executeGitHubApiOperation(cap,{kind:'verification-dispatch',request:{}})).rejects.toThrow();
  }});
  expect(calls).toBe(0);
});

test('workflow run history uses an unfiltered numeric workflow endpoint and rejects malformed selectors before transport', async () => {
  const requests: Array<{ target: string; method: string | undefined; body: unknown }> = [];
  const cap = capability(async (target, init) => {
    requests.push({ target: String(target), method: init?.method, body: init?.body });
    return new Response('{"total_count":0,"workflow_runs":[]}');
  });
  await withGitHubApiTestSession({ capability: cap, operation: async () => {
    expect(await executeGitHubApiOperation(cap, {
      kind: 'verification-workflow-run-history', workflowId: '123', page: 2
    })).toEqual({ total_count: 0, workflow_runs: [] });
    expect(requests).toEqual([{
      target: 'https://api.github.com/repos/sec-platform/sec/actions/workflows/123/runs?per_page=100&page=2',
      method: 'GET', body: undefined
    }]);
    requests.length = 0;
    for (const workflowId of ['0', '../runs', '123?status=success']) {
      await expect(executeGitHubApiOperation(cap, {
        kind: 'verification-workflow-run-history', workflowId, page: 1
      })).rejects.toThrow();
      expect(requests).toEqual([]);
    }
    await expect(executeGitHubApiOperation(cap, {
      kind: 'verification-workflow-run-history', workflowId: '123', page: 0
    })).rejects.toThrow();
    expect(requests).toEqual([]);
  } });
});

test('verification provenance reads exact numeric attempt, suite, workflow and job endpoints without selector injection', async () => {
  const requests: Array<{ target: string; method: string | undefined; body: unknown }> = [];
  const cap = capability(async (target, init) => {
    requests.push({ target: String(target), method: init?.method, body: init?.body });
    return new Response('{}');
  });
  await withGitHubApiTestSession({ capability: cap, operation: async () => {
    await executeGitHubApiOperation(cap, { kind: 'verification-workflow-run-attempt', runId: '11', runAttempt: 2 });
    await executeGitHubApiOperation(cap, { kind: 'verification-check-suite', checkSuiteId: '12' });
    await executeGitHubApiOperation(cap, { kind: 'verification-workflow', workflowId: '13' });
    await executeGitHubApiOperation(cap, { kind: 'verification-workflow-job', jobId: '14' });
    expect(requests).toEqual([
      { target: 'https://api.github.com/repos/sec-platform/sec/actions/runs/11/attempts/2', method: 'GET', body: undefined },
      { target: 'https://api.github.com/repos/sec-platform/sec/check-suites/12', method: 'GET', body: undefined },
      { target: 'https://api.github.com/repos/sec-platform/sec/actions/workflows/13', method: 'GET', body: undefined },
      { target: 'https://api.github.com/repos/sec-platform/sec/actions/jobs/14', method: 'GET', body: undefined }
    ]);
    requests.length = 0;
    for (const id of ['0', '../escape', '12?branch=main']) {
      await expect(executeGitHubApiOperation(cap, { kind: 'verification-workflow-run-attempt', runId: id, runAttempt: 1 })).rejects.toThrow();
      expect(requests).toEqual([]);
      await expect(executeGitHubApiOperation(cap, { kind: 'verification-check-suite', checkSuiteId: id })).rejects.toThrow();
      expect(requests).toEqual([]);
      await expect(executeGitHubApiOperation(cap, { kind: 'verification-workflow', workflowId: id })).rejects.toThrow();
      expect(requests).toEqual([]);
      await expect(executeGitHubApiOperation(cap, { kind: 'verification-workflow-job', jobId: id })).rejects.toThrow();
      expect(requests).toEqual([]);
    }
    await expect(executeGitHubApiOperation(cap, { kind: 'verification-workflow-run-attempt', runId: '11', runAttempt: 0 })).rejects.toThrow();
    expect(requests).toEqual([]);
  } });
});

test('hosted verification credential identity rejects foreign workflow and revision',()=> {
  const source={GITHUB_ACTIONS:'true',GITHUB_SERVER_URL:'https://github.com',GITHUB_API_URL:'https://api.github.com',
    GITHUB_REPOSITORY:'sec-platform/sec',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_WORKFLOW_SHA:'a'.repeat(40),
    GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'1',GH_TOKEN:'synthetic-hosted-token',GITHUB_EVENT_NAME:'repository_dispatch',
    GITHUB_WORKFLOW_REF:'sec-platform/sec/.github/workflows/compiler-pr-validation.yml@refs/heads/main'};
  expect(inspectGitHubActionsVerificationCredentialIdentity(source,'sec-platform/sec')).toMatchObject({runId:'42'});
  for(const change of [{GITHUB_SHA:'b'.repeat(40)},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REPOSITORY:'other/repo'},
    {GITHUB_WORKFLOW_REF:'sec-platform/sec/untrusted.yml@refs/heads/main'},{GITHUB_RUN_ATTEMPT:'0'}]) {
    expect(inspectGitHubActionsVerificationCredentialIdentity({...source,...change},'sec-platform/sec')).toBeNull();
  }
});


test('artifact response overflow invokes cancellation without returning partial output',async()=> {
  let cancelled = false;
  const base = artifactTransport({});
  const cap = capability(async(target,init)=> {
    if (new URL(String(target)).hostname.endsWith('.blob.core.windows.net')) return new Response(new ReadableStream<Uint8Array>({
      pull(controller){controller.enqueue(new Uint8Array(2*1024*1024));},
      cancel(){cancelled = true;}
    }));
    return await base(target,init);
  });
  await expect(withGitHubApiTestSession({capability:cap,operation:async()=>await executeGitHubApiOperation(cap,selected)}))
    .rejects.toThrow('response-byte budget');
  expect(cancelled).toBe(true);
});

test('artifact response error and failed cancellation retain safe composite settlement failure',async()=> {
  const base=artifactTransport({});
  const cap=capability(async(target,init)=> {
    if(new URL(String(target)).hostname.endsWith('.blob.core.windows.net')) return new Response(new ReadableStream<Uint8Array>({
      pull(controller){controller.enqueue(new Uint8Array(33*1024*1024));},
      cancel(){throw new Error('SECRET_QUERY must not escape');}
    }));
    return await base(target,init);
  });
  const error=await withGitHubApiTestSession({capability:cap,operation:async()=>await executeGitHubApiOperation(cap,selected)})
    .then(()=>null,error=>error);
  expect(error).toBeInstanceOf(AggregateError);
  const messages=(value: unknown): string=>value instanceof AggregateError
    ? value.message+' '+value.errors.map(messages).join(' ') : value instanceof Error ? value.message : String(value);
  expect(messages(error)).not.toContain('SECRET_QUERY');
  expect(messages(error)).toContain('settlement');
});


test('ZIP encrypted member is rejected before decompression',async()=> {
  const archive=Buffer.from(ZIP_VECTORS.good,'base64');
  const central=archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  archive.writeUInt16LE(archive.readUInt16LE(6)|1,6);
  archive.writeUInt16LE(archive.readUInt16LE(central+8)|1,central+8);
  await expect(readArtifactMember({archive,fileName:'artifact.json',signal:new AbortController().signal,assertCurrent(){}})).rejects.toThrow();
});


for (const errors of [[{message:"Cannot query field 'unknown' on type 'PullRequest'. PRIVATE_CONTEXT"}],
  [{message:'Non-schema provider failure PRIVATE_CONTEXT'}], {message:'malformed errors'}]) {
  test('HTTP200 GraphQL errors reject partial data centrally without exposing provider text',async()=> {
    const cap=capability(async()=>new Response(JSON.stringify({data:{repository:{pullRequest:{reviews:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}},errors}),{status:200}));
    const error=await withGitHubApiTestSession({capability:cap,operation:async()=>await executeGitHubApiOperation(cap,
      {kind:'verification-query',document:GITHUB_REVIEWS_QUERY,variables:{number:42}})}).then(()=>null,error=>error);
    expect(error).toBeInstanceOf(GitHubApiGraphqlResponseError);
    expect(error.responseDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(error.message).not.toContain('PRIVATE_CONTEXT');
    expect(error.schemaUnsupported).toBe(Array.isArray(errors)&&errors[0]?.message.startsWith('Cannot query'));
  });
}


test('artifact member charges its decoded bytes to the borrowing operation budget', async () => {
  let charged = 0;
  const value = await readArtifactMember({ archive: Buffer.from(ZIP_VECTORS.good, 'base64'),
    fileName: 'artifact.json', signal: new AbortController().signal, assertCurrent() {},
    chargeDecodedBytes(bytes) { charged += bytes; } });
  expect(value).toBe('{"ok":true}');
  expect(charged).toBe(Buffer.byteLength(value, 'utf8'));
});

test('decoded-byte budget rejection stops artifact reading without returning partial data', async () => {
  let charged = 0;
  await expect(readArtifactMember({ archive: Buffer.from(ZIP_VECTORS.good, 'base64'),
    fileName: 'artifact.json', signal: new AbortController().signal, assertCurrent() {},
    chargeDecodedBytes(bytes) { charged += bytes; throw new Error('borrowed decoded budget exhausted'); }
  })).rejects.toThrow('borrowed decoded budget exhausted');
  expect(charged).toBeGreaterThan(0);
});

test('canonical Session dispatch sends the exact GitHub HTTP request', async () => {
  const request = Object.freeze({
    schema: 'sec-verification-session-hosted-request-v1', prNumber: 42,
    expectedBaseSha: '1'.repeat(40), expectedBaseTreeSha: '2'.repeat(40),
    expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
    manifestPath: 'config/repository/work-packages/fixture.md',
    manifestDigest: `sha256:${'5'.repeat(64)}`, profile: 'quick',
    expectedScopeProposalDigest: `sha256:${'6'.repeat(64)}`,
    expectedActionPlanDigest: `sha256:${'7'.repeat(64)}`,
    expectedSessionRevision: `sha256:${'8'.repeat(64)}`,
    reviewPolicyDigest: `sha256:${'9'.repeat(64)}`,
    requestOperationId: `sha256:${'a'.repeat(64)}`
  });
  const requests: Array<{ target: string; method: string | undefined; body: unknown }> = [];
  const cap = capability(async (target, init) => {
    requests.push({ target: String(target), method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 204 });
  }, 'verification-dispatch');
  const result = await withGitHubApiTestSession({ capability: cap, operation: async () =>
    await executeGitHubApiOperation(cap, { kind: 'verification-dispatch', request }) });
  expect(result).toBeNull();
  expect(requests).toEqual([{
    target: 'https://api.github.com/repos/sec-platform/sec/dispatches', method: 'POST',
    body: {
      event_type: 'sec-verify-session-v2',
      client_payload: { payload: {
        schema: 'sec-verification-session-hosted-request-v1', prNumber: 42,
        expectedBaseSha: '1'.repeat(40), expectedBaseTreeSha: '2'.repeat(40),
        expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
        manifestPath: 'config/repository/work-packages/fixture.md',
        manifestDigest: `sha256:${'5'.repeat(64)}`, profile: 'quick',
        expectedScopeProposalDigest: `sha256:${'6'.repeat(64)}`,
        expectedActionPlanDigest: `sha256:${'7'.repeat(64)}`,
        expectedSessionRevision: `sha256:${'8'.repeat(64)}`,
        reviewPolicyDigest: `sha256:${'9'.repeat(64)}`,
        requestOperationId: `sha256:${'a'.repeat(64)}`
      } }
    }
  }]);
});
