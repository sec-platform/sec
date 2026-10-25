"""Rebuild the bounded complete-base design Schema graph from captured bytes.

This is a documentation drift check, not a language Reader, linker or validator.
Only declared Schema nodes and Schema $id/$ref edges are transformed. Derived
resources are disposable inputs to a JSON Schema engine, never author sources.
"""
from __future__ import annotations

import copy
import hashlib
import json
from urllib.parse import unquote

from source_inventory import decode

MANIFEST = 'schema/author/first-layer/codec-parameters.json'
MAPS = ('$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas')
SINGLES = ('additionalProperties', 'unevaluatedProperties', 'propertyNames',
           'items', 'contains', 'unevaluatedItems', 'not', 'if', 'then', 'else')
ARRAYS = ('allOf', 'anyOf', 'oneOf', 'prefixItems')


class CodecDrift(ValueError):
    """The frozen design transformation cannot be applied to these inputs."""


def fail(message):
    raise CodecDrift('candidate-codec drift/unsupported: ' + message)


def exact_keys(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        fail(label + ': unexpected/missing fields')


def same(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=True) == json.dumps(b, sort_keys=True, ensure_ascii=True)


def tokens(pointer):
    if not isinstance(pointer, str) or not pointer.startswith('/'):
        fail('expected a non-root JSON Pointer')
    result = []
    for part in pointer[1:].split('/'):
        # Reject invalid escapes rather than interpreting a different location.
        i = 0
        while i < len(part):
            if part[i] == '~':
                if i + 1 == len(part) or part[i + 1] not in '01':
                    fail('invalid pointer escape: ' + pointer)
                i += 1
            i += 1
        result.append(part.replace('~1', '/').replace('~0', '~'))
    return result


def locate(root, parts):
    node = root
    for part in parts:
        if isinstance(node, list):
            if not part.isascii() or not part.isdecimal() or str(int(part)) != part:
                fail('non-canonical array index')
            key = int(part)
        else:
            key = part
        try:
            node = node[key]
        except (KeyError, IndexError, TypeError):
            fail('pointer target absent: ' + '/'.join(parts))
    return node


def schema_nodes(node, parts=()):
    if isinstance(node, bool):
        yield parts, node
        return
    if not isinstance(node, dict):
        fail('Schema node must be object or boolean')
    yield parts, node
    for key in MAPS:
        if key in node:
            if not isinstance(node[key], dict):
                fail('unsupported Schema map: ' + key)
            for name, value in node[key].items():
                yield from schema_nodes(value, (*parts, key, name))
    for key in SINGLES:
        if key in node:
            yield from schema_nodes(node[key], (*parts, key))
    for key in ARRAYS:
        if key in node:
            if not isinstance(node[key], list):
                fail('unsupported Schema array: ' + key)
            for i, value in enumerate(node[key]):
                yield from schema_nodes(value, (*parts, key, str(i)))


def build_graph(captured):
    """Use only the caller's exact source capture; no filesystem/network reads."""
    if MANIFEST not in captured:
        fail('parameter manifest missing')
    manifest = decode(captured[MANIFEST], MANIFEST)
    exact_keys(manifest, ('schema', 'scope', 'resources', 'externals'), MANIFEST)
    if manifest['schema'] != 'gift.design-codec-parameters/1' or manifest['scope'] != 'complete-base-structure-only':
        fail('unsupported manifest identity/scope')
    resources, externals = manifest['resources'], manifest['externals']
    if not isinstance(resources, list) or not resources or not isinstance(externals, list):
        fail('resource lists required')
    source, mapping, paths = {}, {}, set()
    for item in resources + externals:
        transformed = item in resources
        keys = ('path', 'id', 'sha256', 'candidateId', 'replacements') if transformed else ('path', 'id', 'sha256')
        exact_keys(item, keys, 'resource')
        path, identity = item['path'], item['id']
        if not isinstance(path, str) or not isinstance(identity, str) or not identity.startswith('urn:') or '#' in identity:
            fail('invalid resource identity/path')
        if path in paths or identity in source:
            fail('duplicate resource identity/path')
        paths.add(path)
        if path not in captured or hashlib.sha256(captured[path]).hexdigest() != item['sha256']:
            fail('content revision mismatch: ' + path)
        value = decode(captured[path], path)
        if not isinstance(value, dict) or value.get('$id') != identity or value.get('$schema') != 'https://json-schema.org/draft/2020-12/schema':
            fail('resource header mismatch: ' + path)
        source[identity] = copy.deepcopy(value)
        target = item['candidateId'] if transformed else identity
        if not isinstance(target, str) or not target.startswith('urn:') or '#' in target:
            fail('invalid candidate identity')
        mapping[identity] = target
    if len(set(mapping.values())) != len(mapping) or any(mapping[x] in source and mapping[x] != x for x in mapping):
        fail('candidate identity collision')
    if any(item['id'] == item['candidateId'] for item in resources):
        fail('candidate must have a distinct identity')
    for item in resources:
        value = source[item['id']]
        allowed = {p for p, _ in schema_nodes(value)}
        seen = []
        if not isinstance(item['replacements'], list):
            fail('replacements must be an array')
        for replacement in item['replacements']:
            exact_keys(replacement, ('pointer', 'expected', 'replacement'), 'replacement')
            parts = tuple(tokens(replacement['pointer']))
            if parts not in allowed or any(parts[:len(p)] == p or p[:len(parts)] == parts for p in seen):
                fail('non-Schema or overlapping replacement: ' + replacement['pointer'])
            seen.append(parts)
            if not same(locate(value, parts), replacement['expected']):
                fail('old node mismatch: ' + replacement['pointer'])
            # Validate the replacement's structural traversal before installation.
            list(schema_nodes(replacement['replacement']))
            parent = locate(value, parts[:-1])
            parent[int(parts[-1]) if isinstance(parent, list) else parts[-1]] = copy.deepcopy(replacement['replacement'])
    addresses = {identity: {p for p, _ in schema_nodes(value)} for identity, value in source.items()}
    output = {}
    for identity, value in source.items():
        for parts, node in schema_nodes(value):
            if not isinstance(node, dict):
                continue
            if (parts and '$id' in node) or any(k in node for k in ('$dynamicRef', '$dynamicAnchor', '$anchor', '$recursiveRef', 'dependencies', 'additionalItems')):
                fail('unsupported resource scope/vocabulary: ' + identity)
            if '$ref' in node:
                ref = node['$ref']
                if not isinstance(ref, str):
                    fail('non-string reference')
                base, separator, fragment = ref.partition('#')
                resolved = base or identity
                if resolved not in mapping:
                    fail('undeclared reference resource: ' + ref)
                if separator and fragment:
                    target_parts = tuple(tokens(unquote(fragment)))
                    if target_parts not in addresses[resolved]:
                        fail('reference is not a declared Schema node: ' + ref)
                node['$ref'] = (mapping[resolved] if base else '') + (separator + fragment)
        value['$id'] = mapping[identity]
        output[mapping[identity]] = value
    return output


if __name__ == '__main__':
    from pathlib import Path
    from source_inventory import capture_source_bytes
    root = Path(__file__).resolve().parents[2]
    print(json.dumps({'scope': 'complete-base-structure-only',
                      'schemas': list(build_graph(capture_source_bytes(root)).values())}, ensure_ascii=True))
