"""Standard-library checks for declared design contracts."""
from pathlib import Path
import tempfile
import unittest
import check_design as d

class DecisionVisibility(unittest.TestCase):
 def owner(self,identity='U001'):
  return '### '+identity+'｜Fixture\n'+''.join('**'+field+'：** body\n' for field in
   ('采用决定','结构与执行落点','实施与验证工作','还需要什么','关闭条件','重开或调整条件'))
 def decisions(self,text):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);folder=root/'docs/状态';folder.mkdir(parents=True)
   (folder/'owner.md').write_text(text,encoding='utf-8')
   return d.decision_model(root)
 def test_fenced_and_commented_owners_and_navigation_are_data(self):
  text='<!--\n'+self.owner('U003')+'[hidden](wrong.md#u999)\n-->\n'
  text+='```md\n'+self.owner('U001')+'[hidden](wrong.md#u998)\n```\n'
  text+='~~~md\n'+self.owner('U002')+'~~~\n'+self.owner()
  rows=self.decisions(text+'`[code](wrong.md#u997)`\n[real](owner.md#u001)\n')
  self.assertEqual([row['id'] for row in rows],['U001'])
  self.assertEqual(rows[0]['line'],len(text.splitlines())-len(self.owner().splitlines())+1)
 def test_visible_duplicates_and_dangling_navigation_still_reject(self):
  with self.assertRaisesRegex(d.DesignError,'Duplicate independent U identity'):
   self.decisions(self.owner()+self.owner())
  with self.assertRaisesRegex(d.DesignError,'U reference lacks its independent owner'):
   self.decisions(self.owner()+'[dangling](missing.md#u999)\n')
 def test_hidden_fields_cannot_satisfy_visible_owner(self):
  text='### U001｜Fixture\n```md\n'+self.owner().split('\n',1)[1]+'```\n'
  with self.assertRaisesRegex(d.DesignError,'missing substantive field'):
   self.decisions(text)
 def test_unclosed_fence_is_not_silently_accepted(self):
  with self.assertRaisesRegex(ValueError,'unclosed fenced'):
   self.decisions(self.owner()+'```md\n')

class Architecture(unittest.TestCase):
 def source(self):return(Path(d.__file__).resolve().parents[2]/d.TABLE_PATH).read_bytes()
 def test_current_table(self):m=d.dependency_model(self.source());self.assertEqual(set(m['dependencies']),d.MODULES)
 def test_missing_module(self):
  s=self.source();s=b'\n'.join(l for l in s.splitlines()if not l.startswith(b'| contracts |'))
  with self.assertRaises(d.DesignError):d.dependency_model(s)
 def test_invalid_reverse_dependency(self):
  s=self.source().replace(b'| semantics | contracts |',b'| semantics | contracts, compiler |')
  with self.assertRaises(d.DesignError):d.dependency_model(s)
 def test_static_cycle(self):
  s=self.source().replace(b'| workspace | contracts |',b'| workspace | contracts, bootstrap |')
  with self.assertRaises(d.DesignError):d.dependency_model(s)
 def test_single_source_svg(self):
  from xml.etree import ElementTree as ET
  m=d.dependency_model(self.source());svg=d.dependency_svg(m);r=ET.fromstring(svg);labels={n.text for n in r.iter()if n.tag.endswith('}text')};self.assertEqual(labels,d.MODULES);self.assertEqual(svg,d.dependency_svg(m))
 def missing_field(self,field):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp)/'SEC';shutil.copytree(root/'docs/状态',r/'docs/状态');(r/Path(d.TABLE_PATH).parent).mkdir(parents=True);(r/d.TABLE_PATH).write_bytes(self.source())
   p=r/'docs/状态/作者与接口.md';text=p.read_text();text=text.replace('**'+field+'：**','**无效字段：**',1);p.write_text(text)
   with self.assertRaisesRegex(d.DesignError,'missing substantive field '+field):d.decision_model(r)
 def test_missing_adoption(self):self.missing_field('采用决定')
 def test_missing_enforcement(self):self.missing_field('结构与执行落点')
 def test_owner_joins_do_not_require_duplicate_status_fields(self):
  root=Path(d.__file__).resolve().parents[2]
  rows=d.decision_model(root)
  self.assertTrue(rows)
  self.assertEqual(len({row['id']for row in rows}),len(rows))
  text=(root/'docs/状态/编译与目标.md').read_text(encoding='utf-8')
  u013=text.split('### U013｜',1)[1].split('### U014｜',1)[0]
  self.assertIn('**采用与责任位置：**',u013)
  self.assertIn('**剩余义务：**',u013)
  self.assertNotIn('**采用决定：**',u013)
 def test_joined_owner_and_remaining_obligations_cannot_be_omitted(self):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  for field,expected in (('采用与责任位置','采用决定'),('剩余义务','实施与验证工作'),
                         ('关闭条件','关闭条件'),('重开或调整条件','重开或调整条件')):
   with self.subTest(field=field),tempfile.TemporaryDirectory()as temp:
    r=Path(temp);shutil.copytree(root/'docs/状态',r/'docs/状态')
    p=r/'docs/状态/编译与目标.md';text=p.read_text(encoding='utf-8')
    start=text.index('### U013｜');end=text.index('### U014｜',start)
    section=text[start:end].replace('**'+field+'：**','**无效字段：**',1)
    p.write_text(text[:start]+section+text[end:],encoding='utf-8')
    with self.assertRaisesRegex(d.DesignError,'U013 missing substantive field '+expected):d.decision_model(r)
 def test_empty_join_is_not_supplied_by_the_next_field(self):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp);shutil.copytree(root/'docs/状态',r/'docs/状态')
   p=r/'docs/状态/编译与目标.md';text=p.read_text(encoding='utf-8')
   start=text.index('**采用与责任位置：**');end=text.index('**规划属性：**',start)
   p.write_text(text[:start]+'**采用与责任位置：**\n\n'+text[end:],encoding='utf-8')
   with self.assertRaisesRegex(d.DesignError,'U013 missing substantive field 采用决定'):d.decision_model(r)
 def test_owner_join_does_not_allow_losing_an_independent_u(self):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp);shutil.copytree(root/'docs/状态',r/'docs/状态')
   p=r/'docs/状态/编译与目标.md';text=p.read_text(encoding='utf-8')
   start=text.index('### U013｜');end=text.index('### U014｜',start)
   p.write_text(text[:start]+text[end:],encoding='utf-8')
   with self.assertRaisesRegex(d.DesignError,'U reference lacks its independent owner: U013'):d.decision_model(r)
 def test_all_decisions_and_graphs(self):
  root=Path(d.__file__).resolve().parents[2]
  v=d.review(root);self.assertEqual(v['decisions'],d.decision_model(root))
  graph_keys=[(g['path'],g['line']) for g in v['mermaid_sources']]
  self.assertTrue(graph_keys);self.assertEqual(len(set(graph_keys)),len(graph_keys))
  for graph in v['mermaid_sources']:
   self.assertTrue(graph['heading']);self.assertEqual(len(graph['sha256']),64)

 def test_new_u_needs_no_numeric_inventory_but_identity_remains_unique(self):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp);shutil.copytree(root/'docs/状态',r/'docs/状态')
   p=r/'docs/状态/编译与目标.md';text=p.read_text(encoding='utf-8')
   start=text.index('### U013｜');end=text.index('### U014｜',start)
   # Reuse a complete owner body; the new identity is outside the old range.
   section=text[start:end].replace('### U013｜','### U900｜',1)
   p.write_text(text+'\n'+section,encoding='utf-8')
   self.assertIn('U900',{row['id']for row in d.decision_model(r)})
   p.write_text(text+'\n'+section+'\n'+section,encoding='utf-8')
   with self.assertRaisesRegex(d.DesignError,'Duplicate independent U identity: U900'):d.decision_model(r)




class DeliverableRoots(unittest.TestCase):
 def test_scope_patterns_use_declared_path_and_scalar_rules(self):
  vectors=[('model/a.json','a.json',False),('model/a.json','MODEL/**',False),
           ('a.json','**/a.json',True),('m/a.json','[ma]/a.json',False),
           ('[ma]/a.json','[ma]/a.json',True),('m/n/a.json','m/**',True),
           ('m/a.json','m/*',True),('m/n/a.json','m/*',False),
           ('m/😀.json','m/?.json',True),('m/ab.json','m/?.json',False)]
  for path,pattern,expected in vectors:
   with self.subTest(path=path,pattern=pattern):
    self.assertEqual(d._scope_pattern_matches(path,pattern),expected)

 @staticmethod
 def load(path):
  import json
  return json.loads(path.read_text(encoding='utf-8'))

 @staticmethod
 def save(path,value):
  import json
  path.parent.mkdir(parents=True,exist_ok=True)
  path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

 def fixture(self,temp):
  import shutil
  source=Path(d.__file__).resolve().parents[2]
  root=Path(temp)
  shutil.copytree(source/'examples/开发成品',root/'examples/开发成品')
  spec=self.load(source/'examples/开发成品/contracts/spec.json')
  # Copy exactly the semantic source consumers, preserving relative locations.
  for definition in spec['definitions'].values():
   semantics=definition.get('body',{}).get('semantics')
   if not semantics:continue
   original=(source/'examples/开发成品/contracts'/semantics['source']).resolve()
   target=root/original.relative_to(source)
   target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copyfile(original,target)
  return root

 def library_root(self,root):
  sample=root/'examples/开发成品'
  project=self.load(sample/'gift.project.json')
  definitions=self.load(sample/'definitions.json')
  matches=[]
  for module_id,relative in project['modules'].items():
   if module_id==definitions['moduleId']:continue
   module=self.load(sample/relative)
   ref=module.get('exports',{}).get('Library',{})
   if module.get('definitions',{}).get(ref.get('definitionId'),{}).get('kind')=='req:composite':
    matches.append((relative,module))
  self.assertEqual(len(matches),1)
  return sample,project,*matches[0]

 def test_missing_registered_public_root(self):
  with tempfile.TemporaryDirectory()as temp:
   root=self.fixture(temp)
   sample,project,relative,module=self.library_root(root)
   del module['exports']['Library']
   self.save(sample/relative,module)
   with self.assertRaisesRegex(d.DesignError,'Library missing registered public author root'):
    d.deliverable_model(root)

 def test_root_must_match_declared_scope_without_host_normalization(self):
  for scope in ({'root':'.','include':['applications.json']},
                {'root':'model','include':['APPLICATIONS.json']},
                {'root':'model/../model'}, {'root':'model//'},
                {'root':'model','include':None}):
   with self.subTest(scope=scope),tempfile.TemporaryDirectory()as temp:
    root=self.fixture(temp);sample=root/'examples/开发成品'
    project=self.load(sample/'gift.project.json')
    project['sourceScopes']=[dict(scope,kind='semantic',editSource={'mode':'file'})]
    self.save(sample/'gift.project.json',project)
    with self.assertRaises(d.DesignError):d.deliverable_model(root)

 def test_ambiguous_public_root_cannot_choose_first_module(self):
  import copy
  with tempfile.TemporaryDirectory()as temp:
   root=self.fixture(temp)
   sample,project,relative,module=self.library_root(root)
   duplicate=copy.deepcopy(module)
   duplicate['moduleId']='example:duplicate-library-root'
   duplicate['namespace']='example.duplicate-library-root'
   duplicate['exports']={'Library':duplicate['exports']['Library']}
   self.save(sample/'extra-roots/duplicate.json',duplicate)
   project['modules'][duplicate['moduleId']]='extra-roots/duplicate.json'
   project['sourceScopes'].append({'root':'extra-roots','kind':'semantic','editSource':{'mode':'file'}})
   self.save(sample/'gift.project.json',project)
   with self.assertRaisesRegex(d.DesignError,'Repeated author root export: Library'):
    d.deliverable_model(root)

 def test_malformed_form_import_keeps_design_diagnostic(self):
  for binding in (None,'forms'):
   with self.subTest(binding=binding),tempfile.TemporaryDirectory()as temp:
    root=self.fixture(temp)
    sample,project,relative,module=self.library_root(root)
    module['imports']['forms']=binding
    self.save(sample/relative,module)
    with self.assertRaisesRegex(d.DesignError,'author form import binding is invalid'):
     d.deliverable_model(root)

 def test_public_root_survives_repartition_and_definition_rename(self):
  import copy
  with tempfile.TemporaryDirectory()as temp:
   root=self.fixture(temp)
   before=d.deliverable_model(root)
   spec=self.load(root/'examples/开发成品/contracts/spec.json')
   rule_id=spec['exports']['Library']['definitionId']
   spec['definitions']['rule:public-library']=spec['definitions'].pop(rule_id)
   spec['exports']['Library']['definitionId']='rule:public-library'
   self.save(root/'examples/开发成品/contracts/spec.json',spec)
   sample,project,relative,module=self.library_root(root)
   identity=module['exports'].pop('Library')['definitionId']
   definition=module['definitions'].pop(identity)
   relocated={key:copy.deepcopy(value)for key,value in module.items()if key not in ('definitions','exports')}
   relocated['moduleId']='example:repartitioned-library'
   relocated['namespace']='example.repartitioned-library'
   relocated['definitions']={'local:chosen':definition}
   relocated['exports']={'Library':{'definitionId':'local:chosen'}}
   # Import aliases are presentation names; the actual imported module owns identity.
   relocated['imports']['libraryForms']=relocated['imports'].pop('forms')
   for term in definition['body']['terms']:
    if term.get('use',{}).get('import')=='forms':term['use']['import']='libraryForms'
   self.save(sample/relative,module)
   self.save(sample/'roots/library-entry.json',relocated)
   project['modules'][relocated['moduleId']]='roots/library-entry.json'
   project['sourceScopes'].append({'root':'roots','kind':'semantic','include':['library-entry.json'],'editSource':{'mode':'file'}})
   self.save(sample/'gift.project.json',project)
   result=d.deliverable_model(root)
   self.assertEqual(result['count'],before['count'])
   self.assertEqual({item['name']for item in result['items']},{item['name']for item in before['items']})
   item=next(item for item in result['items']if item['name']=='Library')
   self.assertEqual(item['model'],'roots/library-entry.json')


if __name__ == "__main__": unittest.main()
