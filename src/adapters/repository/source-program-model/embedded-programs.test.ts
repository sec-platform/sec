import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  compileSourceProgramEmbeddedWorkflowPrograms,
  sourceProgramModuleImports
} from './embedded-programs.ts';
import { compileRepositorySourceProgramModel } from './repository.ts';
import { compileSecRepositoryModuleGraph } from './typescript.ts';

const workflowPath = '.github/workflows/embedded-program.test.yml';
const workflowSource = `name: embedded-program
on: workflow_dispatch
jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - name: inspect API
        uses: actions/github-script@0123456789012345678901234567890123456789
        with:
          script: |
            const crypto = require('node:crypto');
            await import(process.env.INSPECTOR_MODULE);
            core.info(crypto.createHash('sha256').update('ok').digest('hex'));
      - name: run Bun CLI
        run: |
          bun -e 'import { inspect } from "./src/inspect.ts"; inspect()'
`;

test('workflow executable values compile into addressed programs, capabilities and explicit unknowns', () => {
  const units = compileSourceProgramEmbeddedWorkflowPrograms({
    path: workflowPath,
    source: workflowSource,
    contentDigest: rawSha256(workflowSource)
  });

  expect(units.map(({ address, kind }) => ({ address, kind }))).toEqual([
    { address: 'jobs/inspect/steps/0/github-script', kind: 'github-script' },
    { address: 'jobs/inspect/steps/1/workflow-run', kind: 'workflow-run' }
  ]);
  expect(units[0]).toMatchObject({
    ownerPath: workflowPath,
    provider: 'actions/github-script@0123456789012345678901234567890123456789',
    imports: [{ kind: 'require', specifier: 'node:crypto' }],
    unknowns: [{ code: 'embedded-javascript-dynamic-source' }]
  });
  expect(units[1]).toMatchObject({
    ownerPath: workflowPath,
    language: 'shell',
    unknowns: [{ code: 'embedded-shell-import-closure-unresolved' }]
  });
  expect(units.every(({ contentDigest, span }) => (
    /^sha256:[0-9a-f]{64}$/u.test(contentDigest)
      && span.end > span.start
      && span.endLine >= span.startLine
  ))).toBe(true);
});

test('repository module graph consumes embedded imports instead of parsing YAML as TypeScript', () => {
  const graph = compileSecRepositoryModuleGraph({
    files: [workflowPath],
    readSource: (repositoryPath) => repositoryPath === workflowPath ? workflowSource : null,
    readImports: sourceProgramModuleImports
  });

  expect(graph.unresolvedFiles).toEqual([]);
  expect(graph.references).toEqual([
    expect.objectContaining({
      from: workflowPath,
      kind: 'require',
      specifier: 'node:crypto',
      resolvedTarget: null
    })
  ]);
});

test('repository model projects embedded programs through existing entrypoint, capability and unknown contracts', () => {
  const file = Object.freeze({
    path: workflowPath,
    source: workflowSource,
    contentDigest: rawSha256(workflowSource)
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision: sha256([{ path: file.path, contentDigest: file.contentDigest }]),
    files: [file],
    moduleMembership: Object.freeze({
      descriptors: Object.freeze([]),
      graphRoots: Object.freeze([]),
      moduleRoots: Object.freeze([]),
      moduleForPath: () => null
    })
  });

  expect(model.entrypoints).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: 'workflow',
      path: workflowPath,
      name: 'jobs/inspect/steps/0/github-script',
      observationClass: 'unknown'
    }),
    expect.objectContaining({
      kind: 'workflow',
      path: workflowPath,
      name: 'jobs/inspect/steps/1/workflow-run',
      observationClass: 'unknown'
    })
  ]));
  expect(model.capabilities).toEqual(expect.arrayContaining([
    expect.objectContaining({
      path: workflowPath,
      capability: 'dynamic-code',
      operation: 'github-script',
      subject: 'jobs/inspect/steps/0/github-script'
    }),
    expect.objectContaining({
      path: workflowPath,
      capability: 'process',
      operation: 'workflow-run',
      subject: 'jobs/inspect/steps/1/workflow-run'
    })
  ]));
  expect(model.references).toContainEqual(expect.objectContaining({
    path: workflowPath,
    kind: 'import',
    moduleSpecifier: 'node:crypto'
  }));
  expect(model.unknowns).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'embedded-javascript-dynamic-source', path: workflowPath }),
    expect.objectContaining({ code: 'embedded-shell-import-closure-unresolved', path: workflowPath })
  ]));
});

test('embedded frontend never becomes a second ordinary TypeScript scanner', () => {
  expect(sourceProgramModuleImports(
    'src/example.ts',
    "import { value } from './value.ts';\nexport { value };\n"
  )).toEqual([]);
});

test('aliased pinned GitHub action uses retain their real script identity and source span', () => {
  const source = workflowSource.replace('uses: actions/', 'uses: &github_script actions/') + `
  activation:
    steps:
      - uses: *github_script
        with:
          script: |
            core.setOutput('ready', 'true');
`;
  const units = compileSourceProgramEmbeddedWorkflowPrograms({ path: workflowPath, source, contentDigest: rawSha256(source) });
  const activation = units.find(({ address }) => address === 'jobs/activation/steps/0/github-script');
  expect(activation?.provider).toBe('actions/github-script@0123456789012345678901234567890123456789');
  expect(activation?.source).toBe("core.setOutput('ready', 'true');\n");
  expect(source.slice(activation!.span.start, activation!.span.end)).toContain("core.setOutput('ready', 'true')");
  const unresolved = source.replace('*github_script', '*missing_provider');
  expect(() => compileSourceProgramEmbeddedWorkflowPrograms({ path: workflowPath, source: unresolved,
    contentDigest: rawSha256(unresolved) })).toThrow();
});

const aliasedRunSource = `name: aliased-run
on: workflow_dispatch
jobs:
  setup:
    steps:
      - name: install dependencies
        run: &install_dependencies |
          set -euo pipefail
          bun install --frozen-lockfile --ignore-scripts
  consumer:
    steps:
      - name: install consumer dependencies
        shell: bash
        run: *install_dependencies
`;

test('aliased workflow runs retain each occurrence and anchored command provenance in the repository model', () => {
  const file = { path: workflowPath, source: aliasedRunSource, contentDigest: rawSha256(aliasedRunSource) };
  const units = compileSourceProgramEmbeddedWorkflowPrograms(file);
  const addresses = ['jobs/consumer/steps/0/workflow-run', 'jobs/setup/steps/0/workflow-run'];
  const command = 'set -euo pipefail\nbun install --frozen-lockfile --ignore-scripts\n';
  expect(units.map(({ address }) => address)).toEqual(addresses);
  expect(units.map(({ name, provider }) => ({ name, provider }))).toEqual([
    { name: 'install consumer dependencies', provider: 'bash' },
    { name: 'install dependencies', provider: 'runner-default-shell' }
  ]);
  for (const unit of units) {
    expect(unit.source).toBe(command);
    expect(unit.contentDigest).toBe(rawSha256(command));
    expect(aliasedRunSource.slice(unit.span.start, unit.span.end)).toContain(
      'bun install --frozen-lockfile --ignore-scripts'
    );
  }
  expect(units[0]!.span).toEqual(units[1]!.span);
  const plainSource = aliasedRunSource.replace(
    '*install_dependencies', '|\n          set -euo pipefail\n          bun install --frozen-lockfile --ignore-scripts'
  );
  const plainUnits = compileSourceProgramEmbeddedWorkflowPrograms({
    path: workflowPath, source: plainSource, contentDigest: rawSha256(plainSource)
  });
  expect(units.map(({ span: _span, ...unit }) => unit))
    .toEqual(plainUnits.map(({ span: _span, ...unit }) => unit));
  const model = compileRepositorySourceProgramModel({
    sourceRevision: sha256([{ path: file.path, contentDigest: file.contentDigest }]),
    files: [file],
    moduleMembership: {
      descriptors: [], graphRoots: [], moduleRoots: [], moduleForPath: () => null
    }
  });
  for (const address of addresses) {
    expect(model.entrypoints).toContainEqual(expect.objectContaining({
      path: workflowPath, kind: 'workflow', name: address, observationClass: 'unknown'
    }));
    expect(model.capabilities).toContainEqual(expect.objectContaining({
      path: workflowPath, capability: 'process', operation: 'workflow-run', subject: address
    }));
    expect(model.unknowns).toContainEqual(expect.objectContaining({
      path: workflowPath, code: 'embedded-shell-import-closure-unresolved',
      detail: expect.stringContaining(`${address}:`)
    }));
  }
});

test('workflow run aliases reject missing or non-string commands and uses conflicts', () => {
  const compile = (source: string) => compileSourceProgramEmbeddedWorkflowPrograms({
    path: workflowPath, source, contentDigest: rawSha256(source)
  });
  expect(() => compile(aliasedRunSource.replace('*install_dependencies', '*missing_command')))
    .toThrow(/alias does not resolve to one scalar command/u);
  for (const value of ['{ command: unsafe }', '[unsafe]', '42', 'true', 'null']) {
    const source = aliasedRunSource.replace(
      '|\n          set -euo pipefail\n          bun install --frozen-lockfile --ignore-scripts', value
    );
    expect(() => compile(source)).toThrow(/alias does not resolve to one scalar command/u);
  }
  expect(() => compile(aliasedRunSource.replace(
    '        shell: bash', '        uses: actions/github-script@0123456789012345678901234567890123456789'
  ))).toThrow(/cannot contain both uses and run/u);
});
