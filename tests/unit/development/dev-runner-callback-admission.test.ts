import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { PreparedLocalAffectedCheck } from '../../../src/adapters/self-hosting/development/runner/check-runner.ts';
import { runCheckAffectedCommand, type CheckAffectedCommandOperations } from '../../../src/adapters/self-hosting/development/runner/cli.ts';
import type { MaterializedOperationDependencyBootstrapResult } from '../../../src/adapters/self-hosting/development/runner/dependency-bootstrap.ts';

// This sentinel passes only between explicitly supplied callbacks. It is never
// presented to a production materialization/session owner as an issued grant.
const dependencies = Object.freeze({ fixture: 'callback-passthrough' }) as unknown as MaterializedOperationDependencyBootstrapResult;
const preparation = Object.freeze({ needsDependencies: true }) as PreparedLocalAffectedCheck;
function callbacks(patch: Partial<CheckAffectedCommandOperations> = {}): CheckAffectedCommandOperations {
  return { runPlan: async () => 0, prepareExecution: async () => preparation, ensureDependencies: async () => dependencies,
    handoff: async () => null, runExecution: async () => 0, ...patch };
}

test('plan-only admission does not inspect unused installation or handoff capabilities', async () => {
  const input = { async runPlan() { return 7; },
    get prepareExecution(): never { assert.fail('selection executed'); throw new Error('unreachable'); },
    get ensureDependencies(): never { assert.fail('installation selected'); throw new Error('unreachable'); },
    get handoff(): never { assert.fail('handoff selected'); throw new Error('unreachable'); },
    get runExecution(): never { assert.fail('execution selected'); throw new Error('unreachable'); }
  };
  assert.equal(await runCheckAffectedCommand(['--plan'], input), 7);
});

test('a completed handoff returns its status without starting local execution', async () => {
  for (const exit of [0,1,256,-1]) {
    assert.equal(await runCheckAffectedCommand([],callbacks({handoff:async()=>exit,
      runExecution:async()=>assert.fail('execution after handoff')})),exit);
  }
});

test('callback exceptions keep exact identity and stop before the next effect', async () => {
  for (const reason of [undefined,null,false,0,new Error('failed')]) {
    let failed=false;
    try { await runCheckAffectedCommand([],callbacks({ensureDependencies:async()=>{throw reason;},
      handoff:async()=>assert.fail('handoff after preparation failure')})); }
    catch(error) { failed=true; assert.equal(error,reason); }
    assert.equal(failed,true);
  }
});

test('Git-only preparation executes without reading dependency or handoff callbacks', async () => {
  const prepared = Object.freeze({ needsDependencies: false }) as PreparedLocalAffectedCheck;
  const input = { runPlan: async () => assert.fail('plan selected'),
    prepareExecution: async () => prepared,
    get ensureDependencies(): never { assert.fail('unneeded dependency admission'); throw new Error('unreachable'); },
    get handoff(): never { assert.fail('unneeded fresh process'); throw new Error('unreachable'); },
    runExecution: async (dependency: unknown, demand: unknown, selected: unknown) => {
      assert.equal(dependency, undefined); assert.equal(demand, undefined); assert.equal(selected, prepared); return 0;
    }
  };
  assert.equal(await runCheckAffectedCommand([], input), 0);
});

test('source preparation precedes dependency admission and failed selection has no successor effect', async () => {
  const order: string[] = [];
  assert.equal(await runCheckAffectedCommand([], callbacks({
    prepareExecution: async () => { order.push('git'); return preparation; },
    ensureDependencies: async (_demand, selected) => { assert.equal(selected, preparation); order.push('dependencies'); return dependencies; },
    handoff: async (suppliedDependencies, selected) => { assert.equal(suppliedDependencies, dependencies); assert.equal(selected, preparation); order.push('handoff'); return null; },
    runExecution: async (suppliedDependencies, _demand, selected) => { assert.equal(suppliedDependencies, dependencies); assert.equal(selected, preparation); order.push('execute'); return 9; }
  })), 9);
  assert.deepEqual(order, ['git', 'dependencies', 'handoff', 'execute']);
  assert.equal(await runCheckAffectedCommand([], callbacks({ prepareExecution: async () => null,
    ensureDependencies: async () => assert.fail('dependency admission after unavailable selection'),
    runExecution: async () => assert.fail('execution after unavailable selection')
  })), 1);
});
