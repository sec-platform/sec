"""Source checks and explicit sealed-package checks have different input obligations."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import check_docs
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
            'deliverables': {'count': 0}})
        review.start()
        self.addCleanup(review.stop)

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')

    def test_source_check_neither_requires_nor_opens_local_projections(self):
        before = check_docs.verify(self.root)['source_set_sha256']
        for name in s.PROJECTION_PATHS:
            (self.root / name).write_bytes(b'\xffbroken derived bytes')
        self.assertEqual(check_docs.verify(self.root)['source_set_sha256'], before)
        self.authority.write_text('### REQ001｜Requirement\n\nChanged body.\n', encoding='utf-8')
        self.assertNotEqual(check_docs.verify(self.root)['source_set_sha256'], before)
        for name in s.PROJECTION_PATHS:
            self.assertEqual((self.root / name).read_bytes(), b'\xffbroken derived bytes')

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
