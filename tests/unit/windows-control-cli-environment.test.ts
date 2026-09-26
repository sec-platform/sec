import { expect, test } from 'bun:test';

import { computeWindowsControlCliEnvironmentSpecDigest, getWindowsControlCliExecutableBinding, parseWindowsControlCliEnvironmentAuthority, projectWindowsControlCliEnvironment, WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY, WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST } from '../../src/adapters/providers/windows-control-cli/contract/environment.ts';

function source(): Record<string, unknown> {
  const { specDigest: _specDigest, ...body } = WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY;
  return structuredClone(body) as Record<string, unknown>;
}

test('installed control-CLI profile forbids runtime provisioning and persistent executable caches', () => {
  const spec = WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY;
  expect(spec.adoptionContract.physicalClosure.runtimeProvisioning).toBe('forbidden');
  expect(spec.adoptionContract.physicalClosure.persistentExecutableCache).toBe('forbidden');
  expect(spec.rootClosure.positiveReceiptContract.persistentExecutableCache).toBe('forbidden');
});

test('canonical digest is derived from the strict profile content', () => {
  const reparsed = parseWindowsControlCliEnvironmentAuthority(source());
  expect(reparsed.specDigest).toBe(WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST);
  expect(computeWindowsControlCliEnvironmentSpecDigest(
    source() as Parameters<typeof computeWindowsControlCliEnvironmentSpecDigest>[0]
  )).toBe(WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST);
});

test('Git and GitHub bindings describe installed executable bytes and one effective role', () => {
  for (const id of ['git', 'gh'] as const) {
    const binding = getWindowsControlCliExecutableBinding(
      WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
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
  const gh = getWindowsControlCliExecutableBinding(
    WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
    'gh'
  )!;
  expect(gh.launcherEntries).toHaveLength(1);
  expect(gh.launcherEntries[0]).toBe(gh.effectiveEntry);
});

test('projection exposes only bounded physical adoption and executable identities', () => {
  const projection = projectWindowsControlCliEnvironment(
    WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY
  );
  expect(projection.rootClosure.status).toBe('live-adoption-required');
  expect(projection.adoptionBudget.discovery.selection)
    .toBe('unique-authenticated-physical-closure');
  expect(projection.executableBindings.map(({ id }) => id)).toEqual(['git', 'gh']);
  expect(Object.hasOwn(projection.executableBindings[1]!, 'endpoints')).toBe(false);
  expect(Object.keys(projection.resourceBudget)).toEqual(['maxSessionDurationMs']);
  for (const binding of projection.executableBindings) {
    expect(Object.hasOwn(binding, 'versionProbe')).toBe(false);
    expect(Object.hasOwn(binding, 'commandContract')).toBe(false);
    expect(Object.hasOwn(binding, 'commandBudget')).toBe(false);
  }
});

test('unknown profile fields are rejected instead of becoming implicit authority', () => {
  expect(() => parseWindowsControlCliEnvironmentAuthority({
    ...source(),
    archiveUrl: 'https://example.invalid/tool.zip'
  })).toThrow(/schema validation failed/u);
});

test('duplicate physical paths and duplicate roles are rejected', () => {
  const duplicatePath = source();
  const duplicateBindings = duplicatePath.executableBindings as Array<Record<string, unknown>>;
  const gh = duplicateBindings[1]!;
  const entries = gh.executableEntries as Array<Record<string, unknown>>;
  entries.push(structuredClone(entries[0]!));
  expect(() => parseWindowsControlCliEnvironmentAuthority(duplicatePath))
    .toThrow(/duplicate case-insensitive path/u);

  const duplicateRole = source();
  const bindings = duplicateRole.executableBindings as Array<Record<string, unknown>>;
  const ghEntries = bindings[1]!.executableEntries as Array<Record<string, unknown>>;
  ghEntries[0]!.roles = ['launcher', 'launcher'];
  expect(() => parseWindowsControlCliEnvironmentAuthority(duplicateRole))
    .toThrow(/schema validation failed/u);
});

test('candidate layouts cannot point outside declared launcher and effective entries', () => {
  const invalid = source();
  const bindings = invalid.executableBindings as Array<Record<string, unknown>>;
  const layouts = bindings[0]!.candidateLayouts as Array<Record<string, unknown>>;
  layouts[0]!.effectiveRelativePath = 'undeclared/git.exe';
  expect(() => parseWindowsControlCliEnvironmentAuthority(invalid))
    .toThrow(/does not bind declared launcher\/effective entries/u);
});
