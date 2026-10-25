"""Source checks and explicit sealed-package checks have different input obligations."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import check_docs
import build_html
import check_design
import source_inventory as s
from .test_check_documentation_identity import declaration


class ProjectionModes(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix='gift-projection-modes-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / '.documentation').mkdir()
        (self.root / 'docs/产品').mkdir(parents=True)
        (self.root / 'examples').mkdir()
        self.authority = self.root / 'docs/产品/产品要求与工作约束.md'
        self.authority.write_text('### REQ001｜Requirement\n\nOriginal body.\n', encoding='utf-8')
        self.write(s.BASELINE_PATH, declaration(['.documentation', 'docs', 'examples']))
        self.write('.documentation/documents.json', {
            'schema': 'sec.documentation-identity/1', 'scope': 'fixture', 'documents': [{
                'document_id': 'urn:uuid:00000000-0000-4000-8000-000000000001',
                'path': 'docs/产品/产品要求与工作约束.md'}]})
        self.write('.documentation/known-regressions.json', {'scope': 'fixture', 'checks': []})
        # This fixture isolates projection admission; architecture closure is tested by its owner.
        review = patch.object(check_design, 'review', return_value={
            'modules': 0, 'static_edges': 0, 'decisions': [], 'mermaid_sources': [],
            'deliverables': {'count': 0, 'target_semantic_validation': 'not-performed'}})
        review.start()
        self.addCleanup(review.stop)

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')

    def test_verification_captures_once_and_reobserves_once(self):
        native=s.read_ordinary;reads=[]
        def read(root,name):reads.append(name);return native(root,name)
        with patch.object(s,'read_ordinary',side_effect=read):
            check_docs.verify(self.root)
        self.assertEqual(reads.count('docs/产品/产品要求与工作约束.md'),2)

    def test_semantic_consumers_share_original_bytes_and_final_drift_is_rejected(self):
        original=self.authority.read_bytes()
        def changed(root,*,captured):
            self.authority.write_text('### REQ001｜Requirement\n\nChanged during checks.\n',encoding='utf-8')
            self.assertEqual(s.source_bytes(root,self.authority,captured),original)
            return {'modules':0,'static_edges':0,'decisions':[],'mermaid_sources':[],
                    'deliverables':{'count':0,'target_semantic_validation':'not-performed'}}
        with patch.object(check_design,'review',side_effect=changed):
            with self.assertRaisesRegex(ValueError,'source changed during capture'):check_docs.verify(self.root)

    def test_source_check_neither_requires_nor_opens_local_projections(self):
        before = check_docs.verify(self.root)['source_set_sha256']
        for name in s.PROJECTION_PATHS:
            (self.root / name).write_bytes(b'\xffbroken derived bytes')
        self.assertEqual(check_docs.verify(self.root)['source_set_sha256'], before)
        self.authority.write_text('### REQ001｜Requirement\n\nChanged body.\n', encoding='utf-8')
        self.assertNotEqual(check_docs.verify(self.root)['source_set_sha256'], before)
        for name in s.PROJECTION_PATHS:
            self.assertEqual((self.root / name).read_bytes(), b'\xffbroken derived bytes')
        (self.root / 'README.md').write_text('# Reader root marker\n', encoding='utf-8')
        args = SimpleNamespace(sealed=False, diagrams='source', diagram_cache=None,
                               max_file_bytes=1_000_000, max_total_bytes=2_000_000)
        captured = build_html.capture(self.root, args)
        self.assertTrue(s.PROJECTION_PATHS.isdisjoint(captured))
        self.assertEqual(captured['docs/产品/产品要求与工作约束.md'], self.authority.read_bytes())

    def test_sealed_check_requires_both_exact_projections(self):
        with self.assertRaisesRegex(ValueError, 'sealed .*missing'):
            check_docs.verify(self.root, sealed=True)
        s.refresh_source_manifest(self.root)
        expected = check_docs.verify(self.root, sealed=True)['source_set_sha256']
        self.assertEqual(expected, check_docs.verify(self.root)['source_set_sha256'])
        for name in s.PROJECTION_PATHS:
            original = (self.root / name).read_bytes()
            (self.root / name).unlink()
            with self.subTest(missing=name), self.assertRaisesRegex(ValueError, 'sealed .*missing'):
                check_docs.verify(self.root, sealed=True)
            (self.root / name).write_bytes(original)
        self.authority.write_text('### REQ001｜Requirement\n\nChanged body.\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'sealed .*stale'):
            check_docs.verify(self.root, sealed=True)

    def test_sealed_check_rejects_forged_projection_bytes(self):
        s.refresh_source_manifest(self.root)
        self.write(s.MANIFEST_PATH, {'schema': s.MANIFEST_SCHEMA, 'members': [], 'source_set_sha256': '0' * 64})
        with self.assertRaisesRegex(ValueError, 'sealed source projection'):
            check_docs.verify(self.root, sealed=True)

    def example(self):
        sample = self.root / 'examples/sample'
        (sample / 'contracts').mkdir(parents=True)
        (self.root / 'docs/产品/规则.md').write_text('## Behavior\n\nActual rule.\n', encoding='utf-8')
        registry=s.load(self.root/'.documentation/documents.json')
        registry['documents'].append({'document_id':'urn:uuid:00000000-0000-4000-8000-000000000002',
                                      'path':'docs/产品/规则.md'})
        self.write('.documentation/documents.json',registry)
        self.write('examples/sample/gift.project.json', {'schema': 'gift.project/1', 'modules': {'rules': 'contracts/rules.json'}})
        self.write('examples/sample/contracts/rules.json', {'schema': 'gift.author-module/1', 'moduleId': 'rules',
            'dialects': {'custom': {'languageId': 'gift.requirement-structure'}}, 'definitions': {
            'r:Check': {'kind': 'custom:rule', 'body': {'semantics': {
                'source': '../../../docs/产品/规则.md', 'section': 'Behavior'}}}}})
        return sample

    def test_source_edit_needs_no_example_snapshot_or_lock(self):
        self.example()
        before = check_docs.verify(self.root)
        self.assertEqual(before['example_projects'], 1)
        self.authority.write_text('### REQ001｜Requirement\n\nChanged prose and formatting.\n', encoding='utf-8')
        after = check_docs.verify(self.root)
        self.assertNotEqual(before['source_set_sha256'], after['source_set_sha256'])
        self.assertFalse(list((self.root / 'examples').rglob('gift.lock.json')))

    def test_example_member_must_exist_and_have_its_actual_identity(self):
        sample = self.example()
        module = sample / 'contracts/rules.json'
        module.write_text('{"moduleId":"other"}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'example module identity mismatch:'):
            check_docs.verify(self.root)
        module.write_text('{"moduleId":"rules"}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'example module schema unsupported:'):
            check_docs.verify(self.root)
        module.unlink()
        with self.assertRaisesRegex(ValueError, 'example module missing/outside:'):
            check_docs.verify(self.root)
        self.write('examples/sample/gift.project.json', {'schema': 'gift.project/1', 'modules': {'escape': '../../../outside.json'}})
        with self.assertRaisesRegex(ValueError, 'example module missing/outside:'):
            check_docs.verify(self.root)

    def test_example_rule_keeps_a_real_semantic_owner(self):
        sample = self.example()
        # A standalone author module needs neither a project nor a material lock.
        (sample / 'gift.project.json').unlink()
        self.assertEqual(check_docs.verify(self.root)['example_projects'], 0)
        owner = self.root / 'docs/产品/规则.md'
        owner.write_text('### Renamed section\n\nOriginal body.\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'example rule section missing:'):
            check_docs.verify(self.root)
        owner.unlink()
        registry=s.load(self.root/'.documentation/documents.json')
        registry['documents']=[item for item in registry['documents'] if item['path']!='docs/产品/规则.md']
        self.write('.documentation/documents.json',registry)
        with self.assertRaisesRegex(ValueError, 'example rule source missing/outside:'):
            check_docs.verify(self.root)

    def test_rule_section_accepts_visible_stable_anchor_but_not_fenced_anchor(self):
        sample = self.example()
        module = s.load(sample / 'contracts/rules.json')
        module['definitions']['r:Check']['body']['semantics']['section'] = 'stable'
        self.write('examples/sample/contracts/rules.json', module)
        owner = self.root / 'docs/产品/规则.md'
        owner.write_text('<a id="stable"></a>\n## Behavior\n', encoding='utf-8')
        check_docs.verify(self.root)
        owner.write_text('```html\n<a id="stable"></a>\n```\n## Behavior\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'example rule section missing:'):
            check_docs.verify(self.root)

    def test_rule_section_preserves_original_heading_spelling(self):
        sample = self.example()
        module = s.load(sample / 'contracts/rules.json')
        module['definitions']['r:Check']['body']['semantics']['section'] = '`Behavior`'
        self.write('examples/sample/contracts/rules.json', module)
        (self.root / 'docs/产品/规则.md').write_text('## `Behavior`\n', encoding='utf-8')
        check_docs.verify(self.root)


class ScopedExamples(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix='gift-scoped-examples-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project_path = self.root / 'examples/sample/gift.project.json'
        self.project = {'schema': 'gift.project/design-converged', 'sourceScopes': [
            {'root': 'design', 'kind': 'semantic', 'include': ['**/*.json'],
             'editSource': {'mode': 'file'}}], 'targets': {'one': {'outputRoots': [
                {'moduleId': 'module:sample', 'export': ''}]}}}
        self.module = {'schema': 'gift.author-module/design-converged',
                       'moduleId': 'module:sample', 'exports': {'': {}, '中文': {}}}
        self.captured = {}
        self.put('examples/sample/design/app.json', self.module)

    def put(self, name, value):
        self.captured[name] = json.dumps(value, ensure_ascii=False).encode('utf-8')

    def verify(self):
        check_docs.check_scoped_example(self.root, self.project_path, self.project, self.captured)

    def test_captured_scopes_and_exact_empty_export(self):
        self.verify()  # No disk module or duplicate modules table is required.
        self.module['exports'].pop('')
        self.put('examples/sample/design/app.json', self.module)
        with self.assertRaisesRegex(ValueError, 'root export missing'):
            self.verify()
        self.project['targets']['one']['outputRoots'][0].pop('export')
        self.verify()  # Absence selects the remaining public set, not an empty name.

    def test_duplicates_and_overlapping_owners_rejected(self):
        self.put('examples/sample/design/other.json', self.module)
        with self.assertRaisesRegex(ValueError, 'duplicate module identity'):
            self.verify()
        self.captured.pop('examples/sample/design/other.json')
        self.project['sourceScopes'] *= 2
        with self.assertRaisesRegex(ValueError, 'overlapping semantic scopes'):
            self.verify()

    def test_missing_root_and_excluded_member_rejected(self):
        self.project['sourceScopes'][0]['exclude'] = ['app.json']
        with self.assertRaisesRegex(ValueError, 'root module missing'):
            self.verify()
        self.project['targets'] = {}
        self.verify()  # A captured empty draft is valid.

    def test_empty_target_roots_remain_a_valid_non_generating_draft(self):
        self.project['targets']['one']['outputRoots'] = []
        self.verify()

    def test_unknown_schema_and_escape_rejected(self):
        self.module['schema'] = 'gift.author-module/unknown'
        self.put('examples/sample/design/app.json', self.module)
        with self.assertRaisesRegex(ValueError, 'module schema unsupported'):
            self.verify()
        self.project['sourceScopes'][0]['root'] = '../outside'
        with self.assertRaisesRegex(ValueError, 'unsafe relative path'):
            self.verify()

    def test_multiple_roots_require_distinct_identity(self):
        roots = self.project['targets']['one']['outputRoots']
        roots.append({'moduleId': 'module:sample', 'export': '中文'})
        with self.assertRaisesRegex(ValueError, 'multiple roots require rootId'):
            self.verify()
        for item in roots:
            item['rootId'] = 'same'
        with self.assertRaisesRegex(ValueError, 'duplicate root identity'):
            self.verify()
        roots[1]['rootId'] = 'other'
        self.verify()

    def test_project2_keeps_its_original_selector_domain(self):
        self.project['schema'] = 'gift.project/2'
        for name in ('', '中文', 'X\n'):
            self.project['targets']['one']['outputRoots'][0]['export'] = name
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'ASCII Identifier'):
                self.verify()
        self.module['exports']['X'] = {}
        self.put('examples/sample/design/app.json', self.module)
        self.project['targets']['one']['outputRoots'][0]['export'] = 'X'
        self.verify()

    def test_consumed_shapes_cannot_masquerade_as_empty_or_public(self):
        import copy
        original = copy.deepcopy(self.project)
        for mutation in (lambda p: p.update(targets=[]),
                         lambda p: p.update(defaultTarget=[]),
                         lambda p: p['sourceScopes'][0].update(kind='semantc'),
                         lambda p: p['sourceScopes'][0].pop('editSource'),
                         lambda p: p['targets']['one'].update(outputRoots=''),
                         lambda p: p['targets']['one']['outputRoots'][0].update(rootId=[])):
            self.project = copy.deepcopy(original)
            mutation(self.project)
            with self.assertRaises(ValueError):
                self.verify()
        self.project = original
        self.module['exports'] = ''
        self.put('examples/sample/design/app.json', self.module)
        with self.assertRaisesRegex(ValueError, 'exports must be a map'):
            self.verify()
