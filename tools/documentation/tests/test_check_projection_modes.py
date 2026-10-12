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
