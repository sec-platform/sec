import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runCheckAffectedCommand, type CheckAffectedCommandOperations } from '../../src/development/runner/cli.ts';
import type { MaterializedOperationDependencyBootstrapResult } from '../../src/development/runner/dependency-bootstrap.ts';

// This sentinel passes only between explicitly supplied callbacks. It is never
// presented to a production materialization/session owner as an issued grant.
const dependencies = Object.freeze({ fixture: 'callback-passthrough' }) as unknown as MaterializedOperationDependencyBootstrapResult;
function callbacks(patch: Partial<CheckAffectedCommandOperations> = {}): CheckAffectedCommandOperations {
  return { runPlan: async () => 0, ensureDependencies: async () => dependencies,
    handoff: async () => null, runExecution: async () => 0, ...patch };
}

test('plan-only admission does not inspect unused installation or handoff capabilities', async () => {
  const input = { async runPlan() { return 7; },
    get ensureDependencies(): never { assert.fail('installation selected'); throw new Error('unreachable'); },
    get handoff(): never { assert.fail('handoff selected'); throw new Error('unreachable'); },
    get runExecution(): never { assert.fail('execution selected'); throw new Error('unreachable'); }
  };
  assert.equal(await runCheckAffectedCommand(['--plan'], input), 7);
});

test('invalid plan arguments cause no selected callback to run', async () => {
  const input = new Proxy({} as CheckAffectedCommandOperations, { get() { assert.fail('callback read'); } });
  for (const args of [['--wrong'], ['--plan','other'], ['--plan','--plan']]) {
    await assert.rejects(runCheckAffectedCommand(args, input), /accepts only/);
  }
});

test('execution methods remain selected and keep private receiver state across waits', async () => {
  class Operations implements CheckAffectedCommandOperations {
    #prepared = false;
    runPlan = async () => assert.fail('plan selected');
    async ensureDependencies() {
      this.#prepared = true;
      this.handoff = async () => assert.fail('replacement handoff');
      this.runExecution = async () => assert.fail('replacement execution');
      return dependencies;
    }
    async handoff(value: MaterializedOperationDependencyBootstrapResult) {
      assert.equal(this.#prepared,true); assert.equal(value,dependencies); return null;
    }
    async runExecution(value: MaterializedOperationDependencyBootstrapResult) {
      assert.equal(this.#prepared,true); assert.equal(value,dependencies); return 9;
    }
  }
  assert.equal(await runCheckAffectedCommand([],new Operations()),9);
});

test('a completed handoff returns its status without starting local execution', async () => {
  for (const exit of [0,1,256,-1]) {
    assert.equal(await runCheckAffectedCommand([],callbacks({handoff:async()=>exit,
      runExecution:async()=>assert.fail('execution after handoff')})),exit);
  }
});

test('undefined and malformed handoff values never silently fall through into execution', async () => {
  for (const value of [undefined,false,'0',NaN,Infinity,0.5]) {
    await assert.rejects(runCheckAffectedCommand([],callbacks({handoff:async()=>value as never,
      runExecution:async()=>assert.fail('unaccepted handoff executed locally')})),TypeError);
  }
});

test('plan and execution callbacks must report an integer completion', async () => {
  for (const value of [undefined,null,false,'0',NaN,0.5]) {
    await assert.rejects(runCheckAffectedCommand(['--plan'],callbacks({runPlan:async()=>value as never})),TypeError);
    await assert.rejects(runCheckAffectedCommand([],callbacks({runExecution:async()=>value as never})),TypeError);
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

test('missing required execution methods reject before preparing dependencies', async () => {
  let started=false;
  await assert.rejects(runCheckAffectedCommand([],callbacks({ensureDependencies:async()=>{started=true;return dependencies;},
    handoff:undefined})),TypeError);
  assert.equal(started,false);
});
