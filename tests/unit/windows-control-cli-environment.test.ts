import { expect, test } from 'bun:test';

import { computeSecWindowsControlCliEnvironmentSpecDigest, getSecWindowsControlCliBindingV1, parseSecWindowsControlCliEnvironmentAuthority, projectSecWindowsControlCliEnvironmentV1, SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY, SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST } from '../../src/external-capabilities/windows-control-cli/contract/environment.ts';

function source(): Record<string, unknown> {
  const { specDigest: _specDigest, ...body } = SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY;
  return structuredClone(body) as Record<string, unknown>;
}

test('installed control-CLI profile forbids runtime provisioning and persistent executable caches', () => {
  const spec = SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY;
  expect(spec.adoptionContract.physicalClosure.runtimeProvisioning).toBe('forbidden');
  expect(spec.adoptionContract.physicalClosure.persistentExecutableCache).toBe('forbidden');
  expect(spec.rootClosure.positiveReceiptContract.persistentExecutableCache).toBe('forbidden');
});

test('canonical digest is derived from the strict profile content', () => {
  const reparsed = parseSecWindowsControlCliEnvironmentAuthority(source());
  expect(reparsed.specDigest).toBe(SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST);
  expect(computeSecWindowsControlCliEnvironmentSpecDigest(
    source() as Parameters<typeof computeSecWindowsControlCliEnvironmentSpecDigest>[0]
  )).toBe(SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST);
});

test('Git and GitHub bindings describe installed executable bytes and one effective role', () => {
  for (const id of ['git', 'gh'] as const) {
    const binding = getSecWindowsControlCliBindingV1(
      SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
      id
    );
    expect(binding).not.toBeNull();
    if (binding === null) continue;
    expect(binding.effectiveEntry.roles).toContain('effective');
    expect(binding.effectiveEntry.observedSizeBytes).toBeGreaterThan(0);
    expect(binding.effectiveEntry.observedSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(binding.launcherEntries.length).toBeGreaterThan(0);
    expect(binding.candidateLayouts.every((layout) =>
      binding.launcherEntries.some((entry) => entry.relativePath === layout.candidateRelativePath)))
      .toBe(true);
  }
  const gh = getSecWindowsControlCliBindingV1(
    SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
    'gh'
  )!;
  expect(gh.launcherEntries).toHaveLength(1);
  expect(gh.launcherEntries[0]).toBe(gh.effectiveEntry);
});

test('projection exposes only bounded adoption, command and endpoint contracts', () => {
  const projection = projectSecWindowsControlCliEnvironmentV1(
    SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY
  );
  expect(projection.rootClosure.status).toBe('live-adoption-required');
  expect(projection.adoptionBudget.discovery.selection)
    .toBe('unique-authenticated-physical-closure');
  expect(projection.commandBindings.find(({ id }) => id === 'gh')?.endpoints)
    .toEqual({
      host: 'github.com',
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql'
    });
});

test('unknown profile fields are rejected instead of becoming implicit authority', () => {
  expect(() => parseSecWindowsControlCliEnvironmentAuthority({
    ...source(),
    archiveUrl: 'https://example.invalid/tool.zip'
  })).toThrow(/schema validation failed/u);
});

test('duplicate physical paths and duplicate roles are rejected', () => {
  const duplicatePath = source();
  const duplicateBindings = duplicatePath.commandBindings as Array<Record<string, unknown>>;
  const gh = duplicateBindings[1]!;
  const entries = gh.executableEntries as Array<Record<string, unknown>>;
  entries.push(structuredClone(entries[0]!));
  expect(() => parseSecWindowsControlCliEnvironmentAuthority(duplicatePath))
    .toThrow(/duplicate case-insensitive path/u);

  const duplicateRole = source();
  const bindings = duplicateRole.commandBindings as Array<Record<string, unknown>>;
  const ghEntries = bindings[1]!.executableEntries as Array<Record<string, unknown>>;
  ghEntries[0]!.roles = ['launcher', 'launcher'];
  expect(() => parseSecWindowsControlCliEnvironmentAuthority(duplicateRole))
    .toThrow(/schema validation failed/u);
});

test('candidate layouts cannot point outside declared launcher and effective entries', () => {
  const invalid = source();
  const bindings = invalid.commandBindings as Array<Record<string, unknown>>;
  const layouts = bindings[0]!.candidateLayouts as Array<Record<string, unknown>>;
  layouts[0]!.effectiveRelativePath = 'undeclared/git.exe';
  expect(() => parseSecWindowsControlCliEnvironmentAuthority(invalid))
    .toThrow(/does not bind declared launcher\/effective entries/u);
});
