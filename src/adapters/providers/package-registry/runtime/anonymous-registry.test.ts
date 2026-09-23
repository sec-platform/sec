import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';

import { ANONYMOUS_PACKAGE_REGISTRY_PROFILE } from '../contract/anonymous-registry.ts';
import {
  issueAnonymousPackageRegistryTestCapability,
  queryAnonymousPackageRegistryLatestVersionsForTests
} from './anonymous-registry.ts';

test('anonymous registry provider bounds endpoint, bytes, JSON and deadline', async () => {
  const observedPaths: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      observedPaths.push(pathname);
      const headers = { 'content-type': 'application/json' };
      if (pathname.includes('slow')) {
        await Bun.sleep(250);
        return new Response('{"latest":"1.0.0"}', { headers });
      }
      if (pathname.includes('large')) {
        return new Response(JSON.stringify({ latest: '1.0.0', padding: 'x'.repeat(400) }), { headers });
      }
      if (pathname.includes('invalid')) {
        return new Response('{"latest":"1.0.0","latest":"2.0.0"}', { headers });
      }
      return new Response('{"latest":"7.0.2","next":"7.1.0-beta.1"}', { headers });
    }
  });
  try {
    const capability = issueAnonymousPackageRegistryTestCapability({
      ...ANONYMOUS_PACKAGE_REGISTRY_PROFILE,
      maximumResponseBytes: 256,
      origin: `http://127.0.0.1:${server.port}`,
      timeoutMs: 100
    });
    const deadlineAtUnixMs = Date.now() + 2_000;
    const observations = await queryAnonymousPackageRegistryLatestVersionsForTests(
      capability,
      ['@typescript/native', 'large', 'invalid', 'slow'],
      { deadlineAtUnixMs }
    );

    expect(observations.find(({ packageName }) => packageName === '@typescript/native')).toMatchObject({
      latestVersion: '7.0.2',
      status: 'resolved'
    });
    expect(observations.find(({ packageName }) => packageName === 'large')).toMatchObject({
      reason: 'response-too-large',
      status: 'unavailable'
    });
    expect(observations.find(({ packageName }) => packageName === 'invalid')).toMatchObject({
      reason: 'response-invalid',
      status: 'unavailable'
    });
    expect(observations.find(({ packageName }) => packageName === 'slow')).toMatchObject({
      reason: 'deadline-exhausted',
      status: 'unavailable'
    });
    expect(observedPaths).toContain('/-/package/%40typescript%2Fnative/dist-tags');
    expect(() => queryAnonymousPackageRegistryLatestVersionsForTests(
      { ...capability },
      ['typescript'],
      { deadlineAtUnixMs }
    )).toThrow('was not issued by the provider owner');
  } finally {
    server.stop(true);
  }
});

test('one registry batch keeps its captured deadline and cancellation source across queued requests', async () => {
  const original = new AbortController();
  const replacement = new AbortController();
  replacement.abort('a different request');
  const options = { deadlineAtUnixMs: Date.now() + 5_000, signal: original.signal };
  const observed: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      observed.push(new URL(request.url).pathname);
      // The caller may reuse or edit its configuration after request capture.
      options.deadlineAtUnixMs = 0;
      options.signal = replacement.signal;
      return Response.json({ latest: '1.0.0' });
    }
  });
  try {
    const capability = issueAnonymousPackageRegistryTestCapability({
      ...ANONYMOUS_PACKAGE_REGISTRY_PROFILE,
      maximumConcurrentRequests: 1,
      origin: `http://127.0.0.1:${server.port}`
    });
    const results = await queryAnonymousPackageRegistryLatestVersionsForTests(capability, ['b', 'a', 'b'], options);
    expect(observed).toEqual(['/-/package/a/dist-tags', '/-/package/b/dist-tags']);
    expect(results.map(result => [result.packageName, result.status])).toEqual([['a', 'resolved'], ['b', 'resolved']]);
  } finally { server.stop(true); }
});

test('registry cancellation remains live after input capture and unavailable results do not erase siblings', async () => {
  const controller = new AbortController();
  const server = Bun.serve({ port: 0, fetch() { controller.abort('stop future work'); return Response.json({ latest: '1.0.0' }); } });
  try {
    const capability = issueAnonymousPackageRegistryTestCapability({
      ...ANONYMOUS_PACKAGE_REGISTRY_PROFILE,
      maximumConcurrentRequests: 1,
      origin: `http://127.0.0.1:${server.port}`
    });
    const results = await queryAnonymousPackageRegistryLatestVersionsForTests(capability, ['a', 'b'], {
      deadlineAtUnixMs: Date.now() + 5_000, signal: controller.signal
    });
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({ packageName: 'b', status: 'unavailable', reason: 'deadline-exhausted' });
  } finally { server.stop(true); }
});

for (const [status, contentType, contentLength, body, reason] of [
  [404, 'application/json', null, 'unconsumed', 'package-not-found'],
  [503, 'application/json', null, 'unconsumed', 'provider-failure'],
  [200, 'text/plain', null, 'unconsumed', 'response-invalid'],
  [200, 'application/json', '4096', 'unconsumed', 'response-too-large'],
  [200, 'application/json', null, 'x'.repeat(512), 'response-too-large']
] as const) {
  test(`registry discards unfinished HTTP ${status} ${contentType} ${contentLength ?? 'chunked'} bodies at ${reason}`, async () => {
    let signalClosed!: () => void;
    const closed = new Promise<void>(resolve => { signalClosed = resolve; });
    let cancellations = 0;
    // Flush exact HTTP headers independently of the body. A content-length
    // mismatch must not be hidden by an in-process server buffering the response.
    const sockets = new Set<Socket>();
    const server = createServer((_request, response) => {
      response.on('close', () => { cancellations++; signalClosed(); });
      response.writeHead(status, { 'content-type': contentType,
        ...(contentLength === null ? {} : { 'content-length': contentLength }) });
      response.flushHeaders();
      response.write(body);
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a loopback TCP listener');
    let observationTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const capability = issueAnonymousPackageRegistryTestCapability({
        ...ANONYMOUS_PACKAGE_REGISTRY_PROFILE, maximumResponseBytes: 256,
        origin: `http://127.0.0.1:${address.port}`
      });
      const results = await queryAnonymousPackageRegistryLatestVersionsForTests(capability, ['sample'], {
        deadlineAtUnixMs: Date.now() + 5_000
      });
      expect(results).toMatchObject([{ status: 'unavailable', reason }]);
      const observation = await Promise.race([
        closed.then(() => true),
        new Promise<boolean>(resolve => { observationTimeout = setTimeout(() => resolve(false), 1_000); })
      ]);
      expect(observation).toBe(true);
      expect(cancellations).toBe(1);
    } finally {
      clearTimeout(observationTimeout);
      const serverClosed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy();
      await serverClosed;
    }
  });
}
