import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compilerDependencyManifestAuthority, compilerInputText } from '../../../src/adapters/toolchain/dependencies/runtime/compiler-input-contract.ts';
const encode=(v:unknown)=>Buffer.from(JSON.stringify(v));
const base={packageManager:'bun@1.2.3',dependencies:{z:'^2',a:'workspace:*'},devDependencies:{tool:'file:../tool'}};
// Fixed legacy SHA-256 vector: sorted dependency records, then packageManager,
// encoded as compact JSON. Expected bytes do not come from the authority.
const baseDigest='cf2b0e80a8678d6375ed75ad62861f11dec265df45ac6fc1d0d3d51d38a9fb0e';
test('manifest records are owned and frozen without prototype-key loss',()=>{
 const b=Buffer.from('{"packageManager":"bun@1.2.3","dependencies":{"__proto__":"1","constructor":"2"}}');const r=compilerDependencyManifestAuthority(b);
 assert.equal(Object.hasOwn(r.dependencies,'__proto__'),true);assert.equal(r.dependencies.__proto__,'1');assert.equal(Reflect.set(r.dependencies,'new','3'),false);assert.ok(Object.isFrozen(r.devDependencies));b.fill(0);assert.equal(r.dependencies.constructor as unknown,'2');
});
test('unknown package fields stay allowed and omitted records stay empty',()=>{const r=compilerDependencyManifestAuthority(encode({packageManager:'bun@1.2.3',scripts:{build:'anything'},private:true}));assert.deepEqual(r.dependencies,{});assert.deepEqual(r.devDependencies,{});});
for(const field of ['dependencies','devDependencies']) {
 // dependencyRecord has distinct null, nonobject and array guards; exercise
 // them once, retaining devDependencies refusal as its separate wiring witness.
 const values=field==='dependencies'?[null,[],1]:[null];
 for(const value of values)test(`${field} rejects ${JSON.stringify(value)}`,()=>assert.throws(()=>compilerDependencyManifestAuthority(encode({packageManager:'bun@1.2.3',[field]:value})),{code:'IMPORT-AUTHORITY-001',message:`Root ${field} must be a dependency object`}));
}
// Member values share one nonstring gate; JSON record admission cannot replace it.
test('dependency version is not coerced: 1',()=>assert.throws(()=>compilerDependencyManifestAuthority(encode({packageManager:'bun@1.2.3',dependencies:{a:1}})),{code:'IMPORT-AUTHORITY-001',message:'Root dependencies.a must be a version string'}));
// A coercible array detects loss of the string gate; empty text detects the regex.
for(const value of [['bun@1.2.3'],''])test(`packageManager is not coerced: ${JSON.stringify(value)}`,()=>assert.throws(()=>compilerDependencyManifestAuthority(encode({packageManager:value})),{code:'IMPORT-AUTHORITY-001',message:'Root packageManager must pin one Bun version exactly'}));
test('duplicate dependency decisions are rejected before manifest authority is returned',()=>assert.throws(()=>compilerDependencyManifestAuthority(Buffer.from('{"packageManager":"bun@1.2.3","dependencies":{"a":"1","a":"2"}}')),/exact JSON/));
test('invalid UTF8 cannot become a replacement-character dependency key',()=>{const bytes=Buffer.concat([Buffer.from('{"packageManager":"bun@1.2.3","dependencies":{"'),Buffer.from([255]),Buffer.from('\":\"1\"}}')]);assert.throws(()=>compilerDependencyManifestAuthority(bytes));assert.throws(()=>compilerInputText(Uint8Array.of(255),'input'),/UTF-8/);});
test('valid BOM text is not silently stripped by the general byte decoder',()=>{assert.equal(compilerInputText(Buffer.from('\ufefftext'),'text'),'\ufefftext');assert.throws(()=>compilerDependencyManifestAuthority(Buffer.from('\ufeff'+JSON.stringify(base))));});
test('manifest identity ignores key order but preserves version association and dependency scope',()=>{
 const vectors=[
  [{...base,dependencies:{a:'workspace:*',z:'^2'}},baseDigest],
  [{...base,dependencies:{a:'^2',z:'workspace:*'}},'d9d65348045ce3e7082dede1debd1d3130c4c149d15f5d455971ae236d31b4b5'],
  [{...base,dependencies:{a:'workspace:*'},devDependencies:{tool:'file:../tool',z:'^2'}},'0b9542f2b38566faca5a42d53559b13fcbb4c7baa2cc13069aee943ea9ebce28']
 ] as const;
 for(const [input,expected] of vectors){
  const result=compilerDependencyManifestAuthority(encode(input));
  assert.equal(result.dependencyManifestSha256,expected);
  assert.equal(result.declaredBunVersion,'1.2.3');
  assert.deepEqual(result.dependencies,input.dependencies);assert.deepEqual(result.devDependencies,input.devDependencies);
 }
});
