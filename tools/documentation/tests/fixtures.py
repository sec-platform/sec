"""Shared baseline declarations for documentation-tool tests."""
import source_inventory as s


def declaration(roots=None):
    return {'schema': s.BASELINE_SCHEMA, 'source_root': '..',
            'source_roots': roots if roots is not None else ['.documentation', 'docs'],
            'source_manifest': 'source-manifest.json', 'audited_namespaces': ['docs'],
            'non_documentation_roots': [], 'excluded_from_source_hash': sorted(s.EXCLUDED_FROM_SOURCE_HASH),
            'entry': '../docs/产品/产品要求与工作约束.md', 'delivery_number': 'fixture',
            'archive_name': 'fixture.zip', 'scope': 'fixture', 'authority_limit': 'content only'}
