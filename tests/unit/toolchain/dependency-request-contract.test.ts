import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureRuntimeDependencyInstallRequest } from '../../../src/execution/dependency-install-request.ts';

test('public request preserves caller decisions without forwarding internal controls',()=>{
 const signal=new AbortController().signal;
 const input={deadlineAtUnixMs:5000,installMode:'offline-copy-only' as const,lockTimeoutMs:100,rematerialize:true,signal,
  monotonicNowMs:()=>0};
 const request=captureRuntimeDependencyInstallRequest(input);
 assert.deepEqual(request,{beforeCommit:undefined,deadlineAtUnixMs:5000,installMode:'offline-copy-only',lockTimeoutMs:100,rematerialize:true,signal});
 assert.equal(request.signal,signal);assert.ok(Object.isFrozen(request));
});
