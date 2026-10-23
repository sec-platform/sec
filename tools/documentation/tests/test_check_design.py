"""Standard-library checks for declared design contracts."""
from pathlib import Path
import tempfile
import unittest
import check_design as d

def decision_owner(identity='U001',joined=False):
 fields=(('采用与责任位置','剩余义务','关闭条件','重开或调整条件') if joined else
         ('采用决定','结构与执行落点','实施与验证工作','还需要什么','关闭条件','重开或调整条件'))
 return '### '+identity+'｜Fixture\n'+''.join('**'+field+'：** body\n' for field in fields)

class DecisionVisibility(unittest.TestCase):
 def owner(self,identity='U001'):
  return decision_owner(identity)
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
  for text,missing in ((self.owner()+'[dangling](missing.md#u999)\n','U999'),
                       (decision_owner('U002',joined=True)+'[missing](owner.md#u001)\n','U001')):
   with self.subTest(missing=missing),self.assertRaisesRegex(d.DesignError,'U reference lacks its independent owner: '+missing):
    self.decisions(text)
 def test_hidden_fields_cannot_satisfy_visible_owner(self):
  text='### U001｜Fixture\n```md\n'+self.owner().split('\n',1)[1]+'```\n'
  with self.assertRaisesRegex(d.DesignError,'missing substantive field'):
   self.decisions(text)
 def test_unclosed_fence_is_not_silently_accepted(self):
  with self.assertRaisesRegex(ValueError,'unclosed fenced'):
   self.decisions(self.owner()+'```md\n')

class Architecture(unittest.TestCase):
 def source(self):
  return '''| contracts | 无 | fixture | fixture |
| workspace | contracts | fixture | fixture |
| semantics | contracts | fixture | fixture |
| compiler | semantics | fixture | fixture |
| assurance | compiler | fixture | fixture |
| application | assurance | fixture | fixture |
| execution | contracts | fixture | fixture |
| adapters | application | fixture | fixture |
| entry | workspace | fixture | fixture |
| bootstrap | entry | fixture | fixture |
'''.encode('utf-8')
 def status_fixture(self,temp,joined=False):
  root=Path(temp);folder=root/'docs/状态';folder.mkdir(parents=True)
  path=folder/'owner.md';path.write_text(decision_owner(joined=joined),encoding='utf-8')
  return root,path
 def test_missing_module(self):
  s=self.source();s=b'\n'.join(l for l in s.splitlines()if not l.startswith(b'| contracts |'))
  with self.assertRaisesRegex(d.DesignError,'Missing module rows'):d.dependency_model(s)
 def test_invalid_reverse_dependency(self):
  s=self.source().replace(b'| semantics | contracts |',b'| semantics | contracts, compiler |')
  with self.assertRaisesRegex(d.DesignError,'Pure semantic/execution boundary dependency violated'):d.dependency_model(s)
 def test_static_cycle(self):
  s=self.source().replace(b'| workspace | contracts |',b'| workspace | contracts, bootstrap |')
  with self.assertRaisesRegex(d.DesignError,'Static dependency cycle'):d.dependency_model(s)
 def test_single_source_svg(self):
  from xml.etree import ElementTree as ET
  m=d.dependency_model(self.source());svg=d.dependency_svg(m);r=ET.fromstring(svg)
  labels={n.text for n in r.iter()if n.tag.endswith('}text')}
  self.assertEqual(labels,{'contracts','workspace','semantics','compiler','assurance',
                          'application','execution','adapters','entry','bootstrap'})
  graphics={'circle','rect','path','ellipse','polygon','polyline','line','use'}
  edges=[label.text for marker in r.iter()if marker.tag.rsplit('}',1)[-1] in graphics
         for label in marker if label.tag.endswith('}title')]
  self.assertCountEqual(edges,['workspace imports contracts','semantics imports contracts',
      'compiler imports semantics','assurance imports compiler','application imports assurance',
      'execution imports contracts','adapters imports application','entry imports workspace',
      'bootstrap imports entry'])
  self.assertEqual(svg,d.dependency_svg(m))
 def missing_field(self,field):
  with tempfile.TemporaryDirectory()as temp:
   r,p=self.status_fixture(temp)
   text=p.read_text(encoding='utf-8').replace('**'+field+'：**','**无效字段：**',1);p.write_text(text,encoding='utf-8')
   with self.assertRaisesRegex(d.DesignError,'missing substantive field '+field):d.decision_model(r)
 def test_missing_adoption(self):self.missing_field('采用决定')
 def test_missing_enforcement(self):self.missing_field('结构与执行落点')
 def test_owner_joins_do_not_require_duplicate_status_fields(self):
  with tempfile.TemporaryDirectory()as temp:
   root,_=self.status_fixture(temp,joined=True)
   self.assertEqual(d.decision_model(root),[{'id':'U001','path':'docs/状态/owner.md','line':1}])
 def test_joined_owner_and_remaining_obligations_cannot_be_omitted(self):
  for field,expected in (('采用与责任位置','采用决定'),('剩余义务','实施与验证工作'),
                         ('关闭条件','关闭条件'),('重开或调整条件','重开或调整条件')):
   with self.subTest(field=field),tempfile.TemporaryDirectory()as temp:
    r,p=self.status_fixture(temp,joined=True)
    p.write_text(p.read_text(encoding='utf-8').replace('**'+field+'：**','**无效字段：**',1),encoding='utf-8')
    with self.assertRaisesRegex(d.DesignError,'U001 missing substantive field '+expected):d.decision_model(r)
 def test_empty_join_is_not_supplied_by_the_next_field(self):
  with tempfile.TemporaryDirectory()as temp:
   r,p=self.status_fixture(temp,joined=True)
   p.write_text(p.read_text(encoding='utf-8').replace('**采用与责任位置：** body','**采用与责任位置：**\n'),encoding='utf-8')
   with self.assertRaisesRegex(d.DesignError,'U001 missing substantive field 采用决定'):d.decision_model(r)
 def test_new_u_needs_no_numeric_inventory_but_identity_remains_unique(self):
  with tempfile.TemporaryDirectory()as temp:
   r,p=self.status_fixture(temp,joined=True);text=p.read_text(encoding='utf-8')
   section=decision_owner('U900',joined=True)
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
  with tempfile.TemporaryDirectory()as temp:
   root=self.fixture(temp);sample=root/'examples/开发成品'
   project=self.load(sample/'gift.project.json')
   for scope,message in (({'root':'.','include':['applications.json']},'missing registered public author root'),
                         ({'root':'model','include':['APPLICATIONS.json']},'missing registered public author root'),
                         ({'root':'model/../model'},'Invalid source location'),
                         ({'root':'model//'},'Invalid source location'),
                         ({'root':'model','include':None},'Source scope patterns must be arrays')):
    with self.subTest(scope=scope):
     project['sourceScopes']=[dict(scope,kind='semantic',editSource={'mode':'file'})]
     self.save(sample/'gift.project.json',project)
     with self.assertRaisesRegex(d.DesignError,message):d.deliverable_model(root)

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
  with tempfile.TemporaryDirectory()as temp:
   root=self.fixture(temp)
   sample,project,relative,module=self.library_root(root)
   for binding in (None,'forms'):
    with self.subTest(binding=binding):
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
