import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  assertGitReadSessionReceipt,
  assertProductionGitReadSession,
  createAuthorityGitReadSession,
  createAuthorityGitScratchIndexTreeSession,
  createHostGitReadSessionForTests,
  isProductionGitReadSession,
  isTestGitReadSession,
  isolatedGitChildEnvironment
} from '../../../src/adapters/providers/git-read/test/session.ts';
import { openProcessResourceSession } from '../../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  runGitRead
} from '../../../src/adapters/self-hosting/development/tooling/git/git-read.ts';
import { issueOperationRequirementBindingContext } from '../../../src/execution/operation/requirement-binding-context.ts';
import { settleResourcesAsync, withAcquiredResource } from '../../../src/execution/resource-settlement.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../src/execution/operation/semantic.ts';

const TEST_GIT_READ_CONTRACT_DIGEST = `sha256:${'1'.repeat(64)}` as OperationDigest;
const TEST_GIT_READ_PROVIDER_DIGEST = `sha256:${'2'.repeat(64)}` as OperationDigest;

async function withHostGitSession<T>(
  input: Parameters<typeof createHostGitReadSessionForTests>[0],
  run: (session: ReturnType<typeof createHostGitReadSessionForTests>) => Promise<T>
): Promise<T> {
  return withAcquiredResource({
    operationLabel: 'git-host-session-fixture', resourceLabel: 'git-host-session',
    acquire: () => createHostGitReadSessionForTests(input), use: run,
    release: async session => { await session.close?.(); }
  });
}

async function withGitResolution<T>(
  input: Parameters<typeof createAuthorityGitReadSession>[0],
  run: (resolution: ReturnType<typeof createAuthorityGitReadSession>) => Promise<T>
): Promise<T> {
  return withAcquiredResource({
    operationLabel: 'git-authority-session-fixture', resourceLabel: 'git-authority-session',
    acquire: () => createAuthorityGitReadSession(input), use: run,
    release: async resolution => { if (resolution.status === 'ready') await resolution.session.close?.(); }
  });
}

function issueTestGitReadOperation(input: Readonly<{
  maxOutputBytes?: number;
  maxProcesses?: number;
}> = {}): BoundSemanticOperation {
  const plan = compileSemanticOperationPlan({
    operation: 'git-read.host-observation',
    intentDigest: `sha256:${'3'.repeat(64)}` as OperationDigest,
    decisionDigest: TEST_GIT_READ_CONTRACT_DIGEST,
    deadlineAtUnixMs: Date.now() + GIT_READ_OPERATION_BUDGET.deadlineMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: TEST_GIT_READ_CONTRACT_DIGEST
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: GIT_READ_OPERATION_BUDGET.deadlineMs },
      {
        resource: 'input-bytes',
        maximum: GIT_READ_OPERATION_BUDGET.maxStdinBytes
      },
      {
        resource: 'output-bytes',
        maximum: input.maxOutputBytes ?? (
          GIT_READ_OPERATION_BUDGET.maxStdoutBytes
            + GIT_READ_OPERATION_BUDGET.maxStderrBytes
        )
      },
      {
        resource: 'processes',
        maximum: input.maxProcesses ?? GIT_READ_OPERATION_BUDGET.maxProcesses
      }
    ],
    requirements: [{
      id: 'git-read.host-process',
      contractDigest: TEST_GIT_READ_CONTRACT_DIGEST,
      effectKinds: ['process'],
      failureKinds: ['provider.cancelled', 'provider.execution-failed', 'provider.unavailable']
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'git-read.host-process',
    contractDigest: TEST_GIT_READ_CONTRACT_DIGEST,
    providerIdentityDigest: TEST_GIT_READ_PROVIDER_DIGEST
  })]);
}

test('the explicit host test route rejects aggregate argument overflow before starting Git', async () => {
  await withHostGitSession({
    cwd: process.cwd(),
    budget: {
      maxProcesses: 1,
      maxTotalArgumentBytes: 1
    }
  }, async session => {
    const result = await session.run(['status']);
    expect(result).toMatchObject({
      kind: 'unresolved-git-read-session',
      reason: 'argument-budget-exhausted'
    });
    expect(session.processCount).toBe(0);
  });
});

test('terminal host-session admission failures cannot execute or consume additional records', async () => {
  for (const reason of ['argument-budget-exhausted', 'operation-not-permitted'] as const) {
    await withHostGitSession({
      cwd: process.cwd(),
      ...(reason === 'argument-budget-exhausted' ? { budget: { maxTotalArgumentBytes: 1 } } : {})
    }, async session => {
      if (reason === 'operation-not-permitted') {
        expect((await session.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])).kind).toBe('completed');
        expect(session.processCount).toBe(1);
      }
      const processesBefore = session.processCount;
      const commandFailure = await session.run(reason === 'argument-budget-exhausted' ? ['status'] : ['write-tree']);
      expect(commandFailure).toMatchObject({ kind: 'unresolved-git-read-session', reason });
      expect(session.processCount).toBe(processesBefore);
      expect(session.failure).toBe(commandFailure);
      const recordsBefore = session.recordCount;
      expect(session.consumeRecords(1)).toBe(commandFailure);
      expect(session.recordCount).toBe(recordsBefore);
    });
  }
});

test('test sessions cannot cross the production GitRead issuer boundary', async () => {
  await withHostGitSession({ cwd: process.cwd() }, async testSession => {
    expect(isTestGitReadSession(testSession)).toBe(true);
    expect(isProductionGitReadSession(testSession)).toBe(false);
    expect(() => assertProductionGitReadSession(testSession)).toThrow(/production issuer/u);
    const structuralClone = { ...testSession };
    expect(isProductionGitReadSession(structuralClone)).toBe(false);
    expect(() => assertProductionGitReadSession(structuralClone)).toThrow(/production issuer/u);
  });

  await withGitResolution({
    cwd: process.cwd(),
    operation: issueTestGitReadOperation(),
    budget: GIT_READ_OPERATION_BUDGET
  }, async resolution => {
    expect(resolution.status).toBe('ready');
    if (resolution.status === 'ready') {
      expect(isProductionGitReadSession(resolution.session)).toBe(true);
      expect(isTestGitReadSession(resolution.session)).toBe(false);
      expect(() => assertProductionGitReadSession(resolution.session)).not.toThrow();
      const version = await resolution.session.run(['--version']);
      expect(version.kind).toBe('completed');
      expect(resolution.session.processCount).toBe(1);
    }
  });
});

test('semantic projection origin cannot replace the production Git provider capability', async () => {
  const operation = issueTestGitReadOperation();
  await withGitResolution({
    cwd: process.cwd(),
    // A shallow projection copy is only correlation and budget input. The
    // Git owner must still retain the executable/cwd and privately issue the
    // production session below.
    operation: { ...operation },
    budget: GIT_READ_OPERATION_BUDGET
  }, async resolution => {
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    expect(isProductionGitReadSession(resolution.session)).toBe(true);
    expect(isProductionGitReadSession({ ...resolution.session })).toBe(false);
    expect(isProductionGitReadSession({ ...operation } as unknown as typeof resolution.session))
      .toBe(false);
  });
});

test.skipIf(process.platform !== 'win32')(
  'production GitRead shares one AbortSignal with operation admission and child execution',
  async () => {
    const controller = new AbortController();
    await withGitResolution({
      cwd: process.cwd(),
      operation: issueTestGitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET,
      signal: controller.signal
    }, async resolution => {
      expect(resolution.status).toBe('ready');
      if (resolution.status !== 'ready') return;
      controller.abort();
      const result = await resolution.session.run(['--version']);
      expect(result).toMatchObject({
        kind: 'unresolved-git-read-session',
        reason: 'cancelled'
      });
      if (result.kind !== 'unresolved-git-read-session') {
        throw new Error('GitRead cancellation did not produce a typed session failure.');
      }
      expect(resolution.session.processCount).toBe(0);
      expect(resolution.session.consumeRecords(1)).toBe(result);
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'production GitRead consumes aggregate process and output budgets from one bound operation',
  async () => {
    await withGitResolution({
      cwd: process.cwd(),
      operation: issueTestGitReadOperation({ maxProcesses: 1 }),
      budget: { ...GIT_READ_OPERATION_BUDGET, maxProcesses: 2 }
    }, async processResolution => {
      expect(processResolution.status).toBe('ready');
      if (processResolution.status !== 'ready') return;
      expect((await processResolution.session.run(['--version'])).kind).toBe('completed');
      expect(await processResolution.session.run(['--version'])).toMatchObject({
        kind: 'unresolved-git-read-session',
        reason: 'process-budget-exhausted'
      });
      expect(processResolution.session.processCount).toBe(1);
    });

    await withGitResolution({
      cwd: process.cwd(),
      operation: issueTestGitReadOperation({ maxOutputBytes: 1 }),
      budget: GIT_READ_OPERATION_BUDGET
    }, async outputResolution => {
      expect(outputResolution.status).toBe('ready');
      if (outputResolution.status !== 'ready') return;
      expect(await outputResolution.session.run(['--version'])).toMatchObject({
        kind: 'unresolved-git-read-session',
        reason: 'stdout-budget-exhausted'
      });
      expect(outputResolution.session.processCount).toBe(1);
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'borrowed parent process history does not consume the Git-local process delta budget',
  async () => {
    const operation = issueTestGitReadOperation({ maxProcesses: 3 });
    await withAcquiredResource({
      operationLabel: 'borrowed-git-sessions', resourceLabel: 'parent-process-session',
      acquire: () => openProcessResourceSession({
        operation,
        requirementBindingContext: issueOperationRequirementBindingContext({
          operation,
          requirementId: 'git-read.host-process',
          resourceCeilings: operation.plan.execution.aggregateBudgets
        })
      }),
      use: async processSession => {
        await withGitResolution({
          cwd: process.cwd(),
          operation,
          processSession,
          budget: { ...GIT_READ_OPERATION_BUDGET, maxProcesses: 1 }
        }, async first => {
          expect(first.status).toBe('ready');
          if (first.status !== 'ready') throw new Error('First borrowed GitRead session is unavailable.');
          expect((await first.session.run(['--version'])).kind).toBe('completed');
          const firstReceipt = await first.session.close?.();
          if (firstReceipt === undefined) throw new Error('First borrowed GitRead receipt is unavailable.');
          assertGitReadSessionReceipt(firstReceipt, {
            operationIdentityDigest: operation.plan.identity.identityDigest,
            boundAttemptDigest: operation.boundAttemptDigest,
            requirementId: 'git-read.host-process'
          });
          expect(firstReceipt.processSessionOwnership).toBe('borrowed');
          expect(firstReceipt.processCount).toBe(1);
          expect(processSession.processCount).toBe(1);
        });

        await withGitResolution({
          cwd: process.cwd(),
          operation,
          processSession,
          budget: { ...GIT_READ_OPERATION_BUDGET, maxProcesses: 1 }
        }, async second => {
          expect(second.status).toBe('ready');
          if (second.status !== 'ready') throw new Error('Second borrowed GitRead session is unavailable.');
          expect(second.session.processCount).toBe(0);
          expect((await second.session.run(['--version'])).kind).toBe('completed');
          expect(second.session.processCount).toBe(1);
          expect(await second.session.run(['--version'])).toMatchObject({
            kind: 'unresolved-git-read-session',
            reason: 'process-budget-exhausted'
          });
          const secondReceipt = await second.session.close?.();
          if (secondReceipt === undefined) throw new Error('Second borrowed GitRead receipt is unavailable.');
          expect(secondReceipt.processSessionOwnership).toBe('borrowed');
          expect(secondReceipt.processCount).toBe(1);
          expect(processSession.processCount).toBe(2);
          expect(() => processSession.cooperativeDeadlineAtUnixMs()).not.toThrow();
        });

        const transplantedOperation = issueTestGitReadOperation({ maxProcesses: 1 });
        await withGitResolution({
          cwd: process.cwd(),
          operation: transplantedOperation,
          processSession,
          budget: { ...GIT_READ_OPERATION_BUDGET, maxProcesses: 1 }
        }, async rejected => {
          expect(rejected).toMatchObject({
            kind: 'unresolved-git-read-provider',
            status: 'unavailable',
            reason: 'git-operation-admission-unavailable'
          });
          expect(processSession.processCount).toBe(2);
        });
      },
      release: processSession => { processSession.close(); }
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'production Git scratch computes, reads, and materializes one bound tree without generic GitRead mutation',
  async () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-git-scratch-repository-'));
    let scratchRoot: string | undefined;
    let resolution: ReturnType<typeof createAuthorityGitReadSession> | undefined;
    let gitSettled = true;
    let scratchSettled = true;
    let primary: { label: string; error: unknown } | undefined;
    try {
      scratchRoot = mkdtempSync(path.join(tmpdir(), 'sec-git-scratch-index-tree-'));
      const runFixtureGit = (args: readonly string[]): void => {
        const result = spawnSync('git', [...args], {
          cwd: repositoryRoot,
          env: isolatedGitChildEnvironment(process.env),
          encoding: 'utf8',
          windowsHide: true
        });
        if (result.status !== 0) throw new Error(`Git scratch fixture failed: ${result.stderr}`);
      };
      runFixtureGit(['init', '--quiet']);
      writeFileSync(path.join(repositoryRoot, 'package.json'), '{"name":"scratch-fixture"}\n');
      runFixtureGit(['add', '--', 'package.json']);
      gitSettled = false;
      resolution = createAuthorityGitReadSession({
        cwd: repositoryRoot,
        operation: issueTestGitReadOperation(),
        budget: { maxProcesses: 32 }
      });
      if (resolution.status !== 'ready') gitSettled = true;
      expect(resolution.status).toBe('ready');
      if (resolution.status !== 'ready') return;
      {
        const gitSession = resolution.session;
        const indexObservation = await gitSession.run([
          'rev-parse', '--path-format=absolute', '--git-path', 'index'
        ]);
        if (indexObservation.kind !== 'completed' || indexObservation.result.code !== 0) {
          throw new Error('Test could not observe the canonical Git index.');
        }
        const indexPath = Buffer.from(indexObservation.result.stdout).toString('utf8').trim();
        const expectedIndexBlob = await resolution.session.run(['show', ':package.json']);
        if (expectedIndexBlob.kind !== 'completed' || expectedIndexBlob.result.code !== 0) {
          throw new Error('Test could not read package.json from the canonical Git index.');
        }
        copyFileSync(indexPath, path.join(scratchRoot, 'index'));
        mkdirSync(path.join(scratchRoot, 'objects'));

        scratchSettled = false;
        await withAcquiredResource({
          operationLabel: 'git-scratch-fixture', resourceLabel: 'git-scratch-session',
          acquire: () => createAuthorityGitScratchIndexTreeSession({
            gitReadSession: gitSession, scratchRoot: scratchRoot!
          }),
          use: async scratchResolution => {
            expect(scratchResolution.status).toBe('ready');
            if (scratchResolution.status !== 'ready') return;
            const tree = await scratchResolution.session.writeTree();
            expect(tree).toMatchObject({ status: 'ready' });
            if (tree.status !== 'ready') return;
            const blob = await scratchResolution.session.observe(['show', `${tree.value}:package.json`]);
            expect(blob.status).toBe('ready');
            if (blob.status === 'ready') {
              expect(Buffer.compare(
                Buffer.from(blob.value.stdout),
                Buffer.from(expectedIndexBlob.result.stdout)
              )).toBe(0);
            }
            const deltaPath = 'sec-git-scratch-delta.txt';
            const added = await scratchResolution.session.applyIndexDelta({
              additions: [{ path: deltaPath, bytes: Buffer.from('scratch delta\n', 'utf8') }],
              removals: []
            });
            expect(added).toMatchObject({ status: 'ready' });
            if (added.status !== 'ready') return;
            const addedBlob = await scratchResolution.session.observe(['show', `${added.value}:${deltaPath}`]);
            expect(addedBlob.status).toBe('ready');
            if (addedBlob.status === 'ready') {
              expect(Buffer.from(addedBlob.value.stdout).toString('utf8')).toBe('scratch delta\n');
            }
            const restored = await scratchResolution.session.applyIndexDelta({
              additions: [],
              removals: [deltaPath]
            });
            expect(restored).toMatchObject({ status: 'ready' });
            if (restored.status === 'ready') expect(restored.value).toBe(tree.value);
            const materialized = await scratchResolution.session.materializeIndexDelta({
              additions: [{
                path: 'package.json',
                bytes: Buffer.from(expectedIndexBlob.result.stdout)
              }],
              removals: []
            });
            expect(materialized).toMatchObject({ status: 'ready' });
            if (materialized.status === 'ready') {
              expect(materialized.value).toBe(tree.value);
              const materializedBlob = await gitSession.run([
                'show', `${materialized.value}:package.json`
              ]);
              expect(materializedBlob).toMatchObject({ kind: 'completed' });
              if (materializedBlob.kind === 'completed') {
                expect(Buffer.compare(
                  Buffer.from(materializedBlob.result.stdout),
                  Buffer.from(expectedIndexBlob.result.stdout)
                )).toBe(0);
              }
            }
          },
          release: async scratchResolution => {
            const closeFailure = scratchResolution.status === 'ready'
              ? await scratchResolution.session.close() : null;
            // A fulfilled close has released the native capabilities, even if
            // it reports a semantic fence failure. A rejection remains unknown.
            scratchSettled = true;
            expect(closeFailure).toBeNull();
          }
        });

        const directMutation = await resolution.session.run(['write-tree']);
        expect(directMutation).toMatchObject({
          kind: 'unresolved-git-read-session',
          reason: 'operation-not-permitted'
        });
      }
    } catch (error) {
      primary = { label: 'git-scratch-fixture', error };
    } finally {
      await settleResourcesAsync({ primary, cleanup: [
        { label: 'git-read-session', settle: async () => {
          if (resolution?.status === 'ready') {
            await resolution.session.close?.();
            gitSettled = true;
          }
        } },
        { label: 'scratch-root', settle: () => {
          if (gitSettled && scratchSettled && scratchRoot !== undefined) {
            rmSync(scratchRoot, { recursive: true, force: true });
          }
        } },
        { label: 'repository-root', settle: () => {
          if (gitSettled && scratchSettled) rmSync(repositoryRoot, { recursive: true, force: true });
        } }
      ] });
    }
  }, { timeout: 15_000 }
);

test('test or structural GitRead sessions cannot issue scratch effect authority', async () => {
  await withHostGitSession({ cwd: process.cwd() }, async testSession => {
    let scratchSettled = true;
    await withAcquiredResource({
      operationLabel: 'forged-git-scratch-fixture', resourceLabel: 'scratch-root',
      acquire: () => path.resolve(mkdtempSync(path.join(tmpdir(), 'sec-git-scratch-forged-'))),
      use: async scratchRoot => {
        for (const gitReadSession of [testSession, { ...testSession }]) {
          scratchSettled = false;
          await withAcquiredResource({
            operationLabel: 'forged-git-scratch-admission', resourceLabel: 'git-scratch-session',
            acquire: () => createAuthorityGitScratchIndexTreeSession({ gitReadSession, scratchRoot }),
            use: async resolution => {
              expect(resolution).toMatchObject({
                status: 'unavailable', reason: 'production-session-required'
              });
              expect(testSession.processCount).toBe(0);
            },
            release: async resolution => {
              const closeFailure = resolution.status === 'ready' ? await resolution.session.close() : null;
              scratchSettled = true;
              expect(closeFailure).toBeNull();
            }
          });
        }
      },
      release: scratchRoot => {
        if (scratchSettled) rmSync(scratchRoot, { recursive: true, force: true });
      }
    });
  });
});

test('semantic GitRead helpers reject a test transport before any child starts', async () => {
  await withHostGitSession({ cwd: process.cwd() }, async session => {
    const result = await runGitRead(session, ['--version']);
    expect(result.status).toBeNull();
    expect(result.error?.message).toMatch(/production-issued/u);
    expect(session.processCount).toBe(0);
  });
});

test('provider admission preserves an expired parent deadline as a typed reason', async () => {
  await withGitResolution({
    cwd: process.cwd(),
    operation: issueTestGitReadOperation(),
    budget: GIT_READ_OPERATION_BUDGET,
    deadlineAtUnixMs: Date.now() - 1
  }, async resolution => {
    expect(resolution).toMatchObject({
      kind: 'unresolved-git-read-provider',
      status: 'unavailable',
      reason: 'git-session-deadline-exhausted'
    });
  });
});

test('close waits for an admitted child before disposing the GitRead session', async () => {
  await withHostGitSession({ cwd: process.cwd(), budget: { maxProcesses: 2 } }, async session => {
    expect(session.failure).toBeNull();
    const version = await session.run(['--version']);
    expect(version.kind).toBe('completed');
    const command = session.run([
      '--no-pager',
      '-c', 'core.quotepath=false',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false',
      'status', '--porcelain=v1', '-z', '--untracked-files=no'
    ]);
    const close = session.close?.();
    expect(close).toBeInstanceOf(Promise);
    await close;
    const result = await command;
    expect(result.kind).toBe('completed');
    expect(session.processCount).toBe(2);
    expect(session.failure).toBeNull();

    const afterClose = await session.run(['--version']);
    expect(afterClose).toMatchObject({
      kind: 'unresolved-git-read-session',
      reason: 'command-error'
    });
  });
});

test('the host provider resolves Git from its canonical child PATH', async () => {
  let sessionSettled = true;
  await withAcquiredResource({
    operationLabel: 'empty-path-git-fixture', resourceLabel: 'fixture-root',
    acquire: () => mkdtempSync(path.join(tmpdir(), 'sec-git-read-empty-path-')),
    use: async root => {
      sessionSettled = false;
      await withAcquiredResource({
        operationLabel: 'empty-path-git-session', resourceLabel: 'git-host-session',
        acquire: () => createHostGitReadSessionForTests({ cwd: root, source: { PATH: '' } }),
        use: async session => {
          expect(session.gitExecutable).toBe('');
          expect(session.failure).toMatchObject({
            kind: 'unresolved-git-read-session', reason: 'command-error'
          });
        },
        release: async session => { await session.close?.(); sessionSettled = true; }
      });
    },
    release: root => { if (sessionSettled) rmSync(root, { recursive: true, force: true }); }
  });
});

test('the host provider accounts for its physical root observation budget', async () => {
  await withHostGitSession({
    cwd: process.cwd(),
    budget: { maxRootObservedBytes: 1 }
  }, async session => {
    expect(session.rootObservedBytes).toBeGreaterThan(1);
    expect(session.failure).toMatchObject({
      kind: 'unresolved-git-read-session',
      reason: 'root-observation-budget-exhausted'
    });
  });
});

test.skipIf(process.platform !== 'win32')('the retained cwd prevents replacement while the Git session is live', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-read-cwd-'));
  const moved = `${root}-moved`;
  let session: ReturnType<typeof createHostGitReadSessionForTests> | undefined;
  let sessionSettled = false;
  let primary: { label: string; error: unknown } | undefined;
  try {
    session = createHostGitReadSessionForTests({ cwd: root });
    expect(session.failure).toBeNull();
    expect(() => renameSync(root, moved)).toThrow();
    const result = await session.run(['--version']);
    expect(result.kind).toBe('completed');
    expect(session.processCount).toBe(1);
  } catch (error) {
    primary = { label: 'retained-git-cwd-fixture', error };
  } finally {
    await settleResourcesAsync({ primary, cleanup: [
      { label: 'git-host-session', settle: async () => {
        if (session !== undefined) {
          await session.close?.();
          sessionSettled = true;
        }
      } },
      { label: 'fixture-root', settle: () => {
        if (sessionSettled) rmSync(root, { recursive: true, force: true });
      } },
      { label: 'moved-fixture-root', settle: () => {
        if (sessionSettled) rmSync(moved, { recursive: true, force: true });
      } }
    ] });
  }
});

test('a caller parent deadline cannot be extended by a host test session', async () => {
  await withHostGitSession({
    cwd: process.cwd(),
    deadlineAtUnixMs: Date.now() - 1
  }, async session => {
    const result = await session.run(['status']);
    expect(result).toMatchObject({
      kind: 'unresolved-git-read-session',
      reason: 'deadline-exhausted'
    });
    expect(session.processCount).toBe(0);
  });
});

test('budget fields above the canonical envelope are rejected before transport', () => {
  expect(() => createHostGitReadSessionForTests({
    cwd: process.cwd(),
    budget: { maxProcesses: 129 }
  })).toThrow(/canonical ceiling/u);
});

test('invalid parent deadlines are rejected before host transport admission', () => {
  expect(() => createHostGitReadSessionForTests({
    cwd: process.cwd(),
    deadlineAtUnixMs: Number.NaN
  })).toThrow(/non-negative safe integer/u);
});
