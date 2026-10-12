"""Source checks and explicit sealed-package checks have different input obligations."""
import hashlib
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
        self.write(s.BASELINE_PATH, declaration())
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

    def test_gift_material_lock_is_checked_against_actual_bytes(self):
        sample = self.root / 'examples/sample'
        sample.mkdir()
        (sample / 'value.txt').write_bytes(b'actual')
        (sample / 'gift.project.json').write_text('{"modules":{}}')
        inputs = b'{"project":{"modules":{}},"requests":[]}'
        (sample / 'gift.lock.json').write_text(json.dumps({'resolutionInputs': {
            'algorithm': 'sha256', 'digest': hashlib.sha256(inputs).hexdigest()}, 'nodes': {'value': {
            'locations': ['value.txt'], 'content': {'digest': '0' * 64, 'byteLength': 6}}}}))
        with self.assertRaisesRegex(ValueError, r'stale material: .*gift\.lock\.json:value'):
            check_docs.verify(self.root)

    def material_example(self):
        sample = self.root / 'examples/requests'
        sample.mkdir()
        # Reverse insertion order deliberately differs from request module-ID order.
        project = {'modules': {'z': 'z.json', 'a': 'a.json'}}
        (sample / 'gift.project.json').write_text(json.dumps(project))
        (sample / 'z.json').write_text('{"moduleId":"z","body":{"text":"original"}}')
        (sample / 'a.json').write_text('{"moduleId":"a","dialects":{"req":{"languageId":"gift.structure"}},"imports":{}}')
        # Independent, literal oracle for the documented canonical {project,requests}.
        inputs = (b'{"project":{"modules":{"a":"a.json","z":"z.json"}},"requests":'
                  b'[{"dialects":{"req":{"languageId":"gift.structure"}},"imports":{},"moduleId":"a"},'
                  b'{"dialects":{},"imports":{},"moduleId":"z"}]}')
        lock = {'resolutionInputs': {'algorithm': 'sha256',
                'digest': hashlib.sha256(inputs).hexdigest(), 'byteLength': len(inputs)}, 'nodes': {}}
        self.write_material_nodes(sample, lock)
        return sample, lock

    def write_material_nodes(self, sample, lock):
        for name in ('a', 'z'):
            data = (sample / (name + '.json')).read_bytes()
            lock['nodes'][name] = {'locations': [name + '.json'], 'content': {
                'digest': hashlib.sha256(data).hexdigest(), 'byteLength': len(data)}}
        (sample / 'gift.lock.json').write_text(json.dumps(lock))

    def test_example_requests_match_independent_canonical_oracle(self):
        sample, lock = self.material_example()
        self.assertEqual(check_docs.verify(self.root)['example_material_projects'], 1)
        del lock['resolutionInputs']['byteLength']
        (sample / 'gift.lock.json').write_text(json.dumps(lock))
        self.assertEqual(check_docs.verify(self.root)['example_material_projects'], 1)

    def test_changed_dialect_or_import_cannot_hide_behind_updated_material_node(self):
        for field, value in (('dialects', {'req': {'languageId': 'gift.changed'}}),
                             ('imports', {'peer': {'mode': 'workspace', 'moduleId': 'z'}})):
            with self.subTest(field=field):
                sample, lock = self.material_example()
                module = json.loads((sample / 'a.json').read_text())
                module[field] = value
                (sample / 'a.json').write_text(json.dumps(module))
                self.write_material_nodes(sample, lock)
                with self.assertRaisesRegex(ValueError, 'stale resolution inputs:'):
                    check_docs.verify(self.root)
                for p in sample.iterdir():
                    p.unlink()
                sample.rmdir()

    def test_body_or_formatting_preserves_resolution_but_material_bytes_still_matter(self):
        sample, lock = self.material_example()
        (sample / 'z.json').write_text('{\n "body": {"text": "changed"},\n "moduleId": "z"\n}\n')
        with self.assertRaisesRegex(ValueError, 'stale material:') as caught:
            check_docs.verify(self.root)
        self.assertNotIn('stale resolution inputs:', str(caught.exception))
        resolution = dict(lock['resolutionInputs'])
        self.write_material_nodes(sample, lock)
        check_docs.verify(self.root)
        self.assertEqual(lock['resolutionInputs'], resolution)

    def test_resolution_length_and_module_identity_are_observed(self):
        sample, lock = self.material_example()
        lock['resolutionInputs']['byteLength'] += 1
        (sample / 'gift.lock.json').write_text(json.dumps(lock))
        with self.assertRaisesRegex(ValueError, 'stale resolution inputs:'):
            check_docs.verify(self.root)
        module = json.loads((sample / 'a.json').read_text())
        module['moduleId'] = 'other'
        (sample / 'a.json').write_text(json.dumps(module))
        self.write_material_nodes(sample, lock)
        with self.assertRaisesRegex(ValueError, 'resolution module identity mismatch:'):
            check_docs.verify(self.root)
