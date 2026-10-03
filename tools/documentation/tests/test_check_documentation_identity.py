"""Pure local byte/metadata regressions. No SEC execution, network or renderer."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
import hashlib
import json

import source_inventory as s


def declaration(roots=None):
    return {'schema': s.BASELINE_SCHEMA, 'source_root': '..',
            'source_roots': roots if roots is not None else ['.documentation', 'docs'],
            'source_manifest': 'source-manifest.json', 'audited_namespaces': ['docs'],
            'non_documentation_roots': [], 'excluded_from_source_hash': sorted(s.EXCLUDED_FROM_SOURCE_HASH),
            'entry': '../docs/产品/产品要求与工作约束.md', 'delivery_number': 'fixture',
            'archive_name': 'fixture.zip', 'scope': 'fixture', 'authority_limit': 'content only'}


class DocumentationIdentity(TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory(prefix='sec-doc-identity-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / '.documentation').mkdir()
        (self.root / 'docs/产品').mkdir(parents=True)
        self.write(s.BASELINE_PATH, json.dumps(declaration(), ensure_ascii=False))
        self.write('docs/产品/产品要求与工作约束.md', '\n\n'.join(
            f'### REQ{i:03d}｜Requirement {i}\n\nOriginal requirement {i}.' for i in range(1, 52)))

    def write(self, name, text):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')

    def capture(self):
        return s.capture_source_manifest(self.root)

    def test_rich_requirement_heading_requires_stable_anchor_in_projection_domain(self):
        self.write('docs/产品/产品要求与工作约束.md', '### REQ001｜**rich**\n\nBody.')
        with self.assertRaisesRegex(ValueError, 'stable explicit'):
            s.requirement_projection(self.root)
        self.write('docs/产品/产品要求与工作约束.md', '<a id="req001"></a>\n\n### REQ001｜**rich**\n\nBody.')
        self.assertEqual(s.requirement_projection(self.root)['items'][0]['fragment'], 'req001')

    def test_boundary_is_a_real_source_member_and_never_written_by_refresh(self):
        before = (self.root / s.BASELINE_PATH).read_bytes()
        a = s.refresh_source_manifest(self.root)
        self.assertIn(s.BASELINE_PATH, [x['path'] for x in self.capture()['members']])
        self.assertEqual((self.root / s.BASELINE_PATH).read_bytes(), before)
        self.assertFalse(a['boundary_written'])
        self.assertNotIn('source_set_sha256', s.load(self.root / s.BASELINE_PATH))

    def test_cache_absence_change_and_corruption_do_not_change_source_identity(self):
        before = self.capture()
        for text in ('{}', 'different renderer and fonts', '{ malformed'):
            self.write(s.CACHE_PATH, text)
            self.assertEqual(self.capture(), before)
        (self.root / s.CACHE_PATH).unlink()
        self.assertEqual(self.capture(), before)

    def test_cache_does_change_delivery_input_identity(self):
        def envelope():
            return hashlib.sha256(b''.join(p.read_bytes() for p in s.documentation_files(self.root))).hexdigest()
        a = envelope()
        self.write(s.CACHE_PATH, '{}')
        self.assertNotEqual(envelope(), a)

    def test_corrupt_derived_indices_never_become_authority(self):
        before = self.capture()
        for name in s.PROJECTION_PATHS:
            self.write(name, '{ forged derived content')
        self.assertEqual(self.capture(), before)
        s.refresh_source_manifest(self.root)
        self.assertEqual(s.load(self.root / s.MANIFEST_PATH), before)
        self.assertEqual(s.load(self.root / s.REQUIREMENTS_PATH), s.requirement_projection(self.root))

    def test_boundary_change_invalidates_identity_even_if_members_are_same(self):
        before = self.capture()
        value = s.load(self.root / s.BASELINE_PATH)
        value['scope'] = 'changed qualification'
        self.write(s.BASELINE_PATH, json.dumps(value))
        self.assertNotEqual(self.capture()['source_set_sha256'], before['source_set_sha256'])

    def test_stored_digest_cannot_replace_recomputation(self):
        value = self.capture()
        value['source_set_sha256'] = '7' * 64
        with self.assertRaisesRegex(ValueError, 'stale'):
            s.validate_source_manifest(value, self.root)

    def test_no_downgrade_to_mixed_domain_schema(self):
        value = self.capture()
        value['schema'] = 'sec.documentation-source-manifest/1'
        with self.assertRaises(ValueError): s.validate_source_manifest(value, self.root)

    def test_exclusions_cannot_hide_authored_rules(self):
        value = s.load(self.root / s.BASELINE_PATH)
        value['excluded_from_source_hash'].append('docs/产品/产品要求与工作约束.md')
        self.write(s.BASELINE_PATH, json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'registered'): self.capture()

    def test_new_authoritative_file_is_detected_not_silently_ignored(self):
        before = self.capture()
        self.write('docs/node_modules/source.txt', 'not a registered cache')
        self.assertNotEqual(self.capture(), before)

    def test_missing_source_or_audited_namespace_is_not_an_empty_domain(self):
        value = s.load(self.root / s.BASELINE_PATH)
        value['audited_namespaces'].append('absent')
        self.write(s.BASELINE_PATH, json.dumps(value))
        with self.assertRaises(FileNotFoundError): self.capture()

    def test_source_symlink_rejected_but_excluded_cache_never_dereferenced(self):
        (self.root / s.CACHE_PATH).symlink_to(self.root / 'absent-private')
        self.capture()
        with self.assertRaisesRegex(ValueError, 'linked'):
            s.documentation_files(self.root)
        (self.root / 'docs/link').symlink_to(self.root / s.BASELINE_PATH)
        with self.assertRaisesRegex(ValueError, 'linked'): self.capture()

    def test_case_and_unicode_normalization_collisions_rejected(self):
        self.write('docs/X.md', 'x'); self.write('docs/x.md', 'y')
        upper = self.root / 'docs/X.md'; lower = self.root / 'docs/x.md'
        case_distinct = not upper.samefile(lower)
        if case_distinct:
            with self.assertRaisesRegex(ValueError, 'collision'): self.capture()
        lower.unlink()
        if case_distinct: upper.unlink()
        self.write('docs/é.md', 'x'); self.write('docs/e\u0301.md', 'y')
        with self.assertRaisesRegex(ValueError, 'Unicode|collision'): self.capture()

    def test_unsafe_paths_and_nonfinite_json_rejected(self):
        for name in ('../x', '/x', 'x//y', 'C:/x', 'x\\y', 'x\0y', 'x/..', 'x.'):
            with self.subTest(name=name), self.assertRaises(ValueError): s.local_path(self.root, name)
        for data in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}'):
            with self.subTest(data=data), self.assertRaises(ValueError): s.decode(data, 'fixture')

    def test_requirement_projection_not_a_second_handwritten_list(self):
        original = s.requirement_projection(self.root)
        path = self.root / 'docs/产品/产品要求与工作约束.md'
        path.write_text(path.read_text().replace('Original requirement 1.', 'Changed requirement 1.'))
        updated = s.requirement_projection(self.root)
        self.assertNotEqual(original['items'][0], updated['items'][0])
        self.assertEqual(original['items'][1:], updated['items'][1:])

    def test_requirement_example_heading_is_data_not_requirement_identity(self):
        path = self.root / 'docs/产品/产品要求与工作约束.md'
        path.write_text(path.read_text() + '\n\n```md\n### REQ999｜example\n```\n')
        self.assertEqual(len(s.requirement_projection(self.root)['items']), 51)

    def test_authorized_new_requirement_is_derived_not_blocked_by_a_copied_count(self):
        authority = self.root / 'docs/产品/产品要求与工作约束.md'
        authority.write_text(authority.read_text() + '\n\n### REQ052｜New obligation\nNew source meaning.\n')
        projection = s.requirement_projection(self.root)
        self.assertEqual(len(projection['items']), 52)
        self.assertEqual(projection['items'][-1]['id'], 'REQ052')

    def test_boolean_size_cannot_compare_equal_to_integer_size(self):
        self.write('docs/one.md', 'x')
        value = self.capture()
        next(m for m in value['members'] if m['path'] == 'docs/one.md')['bytes'] = True
        with self.assertRaises(ValueError): s.validate_source_manifest(value, self.root)

    def test_refresh_is_idempotent_and_source_preserving(self):
        source_before = self.capture()
        s.refresh_source_manifest(self.root)
        before = {n: (self.root / n).read_bytes() for n in s.PROJECTION_PATHS}
        s.refresh_source_manifest(self.root)
        self.assertEqual(source_before, self.capture())
        self.assertEqual(before, {n: (self.root / n).read_bytes() for n in s.PROJECTION_PATHS})

    def test_interrupted_projection_publication_is_detectable_and_rebuildable(self):
        expected = self.capture()
        real = s._replace_json
        def interrupt(path, value):
            if path.name == 'source-manifest.json': raise OSError('injected failure')
            real(path, value)
        with patch.object(s, '_replace_json', interrupt), self.assertRaises(OSError):
            s.refresh_source_manifest(self.root)
        self.assertEqual(self.capture(), expected)
        s.refresh_source_manifest(self.root)
        self.assertEqual(s.load(self.root / s.MANIFEST_PATH), expected)

    def test_unknown_metadata_role_is_not_silently_authoritative(self):
        self.write('.documentation/new-data.json', '{}')
        with self.assertRaisesRegex(ValueError, 'metadata role'): self.capture()

    def test_stable_req_anchor_is_preferred_to_rename_sensitive_heading(self):
        path = self.root / 'docs/产品/产品要求与工作约束.md'
        path.write_text('<a id="req001"></a>\n\n' + path.read_text())
        self.assertEqual(s.requirement_projection(self.root)['items'][0]['fragment'], 'req001')

    def test_unknown_regression_mode_and_non_source_target_cannot_silently_pass(self):
        from check_docs import checked_regressions
        item = {'id':'example', 'path':'docs/a.md','mode':'ignore','text':'condition'}
        with self.assertRaisesRegex(ValueError, 'mode'):
            checked_regressions({'scope':'fixture','checks':[item]}, {'docs/a.md'})
        item['mode'] = 'must_contain'; item['path'] = '.documentation/figures.json'
        with self.assertRaisesRegex(ValueError, 'non-source'):
            checked_regressions({'scope':'fixture','checks':[item]}, {'docs/a.md'})

    def test_two_projection_writers_are_refused_without_waiting_or_stealing(self):
        with s.projection_writer(self.root):
            with self.assertRaises(OSError):
                s.refresh_source_manifest(self.root)
        s.refresh_source_manifest(self.root)
        self.assertEqual(s.load(self.root / s.MANIFEST_PATH), self.capture())

    def test_changed_capture_cannot_be_published_as_one_stable_source(self):
        original = s.source_manifest_members(self.root)
        with patch.object(s, 'source_manifest_members', side_effect=[original, []]):
            with self.assertRaisesRegex(ValueError, 'changed during capture'): self.capture()


if __name__ == '__main__': main()
