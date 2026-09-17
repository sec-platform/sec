from pathlib import Path, PurePosixPath
import base64,json,subprocess,sys,lzma,hashlib
root=Path.cwd()
encoded=''.join((root/f'.github/sec086-resume-transfer/part{i}.b64').read_text() for i in (1,2,3))
packed=base64.b64decode(encoded,validate=True)
assert hashlib.sha256(packed).hexdigest()=='3a7894f3467aadf764ed431a8b7ea12b068f991ec1d699c2eac99b7b59aa3049'
raw=lzma.decompress(packed)
assert hashlib.sha256(raw).hexdigest()=='ccbafbbd8095248c9c83b4e0d692ac3fcf9b2e8b0e65347ce8e31ca9fbad9115'
plan=json.loads(raw)
def git(*args): return subprocess.check_output(['git',*args],text=True).strip()
assert not git('status','--porcelain')
for name in ('src','tests','knip.json'):
    assert git('rev-parse','HEAD:'+name)==git('rev-parse',plan['base']+':'+name)
def safe(value):
    p=PurePosixPath(value)
    assert not p.is_absolute() and all(s not in ('..','.','') for s in value.split('/'))
    assert value.startswith(('src/','tests/')) or value=='knip.json'
    target=root/p
    for ancestor in (target,*target.parents):
        if ancestor==root: break
        assert not ancestor.is_symlink(),str(ancestor)
    return target
outputs={}; removals=set()
for record in plan['records']:
    old=record['old']; new=record['new']
    original=safe(old).read_bytes() if old is not None else None
    if old is not None: removals.add(safe(old))
    if new is None: continue
    target=safe(new); assert target not in outputs
    if 'content' in record:
        assert old is None
        output=record['content'].encode()
    else:
        lines=original.decode().splitlines(keepends=True); pieces=[]; cursor=0
        for start,end,replacement in record['edits']:
            assert 0<=cursor<=start<=end<=len(lines)
            pieces.extend(lines[cursor:start]); pieces.append(replacement); cursor=end
        pieces.extend(lines[cursor:]); output=''.join(pieces).encode()
    outputs[target]=output
for path in removals: path.unlink()
for path,data in outputs.items():
    path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
subprocess.run(['git','add','-A','--','src','tests','knip.json'],check=True)
subprocess.run(['git','diff','--cached','--check'],check=True)
tree=git('write-tree')
for name in ('src','tests','knip.json'):
    assert git('rev-parse',tree+':'+name)==plan[name],name
print(json.dumps({'tree':tree,'src':plan['src'],'tests':plan['tests'],'knip.json':plan['knip.json'],'records':len(plan['records'])}))
