import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  compileTypeScriptModel,
  currentTypeScriptRequiredApiClosure
} from '../../repository/source-program-model/typescript.ts';
import { DEPENDENCY_CAPABILITY_SPECS } from '../dependencies/contract/dependency-capability-contract.ts';
import { parseRuntimeDependencyPackageReference } from '../dependencies/contract/runtime-dependency-spec.ts';
import {
  assessDependencyFreshness,
  projectDependencyFreshnessManifest
} from '../dependencies/runtime/dependency-freshness.ts';
import { compileTypeScriptCapabilityCoverage } from './capability-coverage.ts';
import {
  requireSelectedTypeScriptNativeChecker,
  selectInstalledTypeScriptNativeChecker
} from './checker.ts';

const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]),
  graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]),
  moduleForPath: () => null
});

function requiredApiClosure() {
  const source = "import ts from 'typescript';\nexport const compiler = ts.createProgram;\n";
  const files = Object.freeze([Object.freeze({
    path: 'src/authoring.ts',
    source,
    contentDigest: rawSha256(source)
  })]);
  const model = compileTypeScriptModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  const closure = currentTypeScriptRequiredApiClosure(model);
  if (closure === null) throw new Error('Expected a Source Program TypeScript API closure');
  return closure;
}

function freshnessInput(authoringVersion: string, nativeVersion: string) {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  for (const spec of DEPENDENCY_CAPABILITY_SPECS) {
    const reference = spec.name === 'typescript'
      ? authoringVersion
      : spec.name === '@typescript/native'
        ? `npm:typescript@${nativeVersion}`
        : spec.name === '@types/bun'
          ? '1.4.0'
          : '1.0.0';
    (spec.section === 'dependencies' ? dependencies : devDependencies)[spec.name] = reference;
  }
  const manifest = projectDependencyFreshnessManifest(
    { dependencies, devDependencies, packageManager: 'bun@1.4.0' },
    sha256({ dependencies, devDependencies }) as `sha256:${string}`
  );
  const entries = manifest.entries.map((entry) => {
    const resolved = parseRuntimeDependencyPackageReference(entry.declaredName, entry.declaredReference);
    if (resolved === null) throw new Error(`Expected exact dependency ${entry.declaredName}`);
    return Object.freeze({
      declaredName: entry.declaredName,
      packageName: resolved.packageName,
      resolvedVersion: resolved.version
    });
  });
  const latestByPackage = new Map<string, string>();
  for (const entry of entries) {
    const current = latestByPackage.get(entry.packageName);
    if (current === undefined || Bun.semver.order(current, entry.resolvedVersion) < 0) {
      latestByPackage.set(entry.packageName, entry.resolvedVersion);
    }
  }
  return Object.freeze({
    bunRuntimeVersion: '1.4.0',
    lock: Object.freeze({
      entries: Object.freeze(entries),
      lockDigest: sha256(entries) as `sha256:${string}`
    }),
    manifest,
    registry: Object.freeze([...latestByPackage].map(([packageName, latestVersion]) => Object.freeze({
      latestVersion,
      packageName,
      provider: 'registry-test-provider',
      status: 'resolved' as const
    })))
  });
}

test('TypeScript owner binds the intentional pin to actual API and native provider coverage', async () => {
  const closure = requiredApiClosure();
  const nativeVersion = closure.authoringProviderRevision.split('.').map((part, index) => (
    index === 0 ? String(Number(part) + 1) : part
  )).join('.');
  const root = await mkdtemp(path.join(tmpdir(), 'sec-typescript-coverage-'));
  const nodeModules = path.join(root, 'node_modules');
  const nativePackageName = `@typescript/typescript-${process.platform}-${process.arch}`;
  const aliasManifest = Object.freeze({
    name: 'typescript',
    version: nativeVersion,
    bin: Object.freeze({ tsc: './bin/tsc' }),
    optionalDependencies: Object.freeze({ [nativePackageName]: nativeVersion }),
    exports: Object.freeze({
      '.': './lib/version.js',
      './unstable/ast': './lib/unstable/ast.js'
    })
  });
  const aliasManifestBytes = Buffer.from(JSON.stringify(aliasManifest));
  try {
    const aliasRoot = path.join(nodeModules, '@typescript', 'native');
    const nativeRoot = path.join(nodeModules, ...nativePackageName.split('/'));
    await mkdir(path.join(aliasRoot, 'bin'), { recursive: true });
    await mkdir(path.join(nativeRoot, 'lib'), { recursive: true });
    await writeFile(path.join(aliasRoot, 'package.json'), aliasManifestBytes);
    await writeFile(path.join(aliasRoot, 'bin', 'tsc'), 'native-wrapper');
    await writeFile(path.join(nativeRoot, 'package.json'), JSON.stringify({
      name: nativePackageName,
      version: nativeVersion
    }));
    await writeFile(
      path.join(nativeRoot, 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc'),
      'native-executable'
    );
    const checker = requireSelectedTypeScriptNativeChecker(
      await selectInstalledTypeScriptNativeChecker(nodeModules)
    );
    const input = freshnessInput(closure.authoringProviderRevision, nativeVersion);
    const authoringDependency = input.lock.entries.find(({ declaredName }) => declaredName === 'typescript')!;
    const nativeDependency = input.lock.entries.find(({ declaredName }) => declaredName === '@typescript/native')!;
    const coverage = compileTypeScriptCapabilityCoverage({
      authoringDependency,
      nativeChecker: checker,
      nativeDependency,
      nativePackageManifestBytes: aliasManifestBytes,
      requiredApiClosure: closure
    });

    expect(coverage).toMatchObject({
      status: 'intentional-pair',
      exitCondition: {
        status: 'blocked',
        reason: 'stable-authoring-api-coverage-unproven',
        observedStableModuleEntrypoints: ['.']
      }
    });
    expect(assessDependencyFreshness(input).packages.find(
      ({ declaredName }) => declaredName === 'typescript'
    )).toMatchObject({ status: 'unresolved' });
    expect(assessDependencyFreshness(input, coverage).packages.find(
      ({ declaredName }) => declaredName === 'typescript'
    )).toMatchObject({
      reason: 'paired-provider-roles',
      status: 'intentional-pin'
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
