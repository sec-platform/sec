import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  compileSourceProgramEmbeddedWorkflowPrograms,
  sourceProgramModuleImports
} from './embedded-programs.ts';
import { compileRepositoryModel } from './repository.ts';
import { compileRepositoryModuleGraph } from './typescript.ts';

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
  const graph = compileRepositoryModuleGraph({
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
  const model = compileRepositoryModel({
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
