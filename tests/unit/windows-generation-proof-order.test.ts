import { expect, test } from 'bun:test';

import {
  assertWindowsReadOnlyTreeGenerationProofForTests,
  WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_SCHEMA,
  WindowsHostDirectoryAuthorityError
} from '../../src/adapters/runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';

type FixtureEntry = Readonly<{
  aclDigest: string;
  identity: Readonly<{
    changeTime: string;
    dev: string;
    ino: string;
    mode: string;
  }>;
  predecessorDescriptor: string;
  relativePath: string;
}>;

function generationProofFixture(relativePaths: readonly string[]): string {
  const binding = Object.freeze({
    generationDigest: `sha256:${'1'.repeat(64)}` as const,
    treeDigest: `sha256:${'2'.repeat(64)}` as const,
    treeEntryCount: relativePaths.length
  });
  const entries = Object.freeze(relativePaths.map((relativePath, index): FixtureEntry => Object.freeze({
    aclDigest: `acl-${index}`,
    identity: Object.freeze({
      changeTime: String(index + 1),
      dev: '1',
      ino: String(index + 1),
      mode: '33188'
    }),
    predecessorDescriptor: Buffer.from(`entry-${index}`, 'utf8').toString('base64'),
    relativePath
  })));
  const rootAclDigest = 'root-acl';
  const rootIdentity = Object.freeze({ changeTime: '1', dev: '1', ino: '1', mode: '16877' });
  const rootPath = 'C:\\sec-generation-proof-fixture';
  const rootPredecessorDescriptor = Buffer.from('root', 'utf8').toString('base64');
  const schema = WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_SCHEMA;
  const unsigned = Object.freeze({
    binding,
    entries,
    rootAclDigest,
    rootIdentity,
    rootPath,
    rootPredecessorDescriptor,
    schema
  });
  return `${JSON.stringify(Object.freeze({
    binding,
    entries,
    proofDigest: rawSha256(JSON.stringify(unsigned)),
    rootAclDigest,
    rootIdentity,
    rootPath,
    rootPredecessorDescriptor,
    schema
  }))}\n`;
}

test('Windows generation proof accepts canonical code-unit order independently of locale collation', () => {
  expect(() => assertWindowsReadOnlyTreeGenerationProofForTests(
    generationProofFixture(['README.md', 'package.json'])
  )).not.toThrow();
});

test('Windows generation proof rejects duplicate and non-increasing entry paths', () => {
  for (const relativePaths of [
    ['README.md', 'README.md'],
    ['package.json', 'README.md']
  ]) {
    expect(() => assertWindowsReadOnlyTreeGenerationProofForTests(
      generationProofFixture(relativePaths)
    )).toThrow(WindowsHostDirectoryAuthorityError);
  }
});
