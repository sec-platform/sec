"""Standard-library boundary checks for the canonical documentation gate."""
from pathlib import Path
import hashlib
import json
import tempfile
import unittest
from test_check_documentation_identity import declaration
from source_inventory import (
    load,
    local_path,
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

    def test_no_silent_cache_directory_omission_inside_declared_source(self):
        (self.root / 'docs/node_modules').mkdir()
        (self.root / 'docs/node_modules/unexpected.txt').write_text('unexpected')
        self.assertIn('docs/node_modules/unexpected.txt', self.names())

    def test_missing_and_overlapping_roots_reject(self):
        for roots in (['absent'], ['docs', 'docs/规则.md'], ['docs', 'docs'], [{}], []):
            with self.subTest(roots=roots):
                self.declare(roots)
                with self.assertRaises(ValueError):
                    source_files(self.root)

    def test_unsafe_root_and_member_names_reject(self):
        for name in ('../outside', '/absolute', 'docs//bad', 'C:/outside', 'docs\\bad', ''):
            with self.subTest(name=name), self.assertRaises(ValueError):
                local_path(self.root, name)

    def test_duplicate_metadata_keys_reject(self):
        metadata = self.root / '.documentation/baseline.json'
        metadata.write_text('{"source_roots":[],"source_roots":["docs"]}')
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            load(metadata)

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

    def test_symlink_to_external_content_rejects(self):
        outside = self.root / 'outside.txt'
        outside.write_text('private')
        link = self.root / 'docs/link.txt'
        try:
            link.symlink_to(outside)
        except OSError as error:
            self.skipTest(str(error))
        with self.assertRaisesRegex(ValueError, 'linked documentation path'):
            source_files(self.root)

    def test_refresh_publishes_complete_canonical_members_and_matching_digest(self):
        authority = self.root / 'docs/产品/产品要求与工作约束.md'
        authority.parent.mkdir()
        authority.write_text('\n\n'.join(f'### REQ{i:03d}｜R {i}\ntext' for i in range(1,3)),
                             encoding='utf-8')
        # Fix the oracle from author bytes before invoking the projection owner.
        # Reusing its digest helper or its emitted members would also approve
        # a consistently wrong size/hash in both manifest and returned digest.
        expected_names = ['.documentation/baseline.json', 'docs/产品/产品要求与工作约束.md', 'docs/规则.md']
        expected_members = []
        for name in expected_names:
            data = (self.root / name).read_bytes()
            expected_members.append({'path': name, 'bytes': len(data),
                                     'sha256': hashlib.sha256(data).hexdigest()})
        expected_digest = hashlib.sha256(json.dumps(
            expected_members, ensure_ascii=False, sort_keys=True,
            separators=(',', ':')).encode('utf-8')).hexdigest()
        result = refresh_source_manifest(self.root)
        manifest = load(self.root / '.documentation/source-manifest.json')
        baseline = load(self.root / '.documentation/baseline.json')
        names = [member['path'] for member in manifest['members']]
        self.assertEqual(names, sorted(names))
        self.assertEqual(names, expected_names)
        self.assertEqual(manifest['members'], expected_members)
        self.assertEqual(manifest['source_set_sha256'], expected_digest)
        self.assertEqual(result['source_set_sha256'], expected_digest)
        self.assertNotIn('source_set_sha256', baseline)
        self.assertEqual(result['source_members'], 3)


if __name__ == '__main__':
    unittest.main()
