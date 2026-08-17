import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('release source binds the Bun executable identity across dependency and bundle effects', async () => {
  const source = await readCompilerFile('platform/release/release-source-materialization.ts');

  expect(source).toContain("schema: 'sec-release-builder-identity-v1'");
  expect(source).toContain('executableSha256');
  expect(source).toContain('fs.realpath(process.execPath)');
  expect(source).toContain('before.mtimeNs !== after.mtimeNs');
  expect(source).toContain("assertBuilderIdentityUnchanged(builder, 'before dependency materialization')");
  expect(source).toContain("assertBuilderIdentityUnchanged(builder, 'during dependency materialization')");
  expect(source).toContain("assertBuilderIdentityUnchanged(source.builder, 'before bundle execution')");
  expect(source).toContain("assertBuilderIdentityUnchanged(source.builder, 'during bundle execution')");
  expect(source).toContain("'--backend'");
  expect(source).toContain("'copyfile'");
});

test('release artifact manifest content digest includes structured builder identity', async () => {
  const artifact = await readCompilerFile('platform/release/release-artifact.ts');

  expect(artifact).toContain('readonly builder: ReleaseBuilderIdentityV1');
  expect(artifact).toContain("candidate.schema === 'sec-release-builder-identity-v1'");
  expect(artifact).toContain("candidate.runtime === 'bun'");
  expect(artifact).toContain("/^sha256:[0-9a-f]{64}$/u.test(candidate.executableSha256)");
  expect(artifact).toContain('builder: readback.builder');
  expect(artifact).toContain('builder: source.builder');
  expect(artifact).not.toContain('builder: `bun@${Bun.version}`');
});
