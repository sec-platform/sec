import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHash } from 'node:crypto';
import { compilerDependencyManifestAuthority,compilerInputText } from '../../src/toolchain/dependencies/runtime/compiler-input-contract.ts';
const encode=(v:unknown)=>Buffer.from(JSON.stringify(v));
const base={packageManager:'bun@1.2.3',dependencies:{z:'^2',a:'workspace:*'},devDependencies:{tool:'file:../tool'}};
const oldDigest=(v:typeof base)=>{
 const sort=(r:Record<string,string>)=>Object.fromEntries(Object.entries(r??{}).sort(([a],[b])=>a<b?-1:a>b?1:0));
 return createHash('sha256').update(JSON.stringify({dependencies:sort(v.dependencies),devDependencies:sort(v.devDependencies),packageManager:v.packageManager})).digest('hex');
};
test('ordinary manifest fingerprints retain exact original digest grammar',()=>{const r=compilerDependencyManifestAuthority(encode(base));assert.equal(r.dependencyManifestSha256,oldDigest(base));assert.deepEqual(Object.keys(r.dependencies),['a','z']);assert.equal(r.declaredBunVersion,'1.2.3');});
test('manifest records are owned and frozen without prototype-key loss',()=>{
 const b=Buffer.from('{"packageManager":"bun@1.2.3","dependencies":{"__proto__":"1","constructor":"2"}}');const r=compilerDependencyManifestAuthority(b);
 assert.equal(Object.hasOwn(r.dependencies,'__proto__'),true);assert.equal(r.dependencies.__proto__,'1');assert.equal(Reflect.set(r.dependencies,'new','3'),false);assert.ok(Object.isFrozen(r.devDependencies));b.fill(0);assert.equal(r.dependencies.constructor as unknown,'2');
});
test('unknown package fields stay allowed and omitted records stay empty',()=>{const r=compilerDependencyManifestAuthority(encode({packageManager:'bun@1.2.3',scripts:{build:'anything'},private:true}));assert.deepEqual(r.dependencies,{});assert.deepEqual(r.devDependencies,{});});
for(const value of [null,[],1,'deps',true])for(const field of ['dependencies','devDependencies'])test(`${field} rejects ${JSON.stringify(value)}`,()=>assert.throws(()=>compilerDependencyManifestAuthority(encode({packageManager:'bun@1.2.3',[field]:value}))));
for(const value of [null,1,{},[],false])test(`dependency version is not coerced: ${JSON.stringify(value)}`,()=>assert.throws(()=>compilerDependencyManifestAuthority(encode({packageManager:'bun@1.2.3',dependencies:{a:value}}))));
for(const value of [null,[],3,{},'',true])test(`packageManager is not coerced: ${JSON.stringify(value)}`,()=>assert.throws(()=>compilerDependencyManifestAuthority(encode({packageManager:value}))));
for(const source of ['{"packageManager":"bun@1.2.3","packageManager":"bun@9"}', '{"packageManager":"bun@1.2.3","dependencies":{"a":"1","a":"2"}}','{"packageManager":"bun@1.2.3","dependencies":{},"dependencies":{}}'])test('duplicate decisions are rejected before manifest authority is returned',()=>assert.throws(()=>compilerDependencyManifestAuthority(Buffer.from(source)),/exact JSON/));
test('invalid UTF8 cannot become a replacement-character dependency key',()=>{const bytes=Buffer.concat([Buffer.from('{"packageManager":"bun@1.2.3","dependencies":{"'),Buffer.from([255]),Buffer.from('\":\"1\"}}')]);assert.throws(()=>compilerDependencyManifestAuthority(bytes));assert.throws(()=>compilerInputText(Uint8Array.of(255),'input'),/UTF-8/);});
test('native view bounds ignore caller shadowed byte metadata',()=>{const bytes=encode(base);Object.defineProperties(bytes,{byteLength:{value:0},buffer:{get(){assert.fail('getter');}},[Symbol.iterator]:{value(){assert.fail('iterator');}}});assert.equal(compilerDependencyManifestAuthority(bytes).dependencyManifestSha256,oldDigest(base));});
test('valid BOM text is not silently stripped by the general byte decoder',()=>{assert.equal(compilerInputText(Buffer.from('\ufefftext'),'text'),'\ufefftext');assert.throws(()=>compilerDependencyManifestAuthority(Buffer.from('\ufeff'+JSON.stringify(base))));});
test('many valid orderings preserve both sorted projections and original hashes',()=>{for(let i=0;i<128;i++){const pairs=Array.from({length:7},(_,j)=>['p'+((j*3+i)%7),'v'+j]);const deps=Object.fromEntries(pairs);const input={...base,dependencies:deps};assert.equal(compilerDependencyManifestAuthority(encode(input)).dependencyManifestSha256,oldDigest(input));}});
