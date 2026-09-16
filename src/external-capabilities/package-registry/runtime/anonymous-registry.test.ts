import { expect, test } from 'bun:test';

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
