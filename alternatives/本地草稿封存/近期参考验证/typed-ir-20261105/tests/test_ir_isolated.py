# Isolated 2026-11-05 reference tests, adapted from exact original Git blob
# d7955794c03e591f424931ef5e5d814e442f6e2a (24 tests).
# Only test_existing_semantic_reference_is_runnable is omitted; 23 tests remain.
import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.gift_ir import elaborate,run_reference,output_lines,GiftError,expr_type,I64_MAX
from src.emit_targets import emit_ts,emit_rust,rust_string
from compile import build,verify_preservation

BASE=json.loads((ROOT/'examples/shared_views.author.json').read_text())
RESEARCH=ROOT/'data/research_model.original.json'

class GiftIRTests(unittest.TestCase):
    def b(self,doc=None):
        doc=copy.deepcopy(BASE if doc is None else doc)
        return elaborate(doc,hashlib.sha256(json.dumps(doc).encode()).hexdigest(),hashlib.sha256(RESEARCH.read_bytes()).hexdigest())
    def err(self,doc,code):
        with self.assertRaises(GiftError) as e:self.b(doc)
        self.assertEqual(e.exception.code,code)
    def test_all_research_is_byte_identical(self):
        p=verify_preservation()
        self.assertEqual(p['counts']['units'],1786)
        self.assertEqual(p['counts']['question_contracts'],568)
        self.assertEqual(p['counts']['research_records'],93)
    # Omitted from this isolated test set: legacy pre-2026-11-05 reference runtime
    # requires older package files that are intentionally not copied into the active repository.
    def test_source_shared_and_duplicates_preserved(self):
        r=run_reference(self.b())
        self.assertEqual([x['id'] for x in r['visibleA']],['a','a','b'])
        self.assertEqual([x['id'] for x in r['visibleB']],['b'])
        self.assertEqual([x['label'] for x in r['enriched']],['primary','primary','secondary'])
    def test_same_ir_two_emitters(self):
        ir=self.b();ts,_=emit_ts(ir);rust,_=emit_rust(ir)
        self.assertIn('const u0:',ts);self.assertIn('fn main()',rust)
        self.assertNotIn('Gift研究',ts)
        self.assertEqual(len(ir['nodes']),6)
        self.assertEqual(len(ir['obligations']),2)
        self.assertEqual(ir['nodes'][2]['method'],'sequence.filter')
    def test_actual_ts_execution(self):
        if not (shutil.which('tsc') and shutil.which('node')):self.skipTest('TS toolchain unavailable')
        with tempfile.TemporaryDirectory() as t:
            x=build(ROOT/'examples/shared_views.author.json',Path(t),True,False)
            self.assertEqual(x['typescript']['status'],'verified')
            self.assertEqual(x['result_counts']['enriched'],3)
    def test_actual_ts_second_domain(self):
        if not (shutil.which('tsc') and shutil.which('node')):self.skipTest('TS toolchain unavailable')
        with tempfile.TemporaryDirectory() as t:
            x=build(ROOT/'examples/two_predicates.author.json',Path(t),True,False)
            self.assertEqual(x['result_counts']['visibleC'],2)
    def test_change_one_use_only(self):
        before=run_reference(self.b());d=copy.deepcopy(BASE)
        next(u for u in d['uses'] if u['id']=='viewA')['arguments']['min']=6
        after=run_reference(self.b(d))
        self.assertEqual(before['visibleB'],after['visibleB'])
        self.assertNotEqual(before['visibleA'],after['visibleA'])
        self.assertEqual([x['id'] for x in after['publicA']],['b'])
    def test_change_shared_definition_affects_all_uses(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['definitions'] if x['id']=='ScoreGate')['predicate']['op']='gt'
        after=run_reference(self.b(d))
        self.assertEqual([x['id'] for x in after['visibleA']],['b'])
        self.assertEqual(after['visibleB'],[])
    def test_type_mismatch_in_port(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['connections'] if x['to']['use']=='viewB')['from']['use']='tags'
        self.err(d,'TYPE')
    def test_duplicated_provider(self):
        d=copy.deepcopy(BASE)
        d['connections'].append(copy.deepcopy(d['connections'][0]))
        self.err(d,'PORT')
    def test_missing_required_link(self):
        d=copy.deepcopy(BASE);d['connections']=d['connections'][1:]
        self.err(d,'PORT')
    def test_cycle_rejected_without_feedback_profile(self):
        d=copy.deepcopy(BASE)
        # Declare a cycle using compatible filter ports.
        for edge in d['connections']:
            if edge['to']['use']=='viewA':edge['from']['use']='viewB'
            if edge['to']['use']=='viewB':edge['from']['use']='viewA'
        self.err(d,'NEEDS_METHOD')
    def test_unknown_semantic_profile_is_needs(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['definitions'] if x['id']=='ScoreGate')['mechanism']='temperature.fuzzy-control'
        self.err(d,'NEEDS_METHOD')
    def test_unknown_expression_operator(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['definitions'] if x['id']=='ScoreGate')['predicate']['op']='magic'
        self.err(d,'OP')
    def test_unknown_field_and_parameter(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['definitions'] if x['id']=='ScoreGate')['predicate']['left']['field'][1]='unrelated'
        self.err(d,'FIELD')
        d=copy.deepcopy(BASE)
        next(x for x in d['uses'] if x['id']=='viewA')['arguments']={'unbound':1}
        self.err(d,'PARAM')
    def test_unknown_requirement_must_not_pass(self):
        d=copy.deepcopy(BASE);d['requirements'].append({'id':'future','kind':'probability-calibration','export':'visibleA'})
        self.err(d,'NEEDS_METHOD')
    def test_unused_definition_payload_is_not_silently_ignored(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['definitions'] if x['id']=='ScoreGate')['rows']=[]
        self.err(d,'SHAPE')
    def test_non_i64_value_rejected(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['definitions'] if x['id']=='Items')['rows'][0]['score']=2**65
        self.err(d,'VALUE')
    def test_sort_is_not_deduplication(self):
        d=copy.deepcopy(BASE)
        # Reordering identical connection records must not change the actual evaluation.
        d['connections'].reverse()
        self.assertEqual(run_reference(self.b(d)),run_reference(self.b()))
    def test_target_identifiers_cannot_inject_code(self):
        d=copy.deepcopy(BASE)
        d['uses'][0]['id']='danger\"; process.exit(1); //'
        for c in d['connections']:
            if c['from']['use']=='store':c['from']['use']=d['uses'][0]['id']
        ir=self.b(d)
        ts,_=emit_ts(ir);rust,_=emit_rust(ir)
        self.assertNotIn('process.exit(1)',ts)
        self.assertNotIn('process.exit(1)',rust)
    def test_unicode_and_escape_rust_literal(self):
        self.assertIn('中文🙂',rust_string('中文🙂'))
        self.assertIn('\\u{8}',rust_string('\b'))
        self.assertNotIn('\n',rust_string('\n'))
        d=copy.deepcopy(BASE);next(x for x in d['definitions'] if x['id']=='Items')['rows'][0]['id']='中文🙂'
        ir=self.b(d)
        ts,_=emit_ts(ir);rs,_=emit_rust(ir)
        self.assertIn('中文🙂',rs)
        self.assertIn('\\ud83d',ts.lower())
    def test_source_maps_cover_every_node_both_targets(self):
        ir=self.b();_,a=emit_ts(ir);_,b=emit_rust(ir)
        self.assertEqual({x['sourceUse'] for x in a},{n['id'] for n in ir['nodes']})
        self.assertEqual({x['sourceUse'] for x in b},{n['id'] for n in ir['nodes']})
    def test_ir_has_no_target_specific_op_or_research_as_primitives(self):
        ir=self.b()
        self.assertEqual(ir['semantics']['dialect'],'gift:finite-ordered-records/1')
        self.assertTrue(all(n['method'].startswith('sequence.') for n in ir['nodes']))
        self.assertEqual(set(ir['records']),{'Item','Tag','Public','Enriched'})
        self.assertEqual(ir['research']['use'],'non-authoritative model-design evidence')
    def test_overflow_reference_is_explicit(self):
        d=copy.deepcopy(BASE)
        next(x for x in d['definitions'] if x['id']=='Items')['rows'][0]['score']=I64_MAX
        f=next(x for x in d['definitions'] if x['id']=='ScoreGate')
        f['predicate']={'op':'gt','left':{'op':'add','left':{'field':['items','score']},'right':{'literal':1}},'right':{'param':'min'}}
        ir=self.b(d)
        with self.assertRaises(GiftError) as e:run_reference(ir)
        self.assertEqual(e.exception.code,'OVERFLOW')

if __name__=='__main__':unittest.main()
