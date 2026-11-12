#!/usr/bin/env python3
"""Build a typed Gift IR from a non-code author model, lower into TS and Rust.
No world directory or historical research is imported as compiler semantics.
"""
from __future__ import annotations
import argparse,hashlib,json,subprocess,shutil,sys
from pathlib import Path
from src.gift_ir import elaborate,run_reference,output_lines,GiftError
from src.emit_targets import emit_ts,emit_rust
from src.branch_v2_bridge import lower_author_module_v2
BASE=Path(__file__).resolve().parent
RESEARCH=BASE/'data'/'research_model.original.json'
MAPPING=BASE/'data'/'多维到Gift模型_568项逐项追溯.json'

def verify_preservation():
    research=RESEARCH.read_bytes(); mapping=MAPPING.read_bytes()
    obj=json.loads(research); mp=json.loads(mapping)
    assert hashlib.sha256(research).hexdigest()==mp['source_model_sha256'], 'Research content checksum mismatch'
    expected={'units':1786,'question_contracts':568,'question_joins':1294,'content_bindings':2148,'research_records':93,'theories':62,'legacy_facet_assertions':21676}
    for k,n in expected.items():
        assert len(obj[k])==n, f'Research content count mismatch {k}'
    assert len(mp['question_mapping'])==568, 'Research/IR design tracing incomplete'
    return {'research_sha256':hashlib.sha256(research).hexdigest(), 'mapping_sha256':hashlib.sha256(mapping).hexdigest(), 'counts':expected}

def build(author:Path,dest:Path,run_ts:bool=True,run_rust:bool=True):
    preservation=verify_preservation()
    data=author.read_bytes();doc=json.loads(data)
    # Repository /2 remains the authoritative source; this is a derived lowering.
    branch_lineage=None
    if doc.get('schema')=='gift.author-module/2':
        ir,branch_lineage=lower_author_module_v2(doc,preservation['research_sha256'],source_bytes=data)
    else:
        ir=elaborate(doc,hashlib.sha256(data).hexdigest(),preservation['research_sha256'])
    result=run_reference(ir)
    expected=output_lines(ir,result)
    ts,ts_map=emit_ts(ir)
    rust,rust_map=emit_rust(ir)
    dest.mkdir(parents=True,exist_ok=True)
    (dest/'semantic_ir.json').write_text(json.dumps(ir,ensure_ascii=False,indent=2)+'\n')
    (dest/'program.ts').write_text(ts)
    (dest/'program.rs').write_text(rust)
    (dest/'expected.txt').write_text('\n'.join(expected)+('\n' if expected else ''))
    (dest/'source_map.json').write_text(json.dumps({'ir_sha256':ir['ir_sha256'],'mapping':ts_map+rust_map,
        'branch_lineage':branch_lineage},ensure_ascii=False,indent=2)+'\n')
    if branch_lineage is not None:
        (dest/'branch_correspondence.json').write_text(json.dumps(branch_lineage,ensure_ascii=False,indent=2)+'\n')
    runner={'input':str(author.relative_to(BASE)) if author.is_relative_to(BASE) else str(author),'ir_sha256':ir['ir_sha256'], 'preservation':preservation,
            'result_counts':{k:len(v) for k,v in result.items()},'branch_lineage':branch_lineage,'typescript':'not requested','rust':'not requested'}
    if run_ts:
        if not shutil.which('tsc') or not shutil.which('node'):
            runner['typescript']='not verified: tsc or Node missing'
        else:
            p=subprocess.run(['tsc','--target','ES2022','--module','commonjs','--lib','ES2022,DOM','--outDir',str(dest),'--strict',str(dest/'program.ts')],capture_output=True,text=True)
            if p.returncode:
                raise RuntimeError(f'TypeScript typecheck/emit failure:\n{p.stdout}\n{p.stderr}')
            p=subprocess.run(['node',str(dest/'program.js')],capture_output=True,text=True)
            if p.returncode:raise RuntimeError(f'TS target execution failure:\n{p.stdout}\n{p.stderr}')
            actual=p.stdout.splitlines()
            if actual!=expected:
                raise RuntimeError(f'TS target differs from reference:\nEXPECT {expected}\nACTUAL {actual}')
            runner['typescript']={'status':'verified','rows':len(actual),'node_version':subprocess.check_output(['node','--version'],text=True).strip(), 'tsc_version':subprocess.check_output(['tsc','--version'],text=True).strip()}
    if run_rust:
        if not shutil.which('rustc'):
            runner['rust']='not compiled: rustc not installed in this execution environment'
        else:
            p=subprocess.run(['rustc','--edition','2021','-o',str(dest/'rust_program'),str(dest/'program.rs')],capture_output=True,text=True)
            if p.returncode:raise RuntimeError(f'Rust compile failure:\n{p.stdout}\n{p.stderr}')
            p=subprocess.run([str(dest/'rust_program')],capture_output=True,text=True)
            if p.returncode:raise RuntimeError(f'Rust runtime failure:\n{p.stdout}\n{p.stderr}')
            if p.stdout.splitlines()!=expected:raise RuntimeError('Rust target differs from reference')
            runner['rust']={'status':'verified','rows':len(p.stdout.splitlines()),'rustc_version':subprocess.check_output(['rustc','--version'],text=True).strip()}
    (dest/'verification.json').write_text(json.dumps(runner,ensure_ascii=False,indent=2)+'\n')
    return runner

if __name__=='__main__':
    pa=argparse.ArgumentParser(description='Gift non-code author model -> verified typed IR -> target source')
    pa.add_argument('author',type=Path,help='Non-code author structure JSON')
    pa.add_argument('--out',type=Path,default=BASE/'generated'/'current')
    pa.add_argument('--no-ts',action='store_true')
    pa.add_argument('--no-rust',action='store_true')
    args=pa.parse_args()
    try:
        print(json.dumps(build(args.author,args.out,not args.no_ts,not args.no_rust),ensure_ascii=False,indent=2))
    except (GiftError,RuntimeError,ValueError,AssertionError) as exc:
        print(f'COMPILE FAILED: {exc}',file=sys.stderr)
        sys.exit(1)
