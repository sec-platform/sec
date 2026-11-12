"""Gift target-neutral, typed, non-code engineering-structure IR reference subset.

This is a *derived* implementation IR, not a new authoritative world GraphIR.
Source author definitions and research evidence remain separately owned.
No executed user callbacks, eval, network or plugin discovery.
"""
from __future__ import annotations
import hashlib
import json
from dataclasses import dataclass
from typing import Any

I64_MIN=-(2**63)
I64_MAX=2**63-1
PRIMITIVES={"I64","Bool","Text"}
SUPPORTED={"sequence.literal","sequence.filter","sequence.project","sequence.join"}

class GiftError(Exception):
    def __init__(self, code:str, message:str):
        super().__init__(f"{code}: {message}")
        self.code=code

def fail(code:str,msg:str):
    raise GiftError(code,msg)

def digest(data:bytes)->str:
    return hashlib.sha256(data).hexdigest()

def canonical(x:Any)->str:
    return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def uniq(vals:list[str],label:str):
    if len(vals)!=len(set(vals)):
        fail('DUPLICATE',f'{label} has duplicate identities')

def exact_keys(x:dict,expected:set[str],label:str,optional:set[str]|None=None):
    if not isinstance(x,dict):fail('SHAPE',f'{label} must be a record')
    unknown=set(x)-(expected|(optional or set()))
    missing=expected-set(x)
    if unknown or missing:fail('SHAPE',f'{label} unknown={sorted(unknown)} missing={sorted(missing)}')

def value_type(v:Any)->str:
    if type(v) is bool:return 'Bool'
    if type(v) is str:
        if any(0xD800<=ord(ch)<=0xDFFF for ch in v):fail('TEXT','Text cannot contain isolated UTF-16 surrogate code points')
        return 'Text'
    if type(v) is int and I64_MIN<=v<=I64_MAX:return 'I64'
    fail('VALUE',f'Unsupported literal, int outside I64 or non-integral value: {repr(v)[:100]}')

def check_value(v:Any,typ:str,label:str):
    if value_type(v)!=typ:fail('TYPE',f'{label}: expected {typ}, got {value_type(v)}')

def expr_type(e:Any,roles:dict[str,str],parameters:dict[str,str],records:dict[str,dict[str,str]])->str:
    if not isinstance(e,dict):fail('EXPR','Expression must be a typed expression node')
    if set(e)=={'field'}:
        a=e['field']
        if not isinstance(a,list) or len(a)!=2 or not all(isinstance(v,str) for v in a):fail('FIELD','Field is [inputRole, fieldName]')
        role,field=a
        if role not in roles:fail('ROLE',f'Unknown input role {role}')
        kind=roles[role]
        if field not in records[kind]:fail('FIELD',f'Unknown field {kind}.{field}')
        return records[kind][field]
    if set(e)=={'param'}:
        if e['param'] not in parameters:fail('PARAM','Unknown parameter '+str(e['param']))
        return parameters[e['param']]
    if set(e)=={'literal'}:
        return value_type(e['literal'])
    if set(e)=={'not'}:
        if expr_type(e['not'],roles,parameters,records)!='Bool':fail('TYPE','not requires Bool')
        return 'Bool'
    if set(e)=={'and'} or set(e)=={'or'}:
        vals=e.get('and',e.get('or'))
        if not isinstance(vals,list) or not vals:fail('EXPR','and/or require nonempty expressions')
        for t in vals:
            if expr_type(t,roles,parameters,records)!='Bool':fail('TYPE','and/or require Bool')
        return 'Bool'
    if set(e)=={'op','left','right'}:
        op=e['op'];a=expr_type(e['left'],roles,parameters,records);b=expr_type(e['right'],roles,parameters,records)
        if op in ('eq','ne'):
            if a!=b:fail('TYPE',f'{op} requires equal operand types')
            return 'Bool'
        if op in ('ge','gt','le','lt'):
            if a!='I64' or b!='I64':fail('TYPE',f'{op} only defined for I64 in this profile')
            return 'Bool'
        if op in ('add','sub'):
            if a!='I64' or b!='I64':fail('TYPE',f'{op} only defined for I64 in this profile')
            return 'I64'
        fail('OP','Uninstalled expression operator '+str(op))
    fail('EXPR','Unsupported expression construct '+str(sorted(e)))

def eval_expr(e:dict,env:dict[str,dict[str,Any]],params:dict[str,Any])->Any:
    if 'field' in e:
        role,field=e['field'];return env[role][field]
    if 'param' in e:return params[e['param']]
    if 'literal' in e:return e['literal']
    if 'not' in e:return not eval_expr(e['not'],env,params)
    if 'and' in e:
        return all(eval_expr(v,env,params) for v in e['and'])
    if 'or' in e:return any(eval_expr(v,env,params) for v in e['or'])
    a=eval_expr(e['left'],env,params);op=e['op']
    b=eval_expr(e['right'],env,params)
    if op=='eq':return a==b
    if op=='ne':return a!=b
    if op=='ge':return a>=b
    if op=='gt':return a>b
    if op=='le':return a<=b
    if op=='lt':return a<b
    if op=='add' or op=='sub':
        r=a+b if op=='add' else a-b
        if not I64_MIN<=r<=I64_MAX:fail('OVERFLOW','I64 arithmetic overflow')
        return r
    fail('OP','Unknown op '+str(op))

def type_model(author:dict)->dict[str,dict[str,str]]:
    types=author['records']
    if not isinstance(types,dict) or not types:fail('RECORD','No record schemas')
    for n,fields in types.items():
        if not isinstance(n,str) or not n:fail('RECORD','Invalid record identity')
        if not isinstance(fields,dict) or not fields:fail('RECORD','Record must contain fields')
        for f,t in fields.items():
            if not isinstance(f,str) or not f or t not in PRIMITIVES:fail('TYPE',f'Unsupported field {n}.{f}: {t}')
    return {name:{field:types[name][field] for field in sorted(types[name])} for name in sorted(types)}

def elaborate(author:dict,source_digest:str,research_digest:str)->dict:
    exact_keys(author,{'format','identity','records','definitions','uses','connections','exports','requirements'},'author')
    if author['format']!='gift.author-structure/1':fail('FORMAT','Unsupported source format')
    exact_keys(author['identity'],{'id','revision'},'identity')
    records=type_model(author)
    definitions={}
    for d in author['definitions']:
        exact_keys(d,{'id','revision','mechanism','output'},'definition',{'inputs','parameters','predicate','columns','rows'})
        if d['id'] in definitions:fail('DUPLICATE','Duplicate definition '+d['id'])
        if not isinstance(d['mechanism'],str) or d['mechanism'] not in SUPPORTED:fail('NEEDS_METHOD','Missing real interpretation of '+str(d['mechanism']))
        if d['output'] not in records:fail('RECORD','Unknown output type '+str(d['output']))
        roles=d.get('inputs',{})
        params=d.get('parameters',{})
        if not isinstance(roles,dict) or not isinstance(params,dict):fail('SHAPE','roles and parameters must be maps')
        for role,kind in roles.items():
            if kind not in records:fail('RECORD',f'Unknown role type {kind}')
        for p,t in params.items():
            if t not in PRIMITIVES:fail('TYPE','Unknown parameter type '+str(t))
        mech=d['mechanism']
        expected_by_method={
          'sequence.literal':{'rows'},
          'sequence.filter':{'inputs','parameters','predicate'},
          'sequence.project':{'inputs','parameters','columns'},
          'sequence.join':{'inputs','parameters','predicate','columns'}
        }
        illegal=(set(d)-{'id','revision','mechanism','output'})-expected_by_method[mech]
        if illegal:fail('SHAPE',f'Definition {d["id"]} has unconsumed fields {sorted(illegal)}')
        if not isinstance(d['revision'],str) or not d['revision']:fail('REVISION','Definition must have nonempty revision')
        if mech=='sequence.literal':
            if roles or params or 'rows' not in d:fail('SOURCE','Literal source must supply rows and no roles/parameters')
            if not isinstance(d['rows'],list):fail('SOURCE','Source rows must be finite list')
            for j,row in enumerate(d['rows']):
                if not isinstance(row,dict) or set(row)!=set(records[d['output']]):fail('RECORD',f'Row {j} schema differs')
                for f,t in records[d['output']].items():check_value(row[f],t,f'Row[{j}].{f}')
        if mech=='sequence.filter':
            if len(roles)!=1 or next(iter(roles.values()))!=d['output']:fail('TYPE','Filter input/output must be identical record sort')
            if expr_type(d.get('predicate'),roles,params,records)!='Bool':fail('TYPE','Filter predicate must be Bool')
        if mech in ('sequence.project','sequence.join'):
            if len(roles)!=(2 if mech=='sequence.join' else 1):fail('ROLE',f'{mech} input arity invalid')
            if mech=='sequence.join' and expr_type(d.get('predicate'),roles,params,records)!='Bool':fail('TYPE','Join predicate must be Bool')
            cols=d.get('columns');out_schema=records[d['output']]
            if not isinstance(cols,dict) or set(cols)!=set(out_schema):fail('TYPE','Output column set must exactly match output record schema')
            for name,exp in cols.items():
                got=expr_type(exp,roles,params,records)
                if got!=out_schema[name]:fail('TYPE',f'Output field {name} wants {out_schema[name]}, got {got}')
        definitions[d['id']]=d
    uses={}
    for u in author['uses']:
        exact_keys(u,{'id','definition'},'use',{'arguments'})
        if not isinstance(u['id'],str) or not u['id']:fail('USE','Use identity must be nonempty text')
        if u['id'] in uses:fail('DUPLICATE','Duplicate use '+u['id'])
        if u['definition'] not in definitions:fail('BIND','Unknown definition '+str(u['definition']))
        d=definitions[u['definition']];args=u.get('arguments',{})
        if not isinstance(args,dict) or set(args)!=set(d.get('parameters',{})):fail('PARAM','Parameter arity differs for '+u['id'])
        for name,v in args.items():check_value(v,d['parameters'][name],f'{u["id"]}.{name}')
        uses[u['id']]=u
    wires={k:{} for k in uses}
    for link in author['connections']:
        exact_keys(link,{'from','to'},'connection')
        s,t=link['from'],link['to']
        exact_keys(s,{'use','port'},'from');exact_keys(t,{'use','port'},'to')
        if s['use'] not in uses or t['use'] not in uses:fail('BIND','Unknown use in connection')
        if s['port']!='rows':fail('PORT','Only named rows output exists in this installed profile')
        consumer=definitions[uses[t['use']]['definition']];role=t['port']
        if role not in consumer.get('inputs',{}):fail('PORT','Unrecognized input port '+str(role))
        if role in wires[t['use']]:fail('PORT','Single provider role connected multiple times')
        kind=definitions[uses[s['use']]['definition']]['output']
        if consumer['inputs'][role]!=kind:fail('TYPE',f'Port mismatch {kind}→{consumer["inputs"][role]}')
        wires[t['use']][role]=s['use']
    for uid,u in uses.items():
        required=set(definitions[u['definition']].get('inputs',{}))
        if set(wires[uid])!=required:fail('PORT',f'Use {uid} missing or extra connections: {required^set(wires[uid])}')
    exports=author['exports']
    if not isinstance(exports,list):fail('EXPORT','Exports must be a list')
    if any(not isinstance(x.get('name'),str) or not x['name'] for x in exports):fail('EXPORT','Export names must be nonempty text')
    uniq([x['name'] for x in exports],'exports')
    for x in exports:
        exact_keys(x,{'name','use','port'},'export')
        if x['use'] not in uses or x['port']!='rows':fail('EXPORT','Unknown export use or port')
    # Exact reachability and cycle detection. No silent feedback interpretation.
    order=[];temporary=set();done=set()
    def walk(uid):
        if uid in done:return
        if uid in temporary:fail('NEEDS_METHOD','Cyclic uses need an explicit state/feedback semantics')
        temporary.add(uid)
        for dependency in wires[uid].values():walk(dependency)
        temporary.remove(uid);done.add(uid);order.append(uid)
    for uid in uses:walk(uid)
    nodes=[]
    for uid in order:
        use=uses[uid];d=definitions[use['definition']]
        nodes.append({'id':uid,'definition':{'id':d['id'],'revision':d['revision']},
            'method':d['mechanism'],'inputs':{r:wires[uid][r] for r in sorted(wires[uid])}, 'parameters':{p:use.get('arguments',{})[p] for p in sorted(use.get('arguments',{}))},
            'record':d['output'], 'body':{k:d[k] for k in ('rows','predicate','columns') if k in d}})
    obligations=[]
    for q in author['requirements']:
        exact_keys(q,{'id','kind','export'},'requirement')
        if q['export'] not in [e['name'] for e in exports]:fail('REQUIREMENT','Unknown subject export')
        # Narrow but actual finite sequence methods preserve order and duplicates.
        if q['kind'] not in ('preserve-order','preserve-duplicates'):
            fail('NEEDS_METHOD','No installed verifier for hard requirement '+str(q['kind']))
        obligations.append({'id':q['id'],'kind':q['kind'],'export':q['export'],
                            'discharge':'by-order-preserving-sequence-method-profile/1'})
    ir={'format':'gift.typed-implementation-ir/1','identity':author['identity'],
        'source':{'sha256':source_digest,'origin':'author/structured-engineering'},
        'research':{'sha256':research_digest,'use':'non-authoritative model-design evidence'},
        'semantics':{'dialect':'gift:finite-ordered-records/1', 'valueTypes':'I64/Bool/Text',
                     'rowKind':'sequence, preserves order and duplicate occurrences',
                     'missingness':'fully enumerated local inputs, not open-world facts'},
        'records':records,'nodes':nodes,'exports':exports,'obligations':obligations}
    ir['ir_sha256']=digest(canonical(ir).encode('utf-8'))
    return ir

def run_reference(ir:dict)->dict[str,list[dict]]:
    vals={}
    for n in ir['nodes']:
        method=n['method']; body=n['body']; inputs={role:vals[uid] for role,uid in n['inputs'].items()};params=n['parameters']
        if method=='sequence.literal':result=[dict(r) for r in body['rows']]
        elif method=='sequence.filter':
            role=next(iter(inputs));result=[dict(r) for r in inputs[role] if eval_expr(body['predicate'],{role:r},params)]
        elif method=='sequence.project':
            role=next(iter(inputs));result=[]
            for r in inputs[role]:result.append({k:eval_expr(e,{role:r},params) for k,e in body['columns'].items()})
        elif method=='sequence.join':
            roles=list(inputs);result=[]
            for left in inputs[roles[0]]:
                for right in inputs[roles[1]]:
                    env={roles[0]:left,roles[1]:right}
                    if eval_expr(body['predicate'],env,params):
                        result.append({k:eval_expr(e,env,params) for k,e in body['columns'].items()})
        else:fail('NEEDS_METHOD','No installed evaluator for '+method)
        vals[n['id']]=result
    return {e['name']:[dict(row) for row in vals[e['use']]] for e in ir['exports']}

def field_encode(v:Any)->str:
    typ=value_type(v)
    if typ=='Bool':return 'b:'+('true' if v else 'false')
    if typ=='I64':return 'i:'+str(v)
    return 's:'+v.encode('utf-8').hex()

def output_lines(ir:dict,result:dict)->list[str]:
    nodes={n['id']:n for n in ir['nodes']}
    lines=[]
    for x in ir['exports']:
        schema=ir['records'][nodes[x['use']]['record']]
        for index,row in enumerate(result[x['name']]):
            lines.append(x['name'].encode().hex()+'\t'+str(index)+'\t'+'\t'.join(field_encode(row[k]) for k in schema))
    return lines
