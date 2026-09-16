"""The documentation source boundary shared by checks and reading builds."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import tempfile


EXCLUDED_FROM_SOURCE_HASH = frozenset({
    '.documentation/baseline.json',
    '.documentation/source-manifest.json',
})


def load(path: Path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON key {key!r}: {path.name}')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)


def local_path(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or '\\' in name or ':' in name:
        raise ValueError(f'unsafe relative path: {name!r}')
    parts = name.split('/')
    if any(part in ('', '.', '..') for part in parts):
        raise ValueError(f'unsafe relative path: {name!r}')
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
            raise ValueError(f'linked documentation path: {name}')
    return current


def source_files(root: Path) -> tuple[Path, ...]:
    """Enumerate declared roots completely; the manifest does not hide extras."""
    root = root.resolve()
    baseline = load(local_path(root, '.documentation/baseline.json'))
    names = baseline['source_roots']
    if (not isinstance(names, list) or not names
            or not all(isinstance(name, str) for name in names)
            or len(set(names)) != len(names)):
        raise ValueError('source_roots must be a nonempty set of relative paths')
    roots = [local_path(root, name) for name in names]
    for index, first in enumerate(roots):
        for second in roots[index + 1:]:
            if first == second or first in second.parents or second in first.parents:
                raise ValueError('documentation source roots overlap')
    files = []
    pending = list(roots)
    while pending:
        entry = pending.pop()
        entry = local_path(root, entry.relative_to(root).as_posix())
        if entry.is_file():
            files.append(entry)
        elif entry.is_dir():
            pending.extend(entry.iterdir())
        else:
            raise ValueError(f'missing or non-ordinary documentation source: {entry.relative_to(root)}')
    namespaces = baseline['audited_namespaces']
    exemptions = baseline['non_documentation_roots']
    if not namespaces:
        raise ValueError('audited_namespaces must be nonempty')
    for values in (namespaces, exemptions):
        if (not isinstance(values, list) or not all(isinstance(value, str) for value in values)
                or len(set(values)) != len(values)):
            raise ValueError('documentation namespace boundaries must be unique relative paths')
    namespace_paths = [local_path(root, name) for name in namespaces]
    exemption_paths = [local_path(root, name) for name in exemptions]
    for exemption in exemption_paths:
        if not any(namespace in exemption.parents for namespace in namespace_paths):
            raise ValueError('non-documentation root must be inside an audited namespace')
        if any(exemption == source or exemption in source.parents or source in exemption.parents
               for source in roots):
            raise ValueError('non-documentation root overlaps a documentation source root')
    members = set(files)
    pending = [namespace for namespace in namespace_paths if namespace.exists()]
    while pending:
        entry = pending.pop()
        if any(entry == exemption or exemption in entry.parents for exemption in exemption_paths):
            continue
        entry = local_path(root, entry.relative_to(root).as_posix())
        if entry.is_dir():
            pending.extend(entry.iterdir())
        elif entry not in members:
            raise ValueError(f'unexpected file in documentation namespace: {entry.relative_to(root)}')
    return tuple(sorted(files, key=lambda entry: entry.relative_to(root).as_posix()))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_manifest_members(root: Path) -> list[dict[str, object]]:
    """Capture every declared source member in canonical path order."""
    root = root.resolve()
    members = []
    for path in source_files(root):
        name = path.relative_to(root).as_posix()
        if name in EXCLUDED_FROM_SOURCE_HASH:
            continue
        data = path.read_bytes()
        members.append({'path': name, 'bytes': len(data), 'sha256': _sha256(data)})
    return members


def source_set_digest(members: list[dict[str, object]]) -> str:
    encoded = json.dumps(
        members, ensure_ascii=False, sort_keys=True, separators=(',', ':')
    ).encode('utf-8')
    return _sha256(encoded)


def _replace_json(path: Path, value: object) -> None:
    """Publish one complete JSON value; interruption leaves old or new bytes."""
    payload = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f'.{path.name}.', suffix='.tmp'
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def refresh_source_manifest(root: Path) -> dict[str, object]:
    """Refresh the sole byte manifest and its baseline digest from current sources."""
    root = root.resolve()
    baseline_path = local_path(root, '.documentation/baseline.json')
    manifest_path = local_path(root, '.documentation/source-manifest.json')
    baseline = load(baseline_path)
    if baseline.get('source_manifest') != 'source-manifest.json':
        raise ValueError('baseline source_manifest must be source-manifest.json')
    excluded = baseline.get('excluded_from_source_hash')
    if set(excluded or ()) != EXCLUDED_FROM_SOURCE_HASH:
        raise ValueError('baseline excluded_from_source_hash differs from the canonical set')
    members = source_manifest_members(root)
    digest = source_set_digest(members)
    manifest = {
        'schema': 'sec.documentation-source-manifest/1',
        'source_set_sha256': digest,
        'members': members,
    }
    updated_baseline = dict(baseline)
    updated_baseline['source_set_sha256'] = digest
    # A crash between these replacements is fail-closed: the ordinary checker
    # rejects the mismatched digests, and rerunning this command converges them.
    _replace_json(manifest_path, manifest)
    _replace_json(baseline_path, updated_baseline)
    return {
        'source_set_sha256': digest,
        'source_members': len(members),
        'manifest': manifest_path.relative_to(root).as_posix(),
        'baseline': baseline_path.relative_to(root).as_posix(),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--write', action='store_true', help='refresh the canonical manifest and baseline digest')
    arguments = parser.parse_args()
    if not arguments.write:
        parser.error('--write is required; ordinary verification uses tools/check_docs.py')
    print(json.dumps(refresh_source_manifest(arguments.root), ensure_ascii=False, indent=2))
