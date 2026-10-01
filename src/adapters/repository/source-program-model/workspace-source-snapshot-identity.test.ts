import { expect, test } from 'bun:test';

import { rawSha256 } from '../../../contracts/canonical.ts';
import { parseSecModuleDescriptorJson, type SecModuleDescriptor } from '../architecture/contract.ts';
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

function snapshot(membership: Parameters<typeof compileVirtualWorkspaceSourceSnapshot>[0]['moduleMembership']) {
  const source = 'export const value = 1;\n';
  return compileVirtualWorkspaceSourceSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('identity-base'),
        mutationDigest: rawSha256(source)
      }
    },
    files: [{ path: 'src/example/value.ts', source, contentDigest: rawSha256(source) }],
    moduleMembership: membership
  });
}

test('snapshot identity checks still validate cloned inputs and reject changed bytes', () => {
  const membership = Object.freeze({
    descriptors: Object.freeze([]), graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]), moduleForPath: () => null
  });
  const value = snapshot(membership);
  const input = { sourceRevision: value.sourceRevision, files: value.files, moduleMembership: value.moduleMembership };
  expect(() => value.assertMatches({
    ...input, files: value.files.map((file) => ({ ...file })), moduleMembership: { ...membership }
  })).not.toThrow();
  expect(() => value.assertMatches({
    ...input, files: value.files.map((file) => ({ ...file, source: `${file.source}// changed\n` }))
  })).toThrow();
  expect(() => value.assertMatches({ ...input, sourceRevision: rawSha256('another-revision') })).toThrow();
});

test('frozen custom membership callback cannot bypass observation through snapshot identity', () => {
  let current: SecModuleDescriptor | null = null;
  const membership = Object.freeze({
    descriptors: Object.freeze([]), graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]), moduleForPath: () => current
  });
  const value = snapshot(membership);
  const input = { sourceRevision: value.sourceRevision, files: value.files, moduleMembership: membership };
  expect(() => value.assertMatches(input)).not.toThrow();
  current = parseSecModuleDescriptorJson(
    '{"importGraph":"runtime","externalEntrypoints":[]}', 'src/example/module.json'
  );
  expect(() => value.assertMatches(input)).toThrow('does not bind');
});
