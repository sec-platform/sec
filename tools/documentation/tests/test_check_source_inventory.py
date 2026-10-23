"""Standard-library boundary checks for the canonical documentation gate."""
from pathlib import Path
import hashlib
import json
import tempfile
import unittest
from .test_check_documentation_identity import declaration
from source_inventory import (
    load,
    refresh_source_manifest,
    source_files,
)


class SourceBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sec-doc-source-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / '.documentation').mkdir()
        (self.root / 'docs').mkdir()
        (self.root / 'docs/规则.md').write_text('# 规则\n', encoding='utf-8')
        self.declare(['.documentation', 'docs'])

    def declare(self, roots, exemptions=()):
        (self.root / '.documentation/baseline.json').write_text(
            json.dumps({**declaration(roots),
                'entry': '../docs/规则.md',
                'non_documentation_roots': list(exemptions)}), encoding='utf-8')

    def names(self):
        return {p.relative_to(self.root).as_posix() for p in source_files(self.root)}

    def test_detects_new_member_without_reading_unrelated_repository_files(self):
        (self.root / 'src').mkdir()
        (self.root / 'src/product.ts').write_bytes(b'\xff')
        before = self.names()
        (self.root / 'docs/new.md').write_text('# New\n', encoding='utf-8')
        self.assertEqual(self.names() - before, {'docs/new.md'})
        self.assertNotIn('src/product.ts', self.names())

    def test_missing_and_overlapping_roots_reject(self):
        for roots in (['absent'], ['docs', 'docs/规则.md'], ['docs', 'docs'], [{}], []):
            with self.subTest(roots=roots):
                self.declare(roots)
                with self.assertRaises(ValueError):
                    source_files(self.root)

    def test_entry_requires_an_actual_source_member(self):
        metadata=self.root/'.documentation/baseline.json'
        value=load(metadata)
        (self.root/'outside.md').write_text('outside declared source')
        for entry in ('../missing.md','../outside.md','../.documentation/source-manifest.json'):
            with self.subTest(entry=entry):
                value['entry']=entry
                metadata.write_text(json.dumps(value),encoding='utf-8')
                with self.assertRaisesRegex(ValueError,'entry must belong'):
                    self.names()
        value['entry']='../docs/规则.md'
        metadata.write_text(json.dumps(value),encoding='utf-8')
        self.assertIn('docs/规则.md',self.names())

    def test_retired_authority_cannot_hide_outside_declared_source_roots(self):
        self.declare(['.documentation', 'docs/规则.md'])
        (self.root / 'docs/authority.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'unexpected file in documentation namespace'):
            self.names()

    def test_explicit_non_documentation_root_is_separate_but_cannot_exempt_source(self):
        (self.root / 'docs/generated').mkdir()
        (self.root / 'docs/generated/index.md').write_text('machine projection')
        self.declare(['.documentation', 'docs/规则.md'], ['docs/generated'])
        self.assertNotIn('docs/generated/index.md', self.names())
        self.declare(['.documentation', 'docs/规则.md'], ['docs/规则.md'])
        with self.assertRaisesRegex(ValueError, 'overlaps'):
            self.names()

    def test_machine_exemption_cannot_cover_entire_namespace(self):
        self.declare(['.documentation'], ['docs'])
        with self.assertRaisesRegex(ValueError, 'inside an audited namespace'):
            self.names()

    def test_refresh_publishes_complete_canonical_members_and_matching_digest(self):
        authority = self.root / 'docs/产品/产品要求与工作约束.md'
        authority.parent.mkdir()
        authority.write_text('\n\n'.join(f'### REQ{i:03d}｜R {i}\ntext' for i in range(1,52)))
        expected_names = ['.documentation/baseline.json', 'docs/产品/产品要求与工作约束.md', 'docs/规则.md']
        expected_members = []
        for name in expected_names:
            payload = (self.root / name).read_bytes()
            expected_members.append({'path': name, 'bytes': len(payload),
                                     'sha256': hashlib.sha256(payload).hexdigest()})
        encoded_members = json.dumps(expected_members, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode('utf-8')
        expected_digest = hashlib.sha256(encoded_members).hexdigest()
        result = refresh_source_manifest(self.root)
        manifest = load(self.root / '.documentation/source-manifest.json')
        baseline = load(self.root / '.documentation/baseline.json')
        self.assertEqual(manifest['members'], expected_members)
        self.assertEqual(manifest['source_set_sha256'], expected_digest)
        self.assertNotIn('source_set_sha256', baseline)
        self.assertEqual(result['source_members'], 3)


if __name__ == '__main__':
    unittest.main()
