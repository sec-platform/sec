import copy,hashlib,json,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.branch_v2_bridge import lower_author_module_v2
from src.gift_ir import run_reference, output_lines, GiftError
from src.emit_targets import emit_ts,emit_rust
BASE=json.loads((ROOT/'examples/repo_v2_query.author.json').read_text())
RESEARCH_DIGEST=hashlib.sha256((ROOT/'data/research_model.original.json').read_bytes()).hexdigest()

class BridgeTests(unittest.TestCase):
    def mk(self, obj=None):
        src=copy.deepcopy(BASE if obj is None else obj)
        ir,trace=lower_author_module_v2(src,RESEARCH_DIGEST)
        return ir,trace
    def err(self, obj, code):
        with self.assertRaises(GiftError) as e:self.mk(obj)
        self.assertEqual(e.exception.code,code)
    def test_v2_source_is_accepted_without_rewriting_author(self):
        b=copy.deepcopy(BASE);ir,trace=self.mk(b)
        self.assertEqual(b,BASE)
        self.assertEqual(ir['source']['origin'],'git:gift.author-module/2')
        self.assertTrue(ir['branch_admission']['not_author_writer'])
        self.assertTrue(trace['target_ir_is_rebuildable'])
        self.assertEqual(trace['node_origins']['query_Visible']['definitionId'],'Visible')
        self.assertEqual(trace['node_origins']['Rows']['sourceRef'],'local:Rows')
    def test_duplicate_rows_and_boundary_are_preserved(self):
        out=run_reference(self.mk()[0])['Visible']
        self.assertEqual([x['score'] for x in out],[5,5,6])
        self.assertEqual([x['label'] for x in out],['same','same','higher'])
    def test_both_emitters_use_same_ir(self):
        ir,_=self.mk();ts,m1=emit_ts(ir);rs,m2=emit_rust(ir)
        self.assertIn('checkedI64',ts);self.assertIn('fn main()',rs)
        self.assertEqual({x['sourceUse'] for x in m1},{x['sourceUse'] for x in m2})
        self.assertEqual(len(ir['nodes']),2)
    def test_real_typescript_execution(self):
        if not shutil.which('tsc') or not shutil.which('node'):self.skipTest('toolchain missing')
        ir,_=self.mk()
        with tempfile.TemporaryDirectory() as td:
            t=Path(td);src=t/'program.ts';src.write_text(emit_ts(ir)[0])
            subprocess.run(['tsc','--target','ES2022','--module','commonjs','--lib','ES2022,DOM','--outDir',td,str(src)],check=True,capture_output=True,text=True)
            observed=subprocess.run(['node',str(t/'program.js')],check=True,capture_output=True,text=True).stdout.splitlines()
            self.assertEqual(observed,output_lines(ir,run_reference(ir)))
    def test_change_exact_policy_affects_results_not_source(self):
        b=copy.deepcopy(BASE)
        match=b['definitions']['Qualifies']['body']['body']
        match['cases'][1]['body']['value']=False # Equal: true -> false (>= -> >)
        ir,_=self.mk(b)
        self.assertEqual([x['score'] for x in run_reference(ir)['Visible']],[6])
        self.assertNotEqual(ir['ir_sha256'],self.mk()[0]['ir_sha256'])
    def test_reject_unsupported_schema(self):
        b=copy.deepcopy(BASE);b['schema']='gift.author-structure/1';self.err(b,'BRIDGE_VERSION')
    def test_reject_unbounded_int_narrowing(self):
        b=copy.deepcopy(BASE)
        b['definitions']['Rows']['body']['type']['item']['fields']['score']['type']={'tag':'scalar','name':'int'}
        self.err(b,'BRIDGE_SEMANTIC_GAP')
    def test_reject_out_of_range_exact_integer(self):
        b=copy.deepcopy(BASE)
        b['definitions']['Rows']['body']['value']['items'][0]['fields'][0]['value']['value']=str(2**65)
        self.err(b,'BRIDGE_SEMANTIC_GAP')
    def test_reject_wrong_ordering(self):
        b=copy.deepcopy(BASE);b['definitions']['Rows']['body']['type']['ordered']=False
        self.err(b,'BRIDGE_SEMANTIC_GAP')
    def test_reject_missing_source(self):
        b=copy.deepcopy(BASE);b['definitions']['Visible']['body']['inputRefs']=[]
        self.err(b,'BRIDGE_METHOD')
    def test_reject_nonlocal_sources_and_imports(self):
        b=copy.deepcopy(BASE);b['definitions']['Visible']['body']['algebra']['source']['sourceRef']='outside:Rows'
        self.err(b,'BRIDGE_METHOD')
        b=copy.deepcopy(BASE);b['imports']={'foo':{'mode':'locked','moduleId':'module:foo'}}
        self.err(b,'BRIDGE_METHOD')
    def test_reject_effectful_predicate(self):
        b=copy.deepcopy(BASE);b['definitions']['Qualifies']['body']['effects']=[{'class':'io'}]
        self.err(b,'BRIDGE_METHOD')
    def test_reject_non_exhaustive_comparison(self):
        b=copy.deepcopy(BASE);b['definitions']['Qualifies']['body']['body']['cases'].pop()
        self.err(b,'BRIDGE_SHAPE')
    def test_reject_fake_name_based_method(self):
        b=copy.deepcopy(BASE);b['definitions']['Qualifies']['body']['body']={'op':'var','name':'row'}
        self.err(b,'BRIDGE_SHAPE')
    def test_reject_unsupported_query_operators(self):
        b=copy.deepcopy(BASE);b['definitions']['Visible']['body']['algebra']={
            'op':'union','inputs':[{'op':'scan','sourceRef':'local:Rows'},{'op':'scan','sourceRef':'local:Rows'}],'distinct':False}
        self.err(b,'BRIDGE_METHOD')
    def test_research_dataset_digest_is_unchanged(self):
        ir,_=self.mk();self.assertEqual(ir['research']['sha256'],RESEARCH_DIGEST)
        self.assertEqual(RESEARCH_DIGEST,'c64d0bc4452a24e36f83fbfd27d22fe64dec4259666be7cbdac7b44a806b157e')

if __name__=='__main__':unittest.main()
