"""Read-only, deliberately bounded adapter for the repository design branch's
`gift.author-module/2` author source -> existing derived finite-record IR.

This does not implement that branch's full Reader, Requirement, MethodSpec or
EngineeringIR. Unsupported semantics fail closed; no invented values/authority.
The upstream Module remains the author source; the result is disposable.
"""
from __future__ import annotations
import hashlib
import json
import re
from typing import Any
from .gift_ir import elaborate, GiftError, fail, I64_MIN, I64_MAX

SOURCE_FORMAT='gift.author-module/2'
SEMANTIC_PROFILE='gift:finite-ordered-records/1'
VERSION='repo-design@81b0f70f610134241ea020a50663744a3818100f'


def canonical_text(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def require_keys(obj: Any, required: set[str], optional: set[str], role: str):
    if not isinstance(obj, dict) or set(obj) - required - optional or not required <= set(obj):
        fail('BRIDGE_SHAPE', f'{role}: expected {sorted(required)}; unexpected/missing keys')


def local_ref(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'local:[A-Za-z_][A-Za-z0-9_]*', value):
        fail('BRIDGE_REF', 'Only exact local:/2 references are supported by this bridge')
    return value[6:]


def i64_type(value: Any) -> bool:
    return isinstance(value,dict) and value == {'tag':'scalar','name':'int','bits':64,'overflow':'checked'}


def typed_scalar(t: Any) -> str:
    if i64_type(t): return 'I64'
    if t == {'tag':'scalar','name':'bool'}:return 'Bool'
    if t == {'tag':'scalar','name':'text'}:return 'Text'
    fail('BRIDGE_SEMANTIC_GAP','Only checked signed 64-bit Int, Bool, Text are represented exactly; unbounded Int is not I64')


def sequence_record(t: Any) -> dict[str,str]:
    require_keys(t,{'tag','item','ordered'},set(),'Type.sequence')
    if t['tag']!='sequence' or t['ordered'] is not True:
        fail('BRIDGE_SEMANTIC_GAP','This method requires explicitly ordered sequence, not set/bag/unknown ordering')
    item=t['item']
    require_keys(item,{'tag','fields','open'},set(),'Type.record')
    if item['tag']!='record' or item['open'] is not False:
        fail('BRIDGE_SEMANTIC_GAP','Open records and other item forms need their own exact method')
    if not item['fields'] or not isinstance(item['fields'],dict):fail('BRIDGE_SHAPE','Record fields are required')
    result={}
    for field,desc in item['fields'].items():
        require_keys(desc,{'type'},set(),'Type.Field')
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*',field):fail('BRIDGE_SHAPE','Invalid declared MemberName')
        result[field]=typed_scalar(desc['type'])
    return result


def literal_value(expr: Any) -> Any:
    require_keys(expr,{'op','type','value'},set(),'Expr.literal')
    if expr['op']!='literal':fail('BRIDGE_METHOD','Nonliteral static input needs qualified runtime value Method')
    tag=typed_scalar(expr['type']);value=expr['value']
    if tag=='I64':
        if not isinstance(value,str) or not re.fullmatch(r'(0|-[1-9][0-9]*|[1-9][0-9]*)',value):
            fail('BRIDGE_NUMBER','Exact Int must be canonical decimal text in this profile')
        val=int(value)
        if val<I64_MIN or val>I64_MAX:fail('BRIDGE_SEMANTIC_GAP','Unbounded/out-of-range Int cannot be lowered as I64')
        return val
    if tag=='Bool':
        if type(value) is not bool:fail('BRIDGE_SHAPE','Bool requires boolean literal')
        return value
    if type(value) is not str or any(0xD800<=ord(c)<=0xDFFF for c in value):
        fail('BRIDGE_SHAPE','Text requires a valid Unicode scalar sequence')
    return value


def literal_rows(value_expr:Any, fields:dict[str,str])->list[dict[str,Any]]:
    require_keys(value_expr,{'op','items'},set(),'Expr.sequence')
    if value_expr['op']!='sequence' or not isinstance(value_expr['items'],list):
        fail('BRIDGE_METHOD','Only direct finite sequences are installed')
    rows=[]
    for item in value_expr['items']:
        require_keys(item,{'op','fields'},set(),'Expr.record')
        if item['op']!='record' or not isinstance(item['fields'],list):fail('BRIDGE_METHOD','Only records are installed')
        row={}
        for field in item['fields']:
            require_keys(field,{'name','value'},set(),'Expr.record.field')
            if not isinstance(field['name'],str) or field['name'] in row:fail('BRIDGE_SHAPE','Duplicate/invalid record field')
            row[field['name']]=literal_value(field['value'])
        if set(row)!=set(fields):fail('BRIDGE_SHAPE','Record field set differs from declared Type')
        for key,kind in fields.items():
            if kind=='Bool' and type(row[key]) is not bool:fail('BRIDGE_SHAPE','Bool field value mismatch')
            if kind=='Text' and type(row[key]) is not str:fail('BRIDGE_SHAPE','Text field value mismatch')
            if kind=='I64' and type(row[key]) is not int:fail('BRIDGE_SHAPE','Int field value mismatch')
        rows.append(row)
    return rows


def predicate_expr(body: Any, functions:dict[str,Any], record:dict[str,str]) -> tuple[str,dict]:
    """Translate a total three-way `std:IntCompare` match only when its truth
    table exactly corresponds to a named comparison. Never infer from names.
    """
    require_keys(body,{'op','value','cases'},set(),'Expr.match')
    if body['op']!='match':fail('BRIDGE_METHOD','No qualified bool-expression bridge for this body')
    value=body['value']
    require_keys(value,{'op','callee','arguments'},set(),'Expr.call')
    if value['op']!='call' or value['callee']!={'op':'symbol','ref':'std:IntCompare'} or len(value['arguments'])!=2:
        fail('BRIDGE_METHOD','Only frozen std:IntCompare interpretation supported')
    truth={}
    for case in body['cases']:
        require_keys(case,{'constructor','binding','body'},set(),'MatchCase')
        k=case['constructor']
        if k not in ('Less','Equal','Greater') or k in truth:fail('BRIDGE_SHAPE','Match is not exhaustive/unique')
        truth[k]=literal_value(case['body'])
        if type(truth[k]) is not bool:fail('BRIDGE_SHAPE','Each branch must return Bool')
    if set(truth)!={'Less','Equal','Greater'}:fail('BRIDGE_SHAPE','Missing comparison case')
    tables={(False,True,True):'ge',(False,False,True):'gt',(True,True,False):'le',(True,False,False):'lt',
            (False,True,False):'eq',(True,False,True):'ne'}
    shape=(truth['Less'],truth['Equal'],truth['Greater'])
    if shape not in tables:fail('BRIDGE_METHOD','Comparison truth pattern not represented by current IR subset')
    def operand(e:Any)->dict:
        if not isinstance(e,dict):fail('BRIDGE_METHOD','Invalid operand')
        if e.get('op')=='field':
            require_keys(e,{'op','record','name'},set(),'Expr.field')
            if e['record']!={'op':'var','name':functions['role']} or record.get(e['name'])!='I64':
                fail('BRIDGE_BIND','Field must reference one bound I64 input role')
            return {'field':[functions['role'],e['name']]}
        if e.get('op')=='literal':
            v=literal_value(e)
            if type(v) is not int:fail('BRIDGE_METHOD','I64 operand expected')
            return {'literal':v}
        fail('BRIDGE_METHOD','Unsupported operand needs a real expression Method')
    return functions['role'], {'op':tables[shape], 'left':operand(value['arguments'][0]), 'right':operand(value['arguments'][1])}


def lower_author_module_v2(module:dict, research_digest:str, *, source_bytes:bytes|None=None)->tuple[dict,dict]:
    """Create a *derived* old-profile execution IR, retaining the /2 source as
    sole author truth. Reference-only, not general /2 Reader qualification.
    """
    require_keys(module,{'schema','moduleId','definitions','exports'}, {'namespace','imports','dialects','annotations'},'AuthorModule')
    if module['schema']!=SOURCE_FORMAT:fail('BRIDGE_VERSION','Only exact gift.author-module/2 source is accepted')
    if module.get('imports') not in (None,{}):fail('BRIDGE_METHOD','Imported ModuleView/lock needs full Linker')
    defs=module['definitions']; exports=module['exports']
    if not isinstance(defs,dict) or not isinstance(exports,dict):fail('BRIDGE_SHAPE','Definitions and exports must be maps')
    if source_bytes is None:source_bytes=canonical_text(module)
    sha=hashlib.sha256(source_bytes).hexdigest()
    legacy={'format':'gift.author-structure/1','identity':{'id':module['moduleId'],'revision':'sha256:'+sha},
            'records':{},'definitions':[],'uses':[],'connections':[],'exports':[],'requirements':[]}
    names={}; defs_used=set(); method_guards=[]; node_origins={}
    def add_source(ref:str)->tuple[str,str]:
        name=local_ref(ref)
        d=defs.get(name)
        if not isinstance(d,dict) or d.get('kind')!='core:constant':fail('BRIDGE_METHOD','Scan requires a local static core:constant with qualified type')
        require_keys(d,{'kind','body'},set(),'Definition')
        body=d['body'];require_keys(body,{'type','value'},set(),'Constant')
        fields=sequence_record(body['type'])
        rec='Record_'+name
        if rec in legacy['records'] and legacy['records'][rec]!=fields:fail('BRIDGE_TYPE','Conflicting record type')
        legacy['records'][rec]=fields
        if name not in names:
            legacy['definitions'].append({'id':name,'revision':sha[:12], 'mechanism':'sequence.literal','output':rec,'rows':literal_rows(body['value'],fields)})
            legacy['uses'].append({'id':name,'definition':name});names[name]=rec
            node_origins[name]={'moduleId':module['moduleId'],'definitionId':name,'kind':'core:constant',
                                'sourceKind':'immutable-finite-snapshot','sourceRef':'local:'+name}
        defs_used.add(name)
        return name,rec
    def visit(q:Any,qname:str)->tuple[str,str]:
        require_keys(q,{'op'}, {'sourceRef','source','predicateRef'},'QueryTerm')
        if q['op']=='scan':
            require_keys(q,{'op','sourceRef'},set(),'QueryTerm.scan')
            return add_source(q['sourceRef'])
        if q['op']=='filter':
            require_keys(q,{'op','source','predicateRef'},set(),'QueryTerm.filter')
            inputid,rec=visit(q['source'],qname+'Input')
            f_name=local_ref(q['predicateRef']);pred=defs.get(f_name)
            if not isinstance(pred,dict) or pred.get('kind')!='core:function':fail('BRIDGE_METHOD','Filter predicate requires a local core:function')
            require_keys(pred,{'kind','body'},set(),'Definition.function')
            b=pred['body'];require_keys(b,{'parameters','returns','body'}, {'effects','termination'},'CoreFunction')
            if b.get('effects')!=[] or b.get('termination')!='total':
                fail('BRIDGE_METHOD','Only pure total predicate Method is admitted')
            if len(b['parameters'])!=1 or b['returns']!={'tag':'scalar','name':'bool'}:
                fail('BRIDGE_TYPE','Predicate must take a single record argument and return Bool')
            param=b['parameters'][0]
            require_keys(param,{'name','type'}, {'mode'},'Param')
            if param.get('mode','in')!='in' or sequence_record({'tag':'sequence','item':param['type'],'ordered':True})!=legacy['records'][rec]:
                fail('BRIDGE_TYPE','Predicate role/type differs from sequence element')
            role,pexpr=predicate_expr(b['body'],{'role':param['name']},legacy['records'][rec])
            uid=qname
            legacy['definitions'].append({'id':uid,'revision':sha[:12],'mechanism':'sequence.filter',
                'output':rec,'inputs':{role:rec},'parameters':{},'predicate':pexpr})
            legacy['uses'].append({'id':uid,'definition':uid})
            legacy['connections'].append({'from':{'use':inputid,'port':'rows'},'to':{'use':uid,'port':role}})
            defs_used.add(f_name)
            node_origins[uid]={'moduleId':module['moduleId'],'definitionId':qname.removeprefix('query_'),
                'predicateDefinitionId':f_name,'kind':'data:query','predicateRef':q['predicateRef'],
                'method':'sequence.filter'}
            method_guards.append({'definition':f_name,'method':'std:IntCompare-exhaustive-match','effects':[],'result':'Bool','numeric':'checked-i64'})
            return uid,rec
        fail('BRIDGE_METHOD','Query operator '+str(q['op'])+' requires its own qualified domain Method')
    for public,selector in exports.items():
        require_keys(selector,{'definitionId'},set(),'LocalExport')
        name=selector['definitionId']; d=defs.get(name)
        if not isinstance(d,dict) or d.get('kind')!='data:query':fail('BRIDGE_METHOD','This bridge only lowers data:query exports')
        require_keys(d,{'kind','body'},set(),'QueryDefinition')
        b=d['body'];require_keys(b,{'inputRefs','algebra','result'}, {'consistencyRef','completenessRef'},'QueryBody')
        if b['inputRefs'] and not isinstance(b['inputRefs'],list):fail('BRIDGE_SHAPE','inputRefs must be list')
        if not isinstance(b['inputRefs'],list):fail('BRIDGE_SHAPE','inputRefs must be list')
        # A snapshot-consumer method cannot pretend open external observations are present.
        # Source occurrences must be explicit in QueryBody; do not infer a source from a display name.
        def collect_scans(t):
            if t.get('op')=='scan':return [t['sourceRef']]
            if t.get('op')=='filter':return collect_scans(t['source'])
            return []
        if b['inputRefs'] != collect_scans(b['algebra']):
            fail('BRIDGE_METHOD','Query inputs must exactly match the supported scan sources')
        outid,rec=visit(b['algebra'],'query_'+name)
        if sequence_record(b['result'])!=legacy['records'][rec]:fail('BRIDGE_TYPE','Query result Type differs from actual rows')
        legacy['exports'].append({'name':public,'use':outid,'port':'rows'});defs_used.add(name)
    if not legacy['exports']:fail('BRIDGE_METHOD','No supported root')
    ir=elaborate(legacy,sha,research_digest)
    ir['source']={'sha256':sha,'origin':'git:gift.author-module/2','writer':'git:design-branch-only','immutable':True}
    ir['branch_admission']={'schema':SOURCE_FORMAT,'source_module':module['moduleId'],
        'method_profile':SEMANTIC_PROFILE,'design_baseline':VERSION,
        'semantics':'derived finite ordered sequence, checked I64 only',
        'source_definitions':sorted(defs_used),'node_origins':node_origins,'method_guards':method_guards,
        'implementation_owner':'TargetProgramIR/qualified-domain-lowering-candidate',
        'not_author_writer':True, 'no_runtime_grant':True,
        'excluded_source_definition_count':len(defs)-len(defs_used)}
    ir['ir_sha256']=hashlib.sha256(canonical_text({k:v for k,v in ir.items() if k!='ir_sha256'})).hexdigest()
    lineage={'source_sha256':sha,'module_id':module['moduleId'],'schema':SOURCE_FORMAT,
             'source_definition_ids':sorted(defs_used),'node_origins':node_origins,'source_unchanged':True,
             'target_ir_sha256':ir['ir_sha256'],'source_bytes_length':len(source_bytes),
             'writer_authority':'branch-native-author-source','target_ir_is_rebuildable':True,
             'bound_profile':SEMANTIC_PROFILE,'unrepresented_source_content_remains_authoritative':True}
    return ir,lineage
