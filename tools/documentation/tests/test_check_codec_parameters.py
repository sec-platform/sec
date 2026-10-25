"""Drift, recursive closure and data isolation of the candidate parameter graph."""
import copy
import hashlib
import json
from unittest import TestCase

import codec_parameters as c


class CodecParameters(TestCase):
    def setUp(self):
        self.a = {'$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': 'urn:test:a',
                  '$defs': {'Name': {'type': 'string', 'minLength': 1}},
                  'properties': {'name': {'$ref': '#/$defs/Name'},
                                 'next': {'$ref': 'urn:test:b'}},
                  'const': {'$ref': 'urn:ordinary:data', '$id': 'not-a-schema'}}
        self.b = {'$schema': self.a['$schema'], '$id': 'urn:test:b',
                  'properties': {'parent': {'$ref': 'urn:test:a'},
                                 'name': {'$ref': 'urn:test:a#/$defs/Name'}}}
        self.capture = {}
        self.manifest = {'schema': 'gift.design-codec-parameters/1',
                         'scope': 'complete-base-structure-only', 'resources': [], 'externals': []}
        for name, value in (('a', self.a), ('b', self.b)):
            path = 'schema/' + name + '.json'
            raw = json.dumps(value).encode()
            self.capture[path] = raw
            self.manifest['resources'].append({'path': path, 'id': value['$id'],
                'sha256': hashlib.sha256(raw).hexdigest(), 'candidateId': value['$id'] + ':candidate',
                'replacements': []})
        self.change = {'pointer': '/$defs/Name', 'expected': self.a['$defs']['Name'],
                       'replacement': {'type': 'string'}}
        self.manifest['resources'][0]['replacements'] = [self.change]

    def build(self):
        self.capture[c.MANIFEST] = json.dumps(self.manifest).encode()
        return c.build_graph(self.capture)

    def update_a(self):
        raw = json.dumps(self.a).encode()
        self.capture['schema/a.json'] = raw
        self.manifest['resources'][0]['sha256'] = hashlib.sha256(raw).hexdigest()

    def test_recursive_edges_use_candidate_nodes_and_data_stays_literal(self):
        before = copy.deepcopy(self.capture)
        graph = self.build()
        a, b = graph['urn:test:a:candidate'], graph['urn:test:b:candidate']
        self.assertEqual(a['properties']['next']['$ref'], 'urn:test:b:candidate')
        self.assertEqual(b['properties']['parent']['$ref'], 'urn:test:a:candidate')
        self.assertEqual(b['properties']['name']['$ref'], 'urn:test:a:candidate#/$defs/Name')
        self.assertEqual(a['properties']['name']['$ref'], '#/$defs/Name')
        self.assertEqual(a['$defs']['Name'], {'type': 'string'})
        self.assertEqual(a['const'], self.a['const'])
        self.assertEqual({k: self.capture[k] for k in before}, before)

    def test_raw_string_union_preserves_exact_old_branch(self):
        self.change['replacement'] = {'oneOf': [self.change['expected'], {'type': 'object'}]}
        graph = self.build()
        self.assertEqual(graph['urn:test:a:candidate']['$defs']['Name']['oneOf'][0], self.a['$defs']['Name'])

    def test_content_drift_is_not_silently_rebound(self):
        self.capture['schema/a.json'] += b' '
        with self.assertRaisesRegex(c.CodecDrift, 'content revision'): self.build()

    def test_old_node_drift_is_rejected_even_with_updated_digest(self):
        self.a['$defs']['Name']['minLength'] = 2
        # The manifest was authored against the distinct original node.
        self.change['expected'] = {'type': 'string', 'minLength': 1}
        self.update_a()
        with self.assertRaisesRegex(c.CodecDrift, 'old node mismatch'): self.build()

    def test_undeclared_resource_and_missing_fragment_rejected(self):
        for ref, reason in [('urn:test:missing', 'undeclared'), ('#/$defs/Missing', 'not a declared Schema'),
                            ('#/const', 'not a declared Schema')]:
            with self.subTest(ref=ref):
                self.a['properties']['next']['$ref'] = ref
                self.update_a()
                with self.assertRaisesRegex(c.CodecDrift, reason): self.build()

    def test_nested_resource_scope_is_not_guessed(self):
        self.a['$defs']['Name']['$id'] = 'urn:test:nested'
        self.change['expected'] = copy.deepcopy(self.a['$defs']['Name'])
        self.change['replacement'] = copy.deepcopy(self.a['$defs']['Name'])
        self.update_a()
        with self.assertRaisesRegex(c.CodecDrift, 'unsupported resource scope'): self.build()

    def test_replacements_cannot_edit_data_or_overlap(self):
        self.change['pointer'] = '/const'
        with self.assertRaisesRegex(c.CodecDrift, 'non-Schema'): self.build()
        self.change['pointer'] = '/$defs/Name'
        self.manifest['resources'][0]['replacements'].append(copy.deepcopy(self.change))
        with self.assertRaisesRegex(c.CodecDrift, 'overlapping'): self.build()

    def test_no_duplicate_or_competing_resource_identity(self):
        self.manifest['resources'][1]['candidateId'] = 'urn:test:a:candidate'
        with self.assertRaisesRegex(c.CodecDrift, 'collision'): self.build()

    def test_missing_manifest_unknown_field_and_bad_pointer_fail_closed(self):
        with self.assertRaisesRegex(c.CodecDrift, 'manifest missing'): c.build_graph({})
        self.change['pointer'] = '/$defs/~2Name'
        with self.assertRaisesRegex(c.CodecDrift, 'invalid pointer'): self.build()
        self.manifest['guess'] = True
        with self.assertRaisesRegex(c.CodecDrift, 'unexpected/missing'): self.build()
