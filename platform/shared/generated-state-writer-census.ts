import { GENERATED_STATE_RULES } from './generated-state-contract.ts';

/**
 * Generated-state writer census and closure gate.
 *
 * `generated-state-contract.ts` proves that declared producers classify
 * correctly. This module proves the converse: every literal repository-root
 * `.tmp` reference in tracked executable/config files maps to a declared
 * family, and every non-legacy declaration has a live producer anchor.
 *
 * The gate is intentionally bounded. It scans quoted literal generated-root
 * path strings, `path.join` calls that combine the generated root with a
 * literal first segment, and bare generated-root tokens in YAML/shell/
 * PowerShell/Python sources (workflow `path:` entries, CLI arguments and
 * output redirections). Producers that compose the generated root through
 * variables are declared with explicit probes, so stale anchors remain
 * detectable without building a general source-analysis platform.
 */

export type GeneratedStateWriterCensusMatch = 'exact' | 'prefix';

export type GeneratedStateWriterCensusEntry = Readonly<{
  ruleId: string;
  family: string;
  match: GeneratedStateWriterCensusMatch;
  producers: readonly string[];
  consumers: readonly string[];
  compositional?: boolean;
  probes?: readonly string[];
  legacyOnly?: boolean;
  note: string;
}>;

export type GeneratedStateWriterSourceFile = Readonly<{
  path: string;
  text: string;
}>;

export type GeneratedStateWriterReferenceKind = 'literal' | 'join' | 'root';

export type GeneratedStateWriterReference = Readonly<{
  file: string;
  line: number;
  family: string;
  kind: GeneratedStateWriterReferenceKind;
  raw: string;
}>;

export type GeneratedStateWriterCensusFindingCode =
  | 'generated-state-writer-unregistered'
  | 'generated-state-writer-ownership'
  | 'generated-state-writer-stale-producer'
  | 'generated-state-writer-stale-anchor';

export type GeneratedStateWriterCensusFinding = Readonly<{
  code: GeneratedStateWriterCensusFindingCode;
  file: string;
  line: number | null;
  family: string | null;
  message: string;
}>;

/**
 * Canonical writer census for every stable repository-root `.tmp` family.
 * `producers` are files that write/create the family; `consumers` are files
 * allowed to reference it for reading, cleanup, assertions or workflow upload.
 * One rule owns each family; several files may reference the same family.
 */
export const GENERATED_STATE_WRITER_CENSUS: readonly GeneratedStateWriterCensusEntry[] = Object.freeze([
  Object.freeze({
    ruleId: 'cleanup-transactions',
    family: '.generated-state-transactions',
    match: 'exact',
    producers: ['platform/dev-runner/generated-state.ts'],
    consumers: [],
    compositional: true,
    probes: ["'.generated-state-transactions'"],
    note: 'identity-bound cleanup transaction journal created through generated-root composition'
  }),
  Object.freeze({
    ruleId: 'cleanup-lock',
    family: '.generated-state-cleanup-lock',
    match: 'exact',
    producers: ['platform/dev-runner/generated-state.ts'],
    consumers: [],
    compositional: true,
    probes: ["'.generated-state-cleanup-lock'"],
    note: 'identity-bound cleanup lock created through generated-root composition'
  }),
  Object.freeze({
    ruleId: 'test-workspace-run',
    family: 'test-workspaces',
    match: 'exact',
    producers: [
      'platform/dev-runner/env-manager.ts',
      'platform/dev-runner/generated-state.ts',
      'platform/dev-runner/test-runner.ts',
      'tests/setup/runtime-deps.setup.ts',
      'scripts/run-work-package-gate.ts'
    ],
    consumers: [
      'tests/unit/env-manager.test.ts',
      'tests/unit/generated-state.test.ts',
      'tests/unit/work-package-gate-execution.test.ts'
    ],
    note: 'owned test workspace runs; narrower registry rules own .templates, transform cache, markers and supervisor leases'
  }),
  Object.freeze({
    ruleId: 'test-impact-cache',
    family: 'test-impact-cache.json',
    match: 'prefix',
    producers: ['platform/shared/test-impact-contract.ts'],
    consumers: ['tests/unit/test-impact-cache.test.ts'],
    note: 'rebuildable cache plus atomic .tmp staging residue'
  }),
  Object.freeze({
    ruleId: 'typecheck-incremental-cache',
    family: 'typecheck',
    match: 'exact',
    producers: ['tsconfig.json'],
    consumers: [
      'tests/contract/dev-runner-contract.test.ts',
      '.github/workflows/compiler-pr-validation.yml',
      '.github/workflows/compiler-release-validation.yml'
    ],
    note: 'TypeScript-owned incremental cache'
  }),
  Object.freeze({
    ruleId: 'import-candidate-snapshot',
    family: 'import-candidate-snapshots',
    match: 'exact',
    producers: ['platform/dev-runner/import-organizer.ts'],
    consumers: [],
    note: 'import organizer staging snapshots'
  }),
  Object.freeze({
    ruleId: 'compiler-dependency-install-state',
    family: 'dependency-installs',
    match: 'exact',
    producers: ['platform/shared/project-runtime.ts'],
    consumers: ['tests/integration/compiler-dependency-installation.test.ts'],
    note: 'derived toolchain staging and backups'
  }),
  Object.freeze({
    ruleId: 'compiler-dependency-stamp',
    family: 'compiler-deps.stamp.json',
    match: 'exact',
    producers: ['platform/shared/project-runtime.ts'],
    consumers: ['tests/unit/project-runtime-stamp.test.ts'],
    note: 'rebuildable compiler dependency stamp'
  }),
  Object.freeze({
    ruleId: 'ci-workspace-fast',
    family: 'ci-workspace-fast',
    match: 'prefix',
    producers: ['scripts/ci-workspace-fast.ts'],
    consumers: [],
    compositional: true,
    probes: ['ci-workspace-fast-'],
    note: 'dynamic fast CI workspace namespace'
  }),
  Object.freeze({
    ruleId: 'heavy-verification-gate-lease',
    family: 'heavy-verification-gate-v1',
    match: 'prefix',
    producers: ['platform/shared/heavy-verification-gate-lease.ts'],
    consumers: [],
    compositional: true,
    probes: ['heavy-verification-gate-v1'],
    note: 'identity-bound heavy gate lease family'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-snapshot',
    family: 'gate-execution-snapshots',
    match: 'exact',
    producers: ['scripts/run-work-package-gate.ts'],
    consumers: [
      'scripts/diagnose-work-package-profile-probe.ts',
      'tests/unit/work-package-gate-execution.test.ts'
    ],
    note: 'identity-bound gate execution snapshots'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-publication',
    family: '.gate-checkpoint-publications',
    match: 'exact',
    producers: ['scripts/run-work-package-gate.ts'],
    consumers: [],
    note: 'identity-bound gate checkpoint publication staging'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-run-r2',
    family: 'sm3-r2-work-package-gate',
    match: 'exact',
    producers: [
      'scripts/work-package-gate-contract.ts',
      'scripts/run-work-package-gate.ts'
    ],
    consumers: [
      'scripts/diagnose-work-package-profile-probe.ts',
      'tests/unit/work-package-gate-execution.test.ts'
    ],
    note: 'identity-bound r2 run directory protected by the gate artifact ledger'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-run-v4',
    family: 'sm3-r3-v4-work-package-gate',
    match: 'exact',
    producers: ['scripts/work-package-gate-contract.ts'],
    consumers: [
      'scripts/diagnose-work-package-profile-probe.ts',
      'tests/unit/work-package-gate-execution.test.ts'
    ],
    note: 'identity-bound v4 run directory protected by WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-run-legacy',
    family: 'sm3-r3-work-package-gate',
    match: 'exact',
    producers: ['scripts/run-work-package-gate.ts'],
    consumers: ['tests/unit/work-package-gate-execution.test.ts'],
    note: 'legacy ephemeral gate run directory'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-run-legacy',
    family: 'sm3-r3-v2-work-package-gate',
    match: 'exact',
    producers: ['scripts/run-work-package-gate.ts'],
    consumers: ['tests/unit/work-package-gate-execution.test.ts'],
    note: 'legacy ephemeral gate run directory'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-run-legacy',
    family: 'sm3-r3-v3-work-package-gate',
    match: 'exact',
    producers: ['scripts/run-work-package-gate.ts'],
    consumers: ['tests/unit/work-package-gate-execution.test.ts'],
    note: 'legacy ephemeral gate run directory'
  }),
  Object.freeze({
    ruleId: 'codex-merge-gate-scratch',
    family: 'codex',
    match: 'exact',
    producers: ['.github/workflows/sec-merge-gate.yml', 'scripts/codex/merge-gate.ts'],
    consumers: ['tests/contract/sec-merge-gate.test.ts'],
    note: 'ephemeral merge-gate scratch (attestation input/output, merge-gate input, candidate/legacy git dirs, atomic .pid.tmp writes)'
  }),
  Object.freeze({
    ruleId: 'ci-verification-evidence',
    family: 'ci-verification-evidence.json',
    match: 'prefix',
    producers: ['scripts/ci-verification.ts', 'platform/shared/ci-evidence-contract.ts'],
    consumers: [
      '.github/workflows/compiler-pr-validation.yml',
      '.github/workflows/compiler-release-validation.yml'
    ],
    note: 'bounded run-local verification evidence with explicit retention plus atomic write staging residue; not disposable cache'
  }),
  Object.freeze({
    ruleId: 'ci-risk-batch-evidence',
    family: 'ci-risk-batch-evidence.json',
    match: 'prefix',
    producers: ['scripts/ci-pr-risk.ts', 'platform/shared/ci-evidence-contract.ts'],
    consumers: ['tests/contract/ci-lanes.test.ts'],
    note: 'bounded run-local risk evidence with explicit retention plus atomic write staging residue; not disposable cache'
  }),
  Object.freeze({
    ruleId: 'runtime-source-phase-attribution',
    family: 'runtime-browser-cache-v10-phase-attribution.json',
    match: 'exact',
    producers: ['tests/unit/semantic-mutation-isolated-child-fence.test.ts'],
    consumers: [],
    note: 'bounded sentinel-gated runtime source phase attribution evidence with explicit retention'
  }),
  Object.freeze({
    ruleId: 'runtime-authority-fixtures',
    family: 'runtime-authority-fixtures',
    match: 'exact',
    producers: ['tests/unit/runtime-authority.test.ts'],
    consumers: [],
    note: 'rebuildable test fixture executables'
  }),
  Object.freeze({
    ruleId: 'work-package-gate-test-fixture',
    family: 'work-package-gate-',
    match: 'prefix',
    producers: ['tests/unit/work-package-gate-execution.test.ts'],
    consumers: [],
    note: 'rebuildable work-package-gate test fixtures (protected ledger, directory snapshots, raw text)'
  }),
  Object.freeze({
    ruleId: 'gate-test-workspace',
    family: 'workspace',
    match: 'exact',
    producers: ['tests/unit/work-package-gate-execution.test.ts'],
    consumers: [],
    note: 'rebuildable gate test workspace containing .sec/semantic-mutation control-shaped fixtures'
  }),
  Object.freeze({
    ruleId: 'synthetic-gate-contract',
    family: 'synthetic-gate-contract',
    match: 'prefix',
    producers: ['tests/unit/work-package-gate-contract.test.ts'],
    consumers: [],
    note: 'one-shot gate contract test output'
  }),
  Object.freeze({
    ruleId: 'synthetic-test-state',
    family: 'synthetic',
    match: 'prefix',
    producers: ['tests/unit/work-package-gate-execution.test.ts'],
    consumers: [],
    note: 'one-shot gate test synthetic namespaces and protected records'
  }),
  Object.freeze({
    ruleId: 'branch-recovery-invalid-location',
    family: 'recovery',
    match: 'prefix',
    producers: ['tests/unit/generated-state.test.ts'],
    consumers: ['tests/unit/branch-lifecycle-contract.test.ts'],
    compositional: true,
    probes: ['recovery'],
    note: 'invalid-location recovery asset family inside the generated root'
  }),
  Object.freeze({
    ruleId: 'root-diagnostic-snapshot',
    family: 'fence-',
    match: 'prefix',
    producers: ['tests/unit/generated-state.test.ts'],
    consumers: [],
    compositional: true,
    probes: ['fence-policy.json'],
    note: 'bounded root diagnostic snapshots'
  }),
  Object.freeze({
    ruleId: 'root-diagnostic-snapshot',
    family: 'tree.txt',
    match: 'exact',
    producers: [],
    consumers: [],
    legacyOnly: true,
    note: 'historical root diagnostic path retained for classification; no current tracked producer'
  }),
  Object.freeze({
    ruleId: 'generated-root',
    family: 'root',
    match: 'exact',
    producers: ['platform/dev-runner/generated-state.ts'],
    consumers: [
      'scripts/ci-workspace-fast.ts',
      'tests/unit/work-package-gate-execution.test.ts',
      'package.json'
    ],
    note: 'generated root creation and root-scope consumers/ignore globs'
  })
]);

const SCANNABLE_SOURCE_PATH = /\.(?:[cm]?[jt]sx?|py|ya?ml|sh|ps1)$/u;

function isScannableSource(repositoryPath: string): boolean {
  if (repositoryPath === 'package.json' || repositoryPath === 'tsconfig.json') return true;
  if (
    repositoryPath.startsWith('docs/evidence/')
    || repositoryPath.startsWith('docs/archive/')
  ) return false;
  return SCANNABLE_SOURCE_PATH.test(repositoryPath);
}

function normalizeFamily(segment: string): string {
  const firstSegment = segment.replaceAll('\\', '/').split('/')[0] ?? '';
  if (firstSegment === '**' || firstSegment === '*') return 'root';
  const dynamic = firstSegment.indexOf('${');
  const base = dynamic === -1 ? firstSegment : firstSegment.slice(0, dynamic);
  return base.replace(/-+$/u, '');
}

function familyMatches(
  entry: GeneratedStateWriterCensusEntry,
  family: string
): boolean {
  return entry.match === 'exact' ? family === entry.family : family.startsWith(entry.family);
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (source.charCodeAt(offset) === 0x0a) line += 1;
  }
  return line;
}

const TMP_LITERAL_PATTERN = /(['"`])\.tmp\/([^'"`]*?)\1/gu;
const TMP_SEGMENT_JOIN_PATTERN = /path\.join\(\s*[^,]+?,\s*['"`]\.tmp['"`]\s*,\s*['"`]([^'"`]*)['"`]/gu;
const TMP_ROOT_JOIN_PATTERN = /path\.join\(\s*[^,]+?,\s*['"`]\.tmp['"`]\s*\)/gu;
const TMP_BARE_PATTERN = /(?:^|[:\s=>(])\.tmp[\\/]([A-Za-z0-9_.$*\/\\-][A-Za-z0-9_.$*\/\\-]*)/gmu;
const BARE_SCANNABLE_PATH = /\.(?:ya?ml|sh|ps1|py)$/u;

export function extractGeneratedStateWriterReferences(
  file: string,
  source: string
): readonly GeneratedStateWriterReference[] {
  const references: GeneratedStateWriterReference[] = [];
  for (const match of source.matchAll(TMP_LITERAL_PATTERN)) {
    const family = normalizeFamily(match[2] ?? '');
    if (!family) continue;
    references.push({
      file,
      line: lineNumberAt(source, match.index ?? 0),
      family,
      kind: 'literal',
      raw: match[0]
    });
  }
  for (const match of source.matchAll(TMP_SEGMENT_JOIN_PATTERN)) {
    const family = normalizeFamily(match[1] ?? '');
    if (!family) continue;
    references.push({
      file,
      line: lineNumberAt(source, match.index ?? 0),
      family,
      kind: 'join',
      raw: match[0]
    });
  }
  for (const match of source.matchAll(TMP_ROOT_JOIN_PATTERN)) {
    references.push({
      file,
      line: lineNumberAt(source, match.index ?? 0),
      family: 'root',
      kind: 'root',
      raw: match[0]
    });
  }
  if (BARE_SCANNABLE_PATH.test(file)) {
    for (const match of source.matchAll(TMP_BARE_PATTERN)) {
      const lineStart = source.lastIndexOf('\n', (match.index ?? 0) - 1) + 1;
      const linePrefix = source.slice(lineStart, match.index ?? 0);
      if (/^\s*#/u.test(linePrefix)) continue;
      const family = normalizeFamily(match[1] ?? '');
      if (!family) continue;
      references.push({
        file,
        line: lineNumberAt(source, match.index ?? 0),
        family,
        kind: 'literal',
        raw: match[0]
      });
    }
  }
  return Object.freeze(references);
}

function bestEntryFor(
  entries: readonly GeneratedStateWriterCensusEntry[],
  family: string
): GeneratedStateWriterCensusEntry | null {
  const matched = entries.filter((entry) => familyMatches(entry, family));
  if (matched.length === 0) return null;
  return [...matched].sort((left, right) =>
    right.family.length - left.family.length
    || left.ruleId.localeCompare(right.ruleId))[0]!;
}

export function auditGeneratedStateWriterCensus(
  files: readonly GeneratedStateWriterSourceFile[],
  entries: readonly GeneratedStateWriterCensusEntry[] = GENERATED_STATE_WRITER_CENSUS
): readonly GeneratedStateWriterCensusFinding[] {
  const findings: GeneratedStateWriterCensusFinding[] = [];
  const textByPath = new Map(files.map((file) => [file.path, file.text] as const));
  const tracked = new Set(files.map((file) => file.path));

  for (const file of files) {
    if (!isScannableSource(file.path)) continue;
    for (const reference of extractGeneratedStateWriterReferences(file.path, file.text)) {
      const entry = bestEntryFor(entries, reference.family);
      if (entry === null) {
        findings.push(Object.freeze({
          code: 'generated-state-writer-unregistered',
          file: file.path,
          line: reference.line,
          family: reference.family,
          message: `unregistered repository-root .tmp writer family "${reference.family}" (${reference.kind})`
        }));
        continue;
      }
      if (![...entry.producers, ...entry.consumers].includes(file.path)) {
        findings.push(Object.freeze({
          code: 'generated-state-writer-ownership',
          file: file.path,
          line: reference.line,
          family: reference.family,
          message: `${file.path} references .tmp family "${reference.family}" but is not declared as its producer or consumer`
        }));
      }
    }
  }

  for (const entry of entries) {
    if (entry.legacyOnly === true) continue;
    const liveProducers = entry.producers.filter((producer) => tracked.has(producer));
    if (liveProducers.length === 0) {
      findings.push(Object.freeze({
        code: 'generated-state-writer-stale-producer',
        file: entry.producers[0] ?? '<unknown>',
        line: null,
        family: entry.family,
        message: `generated-state census family "${entry.family}" has no live producer file`
      }));
      continue;
    }
    let anchored = false;
    for (const producer of liveProducers) {
      const source = textByPath.get(producer);
      if (source === undefined) continue;
      if (entry.compositional === true) {
        if ((entry.probes ?? []).every((probe) => source.includes(probe))) {
          anchored = true;
          break;
        }
      } else if (
        extractGeneratedStateWriterReferences(producer, source)
          .some((reference) => familyMatches(entry, reference.family))
      ) {
        anchored = true;
        break;
      }
    }
    if (!anchored) {
      findings.push(Object.freeze({
        code: 'generated-state-writer-stale-anchor',
        file: entry.producers[0] ?? '<unknown>',
        line: null,
        family: entry.family,
        message: `generated-state census family "${entry.family}" has live producers but no matching literal reference or probe`
      }));
    }
  }

  return Object.freeze(findings);
}

export function assertGeneratedStateWriterCensus(): void {
  const ruleIds = new Set(GENERATED_STATE_RULES.map((rule) => rule.id));
  const families = new Set<string>();
  for (const [index, entry] of GENERATED_STATE_WRITER_CENSUS.entries()) {
    // `root` is the generated-state container itself, not a registry entry;
    // it uses the pseudo-owner `generated-root` so census and registry stay
    // distinct without inventing a container cleanup class.
    if (entry.family !== 'root' && !ruleIds.has(entry.ruleId)) {
      throw new Error(`Generated-state writer census ${index} references unknown rule ${entry.ruleId}.`);
    }
    if (families.has(entry.family)) {
      throw new Error(`Generated-state writer census contains duplicate family ${entry.family}.`);
    }
    families.add(entry.family);
    if (entry.legacyOnly !== true && entry.producers.length === 0) {
      throw new Error(`Generated-state writer census family ${entry.family} must declare a producer.`);
    }
    if (entry.compositional === true && (entry.probes ?? []).length === 0) {
      throw new Error(`Generated-state writer census family ${entry.family} must declare probes when compositional.`);
    }
  }
}

assertGeneratedStateWriterCensus();
