"""Two separate emitters consuming the SAME verified target-neutral Gift IR.
No eval, no user-controlled identifier interpolation, and no source semantics in UI.
"""
from __future__ import annotations
import json
from .gift_ir import I64_MIN,I64_MAX,GiftError,fail

def maps(ir):
    recs=list(ir['records']); nodes=[n['id'] for n in ir['nodes']]
    rs={name:'R'+str(i) for i,name in enumerate(recs)}
    ns={name:'u'+str(i) for i,name in enumerate(nodes)}
    fs={name:{field:'f'+str(i) for i,field in enumerate(fields)} for name,fields in ir['records'].items()}
    return rs,ns,fs

def ts_lit(value):
    if type(value) is bool:return 'true' if value else 'false'
    if type(value) is int:return str(value)+'n'
    if type(value) is str:return json.dumps(value,ensure_ascii=True)
    fail('LITERAL','Unrepresentable target literal')

def rust_string(value:str)->str:
    result=['\"']
    for ch in value:
        o=ord(ch)
        if ch=='\\':result.append('\\\\')
        elif ch=='\"':result.append('\\\"')
        elif ch=='\n':result.append('\\n')
        elif ch=='\r':result.append('\\r')
        elif ch=='\t':result.append('\\t')
        elif o<32 or o==127:result.append('\\u{'+format(o,'x')+'}')
        else:result.append(ch)
    return ''.join(result)+'\"'

def rs_lit(value):
    if type(value) is bool:return 'true' if value else 'false'
    if type(value) is int:return 'i64::MIN' if value==I64_MIN else str(value)+'_i64'
    if type(value) is str:return rust_string(value)+'.to_string()'
    fail('LITERAL','Unrepresentable target literal')

def emitter_expr(e,roles:dict[str,tuple[str,str]],params:dict, records,fs, target:str):
    if 'field' in e:
        role,field=e['field'];var,kind=roles[role]
        ref=f'{var}.{fs[kind][field]}'
        return ref + ('.clone()' if target=='rust' and records[kind][field]=='Text' else '')
    if 'param' in e:return (ts_lit if target=='ts' else rs_lit)(params[e['param']])
    if 'literal' in e:return (ts_lit if target=='ts' else rs_lit)(e['literal'])
    if 'not' in e:return '(!'+emitter_expr(e['not'],roles,params,records,fs,target)+')'
    if 'and' in e or 'or' in e:
        op=' && ' if 'and' in e else ' || '
        key='and' if 'and' in e else 'or'
        return '('+op.join(emitter_expr(v,roles,params,records,fs,target) for v in e[key])+')'
    a=emitter_expr(e['left'],roles,params,records,fs,target)
    b=emitter_expr(e['right'],roles,params,records,fs,target)
    op=e['op'];ops={'eq':'===','ne':'!==','ge':'>=','gt':'>','le':'<=','lt':'<'} if target=='ts' else {'eq':'==','ne':'!=','ge':'>=','gt':'>','le':'<=','lt':'<'}
    if op in ops:return f'({a} {ops[op]} {b})'
    if op in ('add','sub'):
        if target=='ts':return f'checkedI64({a} {"+" if op=="add" else "-"} {b})'
        return f'({a}).checked_{"add" if op=="add" else "sub"}({b}).expect("I64 arithmetic overflow")'
    fail('OP','No emitter for '+str(op))

def emit_ts(ir):
    records=ir['records'];rs,ns,fs=maps(ir);lines=['/* Generated from verified Gift IR. Do not edit; modify authoritative author structure. */',
        'function checkedI64(n: bigint): bigint { if (n < -(1n << 63n) || n > (1n << 63n) - 1n) throw Error("I64 arithmetic overflow"); return n; }',
        'function encodeText(s: string): string { return Array.from(new TextEncoder().encode(s)).map(x => x.toString(16).padStart(2,"0")).join(""); }',
        'function enc(v: string | bigint | boolean): string { return typeof v === "bigint" ? "i:"+v : typeof v === "boolean" ? "b:"+v : "s:"+encodeText(v); }']
    for rec,schema in records.items():
        fields='; '.join(fs[rec][k]+': '+{'I64':'bigint','Text':'string','Bool':'boolean'}[typ] for k,typ in schema.items())
        lines.append(f'type {rs[rec]} = {{ {fields} }};')
    smap=[];kind_by_use={}
    for node in ir['nodes']:
        start=len(lines)+1
        uid=node['id'];var=ns[uid];record=node['record'];typ=rs[record];method=node['method'];body=node['body'];kind_by_use[uid]=record
        if method=='sequence.literal':
            vals=[]
            for row in body['rows']:
                vals.append('{'+', '.join(fs[record][k]+': '+ts_lit(v) for k,v in row.items())+'}')
            lines.append(f'const {var}: {typ}[] = [{", ".join(vals)}];')
        elif method in ('sequence.filter','sequence.project'):
            role,source=next(iter(node['inputs'].items()))
            srcvar=ns[source];source_record=kind_by_use[source];rvar='r_'+var
            exprrole={role:(rvar,source_record)}
            lines.append(f'const {var}: {typ}[] = [];')
            lines.append(f'for (const {rvar} of {srcvar}) {{')
            if method=='sequence.filter':
                condition=emitter_expr(body['predicate'],exprrole,node['parameters'],records,fs,'ts')
                lines.append(f'  if ({condition}) {var}.push({{...{rvar}}});')
            else:
                fields=', '.join(fs[record][k]+': '+emitter_expr(e,exprrole,node['parameters'],records,fs,'ts') for k,e in body['columns'].items())
                lines.append(f'  {var}.push({{{fields}}});')
            lines.append('}')
        elif method=='sequence.join':
            (role_a,source_a),(role_b,source_b)=list(node['inputs'].items())
            var_a='l_'+var;var_b='r_'+var
            roles={role_a:(var_a,kind_by_use[source_a]),role_b:(var_b,kind_by_use[source_b])}
            lines.extend([f'const {var}: {typ}[] = [];',f'for (const {var_a} of {ns[source_a]}) {{',f'  for (const {var_b} of {ns[source_b]}) {{'])
            condition=emitter_expr(body['predicate'],roles,node['parameters'],records,fs,'ts')
            fields=', '.join(fs[record][k]+': '+emitter_expr(e,roles,node['parameters'],records,fs,'ts') for k,e in body['columns'].items())
            lines.extend([f'    if ({condition}) {var}.push({{{fields}}});','  }','}'])
        else:fail('NEEDS_TARGET','No TS lowering for '+method)
        smap.append({'sourceDefinition':node['definition'],'sourceUse':uid,'target':'ts','startLine':start,'endLine':len(lines)})
    for exp in ir['exports']:
        uid=exp['use'];record=kind_by_use[uid];var=ns[uid];name=exp['name'].encode().hex();parts=[]
        for field,typ in records[record].items():parts.append(f'enc(row.{fs[record][field]})')
        lines.append(f'for (const [index,row] of {var}.entries()) console.log([{json.dumps(name)}, String(index), {", ".join(parts)}].join("\\t"));')
    return '\n'.join(lines)+'\n',smap

def emit_rust(ir):
    records=ir['records'];rs,ns,fs=maps(ir)
    lines=['// Generated from verified Gift IR. Modify the non-code author model instead.',
           'fn encode_text(s: &str) -> String { s.as_bytes().iter().map(|b| format!("{:02x}", b)).collect::<Vec<String>>().join("") }',
           'fn encode_i(v: i64) -> String { format!("i:{}",v) }',
           'fn encode_b(v: bool) -> String { format!("b:{}",v) }',
           'fn encode_s(s: &str) -> String { format!("s:{}",encode_text(s)) }']
    for rec,schema in records.items():
        lines.append('#[derive(Clone,Debug,PartialEq)]')
        fields=', '.join(fs[rec][k]+': '+{'I64':'i64','Bool':'bool','Text':'String'}[typ] for k,typ in schema.items())
        lines.append(f'struct {rs[rec]} {{ {fields} }}')
    lines.append('fn main() {')
    smap=[];kind_by_use={}
    for node in ir['nodes']:
        start=len(lines)+1;uid=node['id'];var=ns[uid];rec=node['record'];typ=rs[rec];method=node['method'];body=node['body'];kind_by_use[uid]=rec
        if method=='sequence.literal':
            vals=[]
            for row in body['rows']:
                vals.append(f'{typ} '+'{'+', '.join(fs[rec][k]+': '+rs_lit(v) for k,v in row.items())+'}')
            lines.append(f'  let {var}: Vec<{typ}> = vec![{", ".join(vals)}];')
        elif method in ('sequence.filter','sequence.project'):
            role,src=next(iter(node['inputs'].items()));src_rec=kind_by_use[src];rvar='r_'+var;roles={role:(rvar,src_rec)}
            lines.extend([f'  let mut {var}: Vec<{typ}> = Vec::new();',f'  for {rvar} in &{ns[src]} {{'])
            if method=='sequence.filter':
                expr=emitter_expr(body['predicate'],roles,node['parameters'],records,fs,'rust')
                lines.append(f'    if {expr} {{ {var}.push({rvar}.clone()); }}')
            else:
                fields=', '.join(fs[rec][k]+': '+emitter_expr(e,roles,node['parameters'],records,fs,'rust') for k,e in body['columns'].items())
                lines.append(f'    {var}.push({typ} {{{fields}}});')
            lines.append('  }')
        elif method=='sequence.join':
            (r1,s1),(r2,s2)=list(node['inputs'].items());lvar='l_'+var;rvar='r_'+var
            roles={r1:(lvar,kind_by_use[s1]),r2:(rvar,kind_by_use[s2])}
            lines.extend([f'  let mut {var}: Vec<{typ}> = Vec::new();',f'  for {lvar} in &{ns[s1]} {{',f'    for {rvar} in &{ns[s2]} {{'])
            expr=emitter_expr(body['predicate'],roles,node['parameters'],records,fs,'rust')
            fields=', '.join(fs[rec][k]+': '+emitter_expr(e,roles,node['parameters'],records,fs,'rust') for k,e in body['columns'].items())
            lines.extend([f'      if {expr} {{ {var}.push({typ} {{{fields}}}); }}','    }','  }'])
        else:fail('NEEDS_TARGET','No Rust lowering for '+method)
        smap.append({'sourceDefinition':node['definition'],'sourceUse':uid,'target':'rust','startLine':start,'endLine':len(lines)})
    for exp in ir['exports']:
        uid=exp['use'];rec=kind_by_use[uid];name=exp['name'].encode().hex()
        lines.append(f'  for (index,row) in {ns[uid]}.iter().enumerate() {{')
        encoded=[]
        for field,typ in records[rec].items():
            var=f'row.{fs[rec][field]}'
            encoded.append({'I64':f'encode_i({var})','Bool':f'encode_b({var})','Text':f'encode_s(&{var})'}[typ])
        lines.append(f'    let cells: Vec<String> = vec![{", ".join(encoded)}];')
        lines.append(f'    println!("{{}}\\t{{}}\\t{{}}", {rust_string(name)},index,cells.join("\\t"));')
        lines.append('  }')
    lines.append('}')
    return '\n'.join(lines)+'\n',smap
