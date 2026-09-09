import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  assertSeedBindingDigest,
  BUILD_INFO_MAXIMUM_BYTES,
  encodeStableSeed, parseStableSeed,
  STABLE_SEED_MAXIMUM_BYTES
} from '../../src/toolchain/typescript/incremental-seed.ts';

const binding = `sha256:${'a'.repeat(64)}` as const;
// An independent wire fixture: field order, newline, content digest and base64
// are declared here, never obtained from the production encoder under test.
const encodeFixture = (payload: Uint8Array, patch: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  schema: 'sec-typescript-incremental-seed-v1', bindingDigest: binding,
  payloadDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
  payloadBase64: Buffer.from(payload).toString('base64'), ...patch
}) + '\n');

test('ordinary and empty build-info payloads preserve the existing wire format and exact bytes', () => {
  for (const payload of [Buffer.alloc(0), Buffer.from('build info'), Uint8Array.of(0, 255, 1, 128)]) {
    const expected = encodeFixture(payload);
    assert.deepEqual(encodeStableSeed(payload, binding), expected);
    assert.deepEqual(parseStableSeed(expected, binding), Buffer.from(payload));
  }
});

test('canonical bytes reject duplicate fields, surplus keys, reordering and extra whitespace', () => {
  const source = encodeFixture(Buffer.from('info')).toString();
  const parsed = JSON.parse(source);
  const reversed = Object.fromEntries(Object.entries(parsed).reverse());
  for (const value of [' '+source, source+'\n', source.slice(0,-1), '\ufeff'+source,
    source.replace('{', '{"schema":"sec-typescript-incremental-seed-v1",'),
    JSON.stringify({...parsed, extra: 0})+'\n', JSON.stringify(reversed)+'\n']) {
    assert.equal(parseStableSeed(Buffer.from(value), binding), null);
  }
});

test('native base64 permissiveness cannot authorize alternate cache spellings', () => {
  for (const text of ['YQ', 'YQ=','YQ===','Y Q==','YQ==\n','YR==','____','!!!!']) {
    assert.equal(parseStableSeed(encodeFixture(Buffer.from('a'), {payloadBase64:text}), binding), null, text);
  }
});

test('valid syntax with a foreign binding or incorrect content digest is a cold miss', () => {
  const source=encodeFixture(Buffer.from('one'));
  assert.equal(parseStableSeed(source, `sha256:${'b'.repeat(64)}`), null);
  assert.equal(parseStableSeed(encodeFixture(Buffer.from('one'), {payloadDigest:`sha256:${'0'.repeat(64)}`}), binding), null);
});

test('invalid encodings and root shapes never produce a usable seed', () => {
  for (const source of [Buffer.from('null'),Buffer.from('[]'),Buffer.from('true'),Buffer.from('{'),
    Uint8Array.of(0xff),Buffer.from('{"schema":0}\n')]) assert.equal(parseStableSeed(source,binding),null);
});

test('only a real canonical string is accepted as a seed binding', () => {
  let converted=false;
  for(const value of [undefined,null,7,BigInt(7),{toString(){converted=true;return binding;}},binding+'\n']) {
    assert.throws(()=>assertSeedBindingDigest(value));
    assert.throws(()=>encodeStableSeed(new Uint8Array(),value as never));
  }
  assert.equal(converted,false);
});

test('serialization uses the native view for both content hashing and encoding', () => {
  const source=Uint8Array.of(9,1,2,9).subarray(1,3);
  Object.defineProperties(source,{byteLength:{value:0},buffer:{get(){assert.fail('buffer shadow');}},
    [Symbol.iterator]:{value(){assert.fail('iterator shadow');}}});
  assert.deepEqual(encodeStableSeed(source,binding),encodeFixture(Uint8Array.of(1,2)));
});

test('decode ignores caller byte-view shadows and owns its returned content', () => {
  const source=encodeFixture(Uint8Array.of(1,2));
  Object.defineProperty(source,'byteLength',{value:0});
  const parsed=parseStableSeed(source,binding)!;
  source.fill(0);
  assert.deepEqual(parsed,Buffer.from([1,2]));
});

test('shared, detached and non-byte views cannot be reused as stable snapshots', () => {
  const shared=new Uint8Array(new SharedArrayBuffer(8));
  assert.throws(()=>encodeStableSeed(shared,binding),/shared/);
  assert.equal(parseStableSeed(shared,binding),null);
  assert.equal(parseStableSeed(new Uint16Array(4) as never,binding),null);
  const detached=Uint8Array.of(1);structuredClone(detached,{transfer:[detached.buffer]});
  assert.equal(parseStableSeed(detached,binding),null);
});

test('payload capacity rejects before copying an oversized caller buffer', () => {
  const source=new Uint8Array(BUILD_INFO_MAXIMUM_BYTES+1),from=Buffer.from;let copied=false;
  Buffer.from=((value: unknown,...args:unknown[])=>{
    if(ArrayBuffer.isView(value) && value.byteLength===source.byteLength) copied=true;
    return Reflect.apply(from,Buffer,[value,...args]);
  }) as typeof Buffer.from;
  try{assert.throws(()=>encodeStableSeed(source,binding),RangeError);assert.equal(copied,false);}
  finally{Buffer.from=from;}
});

test('seed envelope capacity rejects before copying or decoding oversized data', () => {
  const source=new Uint8Array(STABLE_SEED_MAXIMUM_BYTES+1),from=Buffer.from;let copied=false;
  Buffer.from=((value: unknown,...args:unknown[])=>{
    if(ArrayBuffer.isView(value) && value.byteLength===source.byteLength) copied=true;
    return Reflect.apply(from,Buffer,[value,...args]);
  }) as typeof Buffer.from;
  try{assert.equal(parseStableSeed(source,binding),null);assert.equal(copied,false);}
  finally{Buffer.from=from;}
});

test('declared decoded size is rejected before native base64 allocation even within the envelope cap', () => {
  const content='A'.repeat(4*Math.ceil((BUILD_INFO_MAXIMUM_BYTES+2)/3));
  const source=encodeFixture(new Uint8Array(),{payloadBase64:content});
  assert.ok(source.length<=STABLE_SEED_MAXIMUM_BYTES);
  const from=Buffer.from;let decoded=false;
  Buffer.from=((value:unknown,encoding:unknown,...rest:unknown[])=>{
    if(encoding==='base64')decoded=true;
    return Reflect.apply(from,Buffer,[value,encoding,...rest]);
  }) as typeof Buffer.from;
  try{assert.equal(parseStableSeed(source,binding),null);assert.equal(decoded,false);}
  finally{Buffer.from=from;}
});
