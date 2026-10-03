import { expect, test } from 'bun:test';
import { readArtifactMember, readArtifactMembers } from '../../src/adapters/providers/github-api/internal/artifact-member.ts';
import { executeGitHubApiOperation, HostedArtifactProjectionDataError } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, withGitHubApiTestSession } from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';
import { ZIP_VECTORS } from '../unit/github-api-artifact-fixtures.ts';

// Independent Python zipfile vectors. PRE contents are transport data, not a
// semantic bootstrap receipt or a production provenance qualification.
const PRE = 'UEsDBBQAAAAIAAAAIVy2L+AnHAAAABoAAAALAAAAY2hlY2tlci5tanPT11coKSotLklNUUjOSE3OTi1SKM4vLUpO5QIAUEsDBBQAAAAIAAAAIVx4NU4xEgAAABAAAAAQAAAAcHJlLXJlY2VpcHQuanNvbqtWKshILE5VslIqKEpVquUCAFBLAwQUAAAACAAAACFc5fxhLhQAAAASAAAACgAAAFNIQTI1NlNVTVNLy6woKS1K1U3OSE3OLi7NLeYCAFBLAQIUAxQAAAAIAAAAIVy2L+AnHAAAABoAAAALAAAAAAAAAAAAAACkgQAAAABjaGVja2VyLm1qc1BLAQIUAxQAAAAIAAAAIVx4NU4xEgAAABAAAAAQAAAAAAAAAAAAAACkgUUAAABwcmUtcmVjZWlwdC5qc29uUEsBAhQDFAAAAAgAAAAhXOX8YS4UAAAAEgAAAAoAAAAAAAAAAAAAAKSBhQAAAFNIQTI1NlNVTVNQSwUGAAAAAAMAAwCvAAAAwQAAAAAA';
// Five small deflated entries whose local and central uncompressed-size claims
// independently request 7MiB each; the cumulative guard must run before inflate.
const EXPANSION = 'UEsDBBQAAAAIAAAAIVyDFtyMAwAAAAAAcAABAAAAYasAAFBLAwQUAAAACAAAACFcgxbcjAMAAAAAAHAAAQAAAGKrAABQSwMEFAAAAAgAAAAhXIMW3IwDAAAAAABwAAEAAABjqwAAUEsDBBQAAAAIAAAAIVyDFtyMAwAAAAAAcAABAAAAZKsAAFBLAwQUAAAACAAAACFcgxbcjAMAAAAAAHAAAQAAAGWrAABQSwECFAMUAAAACAAAACFcgxbcjAMAAAAAAHAAAQAAAAAAAAAAAAAApIEAAAAAYVBLAQIUAxQAAAAIAAAAIVyDFtyMAwAAAAAAcAABAAAAAAAAAAAAAACkgSIAAABiUEsBAhQDFAAAAAgAAAAhXIMW3IwDAAAAAABwAAEAAAAAAAAAAAAAAKSBRAAAAGNQSwECFAMUAAAACAAAACFcgxbcjAMAAAAAAHAAAQAAAAAAAAAAAAAApIFmAAAAZFBLAQIUAxQAAAAIAAAAIVyDFtyMAwAAAAAAcAABAAAAAAAAAAAAAACkgYgAAABlUEsFBgAAAAAFAAUA6wAAAKoAAAAAAA==';
const signal = () => new AbortController().signal;

test('closed member projection reads one ZIP and leaves legacy single-member selection unchanged', async () => {
  const archive = Buffer.from(ZIP_VECTORS.good, 'base64');
  const members = await readArtifactMembers({ archive, fileNames: ['artifact.json', 'ignored.txt'], signal: signal(), assertCurrent() {} });
  expect(members).toEqual({ 'artifact.json': '{"ok":true}', 'ignored.txt': 'not extracted' });
  expect(Object.isFrozen(members)).toBe(true);
  expect(await readArtifactMember({ archive, fileName: 'artifact.json', signal: signal(), assertCurrent() {} })).toBe('{"ok":true}');
  await expect(readArtifactMembers({ archive, fileNames: ['artifact.json'], signal: signal(), assertCurrent() {} })).rejects.toThrow('closed projection');
  await expect(readArtifactMembers({ archive, fileNames: ['artifact.json', 'ignored.txt', 'missing.json'], signal: signal(), assertCurrent() {} })).rejects.toThrow('absent');
});

test('member input membership and bytes are captured before asynchronous ZIP work', async () => {
  const input = { archive: Buffer.from(ZIP_VECTORS.good, 'base64'), fileNames: ['artifact.json', 'ignored.txt'], signal: signal(), assertCurrent() {} };
  const reading = readArtifactMembers(input);
  input.fileNames[0] = 'other.json';
  input.archive.fill(0);
  expect((await reading)['artifact.json']).toBe('{"ok":true}');
});

test('duplicate selections, ambiguous ZIP paths and cumulative expansion are rejected', async () => {
  await expect(readArtifactMembers({ archive: Buffer.from(ZIP_VECTORS.good, 'base64'),
    fileNames: ['artifact.json', 'artifact.json'], signal: signal(), assertCurrent() {} })).rejects.toThrow();
  for (const kind of ['duplicate', 'symlink', 'traversal', 'oversized', 'unsupported'] as const) {
    await expect(readArtifactMembers({ archive: Buffer.from(ZIP_VECTORS[kind], 'base64'),
      fileNames: ['artifact.json'], signal: signal(), assertCurrent() {} })).rejects.toThrow();
  }
  await expect(readArtifactMembers({ archive: Buffer.from(EXPANSION, 'base64'),
    fileNames: ['a', 'b', 'c', 'd', 'e'], signal: signal(), assertCurrent() {} })).rejects.toThrow('cumulative');
});

test('bootstrap projection uses one authenticated archive response for all fixed members', async () => {
  const archive = Buffer.from(PRE, 'base64'), digest = rawSha256(archive);
  const requests: string[] = [];
  const capability = issueGitHubApiTestCapability({ repository: 'sec-platform/sec', effect: 'verification-read', token: 'fixture-no-secret',
    principal: { transport: 'github-rest-token', login: 'fixture', nodeId: 'FIXTURE', userId: 1, permission: 'maintain' },
    transport: async (target, init) => {
      const url = new URL(String(target)); requests.push(url.href);
      if (url.hostname === 'fixture.blob.core.windows.net') {
        expect(new Headers(init?.headers).has('authorization')).toBe(false);
        return new Response(archive);
      }
      if (url.pathname.endsWith('/zip')) return new Response(null, { status: 302,
        headers: { location: 'https://fixture.blob.core.windows.net/archive' } });
      return new Response(JSON.stringify({ id: 8, name: 'bootstrap-pre-fixture', workflow_run: { id: 7 }, expired: false,
        size_in_bytes: archive.byteLength, digest }));
    } });
  const value = await withGitHubApiTestSession({ capability, operation: async () => await executeGitHubApiOperation(capability,
    { kind: 'verification-artifact-members', projection: 'bootstrap-pre', artifactId: '8', artifactName: 'bootstrap-pre-fixture', runId: '7', archiveDigest: digest }) });
  expect(value).toEqual({ 'checker.mjs': '// trusted checker source\n', 'pre-receipt.json': '{"phase":"pre"}\n', SHA256SUMS: 'fixture-checksums\n' });
  expect(requests).toHaveLength(3);
  expect(requests.filter(url => url.startsWith('https://fixture.blob.core.windows.net/'))).toHaveLength(1);
});

test('closed bootstrap transport accepts an ordinary empty diff-check log beside nonempty receipt data', async () => {
  const archive = Buffer.from('UEsDBBQAAAAIAAAAQ10AAAAAAgAAAAAAAAAOAAAAZGlmZi1jaGVjay5sb2cDAFBLAwQUAAAACAAAAENdPKtf7RIAAAAQAAAAEAAAAHN1dC1yZWNlaXB0Lmpzb26rVirISCxOVbJSKi4tUarlAgBQSwECFAMUAAAACAAAAENdAAAAAAIAAAAAAAAADgAAAAAAAAAAAAAApIEAAAAAZGlmZi1jaGVjay5sb2dQSwECFAMUAAAACAAAAENdPKtf7RIAAAAQAAAAEAAAAAAAAAAAAAAApIEuAAAAc3V0LXJlY2VpcHQuanNvblBLBQYAAAAAAgACAHoAAABuAAAAAAA=', 'base64');
  const members = await readArtifactMembers({archive, fileNames: ['diff-check.log','sut-receipt.json'], signal: signal(), assertCurrent() {}});
  expect(members).toEqual({'diff-check.log':'','sut-receipt.json':'{"phase":"sut"}\n'});
  await expect(readArtifactMember({archive,fileName:'diff-check.log',signal:signal(),assertCurrent(){}})).rejects.toThrow('size');
  try {
    await readArtifactMembers({archive,fileNames:['diff-check.log','sut-receipt.json','missing.json'],signal:signal(),assertCurrent(){}});
    throw new Error('missing member unexpectedly accepted');
  } catch(error) {
    expect(error).toBeInstanceOf(HostedArtifactProjectionDataError);
    expect((error as HostedArtifactProjectionDataError).status).toBe('unavailable');
  }
});

test('decoded byte charges survive a later invalid UTF-8 member failure', async () => {
  let charged = 0;
  await expect(readArtifactMembers({archive:Buffer.from('UEsDBBQAAAAIAAAAQ1114M4KCgAAAAgAAAAJAAAAZmlyc3QubG9nS84vzStRyE0FAFBLAwQUAAAACAAAAENdAAAA/wMAAAABAAAACwAAAGludmFsaWQubG9n+w8AUEsBAhQDFAAAAAgAAABDXXXgzgoKAAAACAAAAAkAAAAAAAAAAAAAAKSBAAAAAGZpcnN0LmxvZ1BLAQIUAxQAAAAIAAAAQ10AAAD/AwAAAAEAAAALAAAAAAAAAAAAAACkgTEAAABpbnZhbGlkLmxvZ1BLBQYAAAAAAgACAHAAAABdAAAAAAA=','base64'),fileNames:['first.log','invalid.log'],
    signal:signal(),assertCurrent(){},chargeDecodedBytes(bytes){charged += bytes;}})).rejects.toThrow();
  expect(charged).toBe(9);
});
