"""Bounded filesystem tests; these never launch a native verification unit."""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_helper', Path(__file__).with_name('linux-verification-unit-helper.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class RuntimeCopyPermissions(unittest.TestCase):
    def fixture(self, root):
        source, target = root / 'source', root / 'target'
        source.mkdir()
        target.mkdir()
        (source / 'usr').mkdir()
        (source / 'usr' / 'tool').write_bytes(b'accepted bytes\n')
        (source / 'usr' / 'data').write_bytes(b'readable data\n')
        os.chmod(source / 'usr', 0o755)
        os.chmod(source / 'usr' / 'tool', 0o755)
        os.chmod(source / 'usr' / 'data', 0o644)
        entries = [{'path': 'usr', 'type': 'directory', 'mode': 0o755}]
        for name in ['data', 'tool']:
            file = source / 'usr' / name
            entries.append({'path': 'usr/' + name, 'type': 'file', 'mode': stat.S_IMODE(file.stat().st_mode),
                            'size': file.stat().st_size, 'digest': helper.sha(file.read_bytes())})
        manifest = {'files': entries}
        info = source.stat()
        request = {'runtime': {'manifest': manifest, 'manifestDigest': helper.sha(helper.canonical(manifest)),
                              'root': {'path': str(source), 'device': str(info.st_dev), 'inode': str(info.st_ino)}}}
        return source, target, request

    def copy(self, request, target):
        helper.copy_runtime(request, str(target), helper.Deadline((time.time() + 5) * 1000))

    def test_copy_preserves_declared_modes_and_source_for_each_umask(self):
        for mask in [0o077, 0o027, 0o022]:
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                source, target, request = self.fixture(Path(directory))
                before = {p: (p.stat(), p.read_bytes() if p.is_file() else None) for p in source.rglob('*')}
                previous = os.umask(mask)
                try:
                    self.copy(request, target)
                    parent = helper.nofollow_directory(str(target))
                    try:
                        helper.create_runtime_directory(parent, 'sec-runtime', 0o755)
                    finally:
                        os.close(parent)
                finally:
                    os.umask(previous)
                for entry in request['runtime']['manifest']['files']:
                    copied = target / entry['path']
                    self.assertEqual(stat.S_IMODE(copied.stat().st_mode), entry['mode'])
                    if entry['type'] == 'file':
                        self.assertEqual(copied.read_bytes(), (source / entry['path']).read_bytes())
                        self.assertEqual(copied.stat().st_nlink, 1)
                self.assertEqual(stat.S_IMODE((target / 'sec-runtime').stat().st_mode), 0o755)
                for file, (info, contents) in before.items():
                    after = file.stat()
                    self.assertEqual((after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                                     (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns))
                    if contents is not None:
                        self.assertEqual(file.read_bytes(), contents)

    def test_source_symlink_hardlink_and_wrong_digest_still_fail(self):
        for fault in ['symlink', 'hardlink', 'digest']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                source, target, request = self.fixture(Path(directory))
                file = source / 'usr' / 'tool'
                if fault == 'symlink':
                    file.unlink()
                    file.symlink_to('data')
                elif fault == 'hardlink':
                    os.link(file, source / 'duplicate')
                else:
                    request['runtime']['manifest']['files'][-1]['digest'] = 'sha256:' + '0' * 64
                    request['runtime']['manifestDigest'] = helper.sha(helper.canonical(request['runtime']['manifest']))
                with self.assertRaises((OSError, helper.Unavailable)):
                    self.copy(request, target)

    def test_control_bytes_have_exact_modes_without_changing_caller_umask(self):
        for mask in [0o077, 0o027, 0o022]:
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                previous = os.umask(mask)
                try:
                    for name, mode in [('launch.json', 0o444), ('admit', 0o444), ('stdin', 0o400), ('manifest', 0o644)]:
                        file = Path(directory) / name
                        helper.write_bytes(str(file), b'exact payload', mode)
                        self.assertEqual(stat.S_IMODE(file.stat().st_mode), mode)
                        self.assertEqual(file.read_bytes(), b'exact payload')
                    self.assertEqual(os.umask(mask), mask)
                finally:
                    os.umask(previous)

    def test_private_git_checkout_modes_are_independent_of_caller_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'repository'
            source.mkdir()
            def git(*args):
                return subprocess.run(['/usr/bin/git', '-C', str(source), *args], check=True, capture_output=True, env=helper.FIXED_ENV).stdout.decode().strip()
            git('init', '--quiet')
            (source / 'nested').mkdir()
            (source / 'nested' / 'package.json').write_bytes(b'{}\n')
            (source / 'tool').write_bytes(b'#!/bin/sh\nexit 0\n')
            os.chmod(source / 'tool', 0o755)
            git('add', '.')
            git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture')
            commit = git('rev-parse', 'HEAD')
            git('update-ref', 'refs/sec/base', commit)
            git('update-ref', 'refs/sec/head', commit)
            bundle = str(root / 'input.bundle')
            git('bundle', 'create', bundle, 'refs/sec/base', 'refs/sec/head')
            for mask in [0o077, 0o027, 0o022]:
                with self.subTest(umask=oct(mask)):
                    target = root / ('checkout-' + str(mask))
                    previous = os.umask(mask)
                    try:
                        helper.materialize_git({'bundle': {'baseSha': commit}}, str(target), bundle, helper.Deadline((time.time() + 5) * 1000))
                        helper.git(str(target), ['checkout', '--quiet', '--detach', commit], helper.Deadline((time.time() + 5) * 1000))
                        self.assertEqual(os.umask(mask), mask)
                    finally:
                        os.umask(previous)
                    for relative, mode in [('.', 0o755), ('nested', 0o755), ('nested/package.json', 0o644), ('tool', 0o755), ('.git', 0o755)]:
                        self.assertEqual(stat.S_IMODE((target / relative).stat().st_mode), mode)
                    self.assertEqual((target / 'nested' / 'package.json').read_bytes(), b'{}\n')

    def test_hosted_output_is_separate_and_retained_only_for_the_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            output = str(Path(directory))
            state = Path(directory) / 'state'
            state.mkdir(mode=0o700)
            (state / 'record').write_bytes(b'setup state')
            identity = state.stat()
            parent = helper.nofollow_directory(output)
            helper.MOUNT_HANDLES[output] = parent
            try:
                with helper.final_output_directory({'kind': 'source-program'}, output) as regular:
                    self.assertEqual(regular, output)
                with helper.final_output_directory({'kind': 'hosted-sut'}, output) as final:
                    self.assertNotEqual(final, output)
                    retained = helper.MOUNT_HANDLES[final]
                    info = os.fstat(retained)
                    self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), (os.geteuid(), os.getegid(), 0o700))
                    self.assertEqual(list(Path(final).iterdir()), [])
                    helper.write_bytes(final + '/result', b'final bytes')
                    self.assertEqual((Path(final) / 'result').read_bytes(), b'final bytes')
                self.assertNotIn(final, helper.MOUNT_HANDLES)
                with self.assertRaises(OSError):
                    os.fstat(retained)
                self.assertEqual(state.stat().st_ino, identity.st_ino)
                self.assertEqual(stat.S_IMODE(state.stat().st_mode), 0o700)
                self.assertEqual((state / 'record').read_bytes(), b'setup state')
                with self.assertRaisesRegex(RuntimeError, 'launch failed'):
                    with helper.final_output_directory({'kind': 'hosted-sut'}, output) as interrupted:
                        interrupted_fd = helper.MOUNT_HANDLES[interrupted]
                        raise RuntimeError('launch failed')
                self.assertNotIn(interrupted, helper.MOUNT_HANDLES)
                with self.assertRaises(OSError):
                    os.fstat(interrupted_fd)
            finally:
                del helper.MOUNT_HANDLES[output]
                os.close(parent)

    def test_fixed_child_mask_is_observed_before_workload_admission(self):
        # Execute the actual preflight prefix in a fresh child, without its
        # later privileged unit operations. It reads the kernel's own status.
        prefix = helper.LAUNCH_SHIM.split('# Invalid arguments', 1)[0]
        for mask, accepted in [(0o022, True), (0o077, False), (0o027, False)]:
            child = subprocess.run([sys.executable, '-B', '-I', '-S', '-c', prefix], capture_output=True, umask=mask)
            self.assertEqual(child.returncode == 0, accepted)
        for mask in ['0077', '0027']:
            with self.assertRaisesRegex(helper.Unavailable, 'unit-creation-mask'):
                helper.observe_start({'unitName': 'fixture.service'}, {'UMask': mask}, '/unused', '/unused', {})

    def test_dependency_staging_ancestors_are_traversable_without_changing_existing_state(self):
        for mask in [0o077, 0o027, 0o022]:
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                previous = os.umask(mask)
                try:
                    helper.prepare_dependency_namespace(directory)
                finally:
                    os.umask(previous)
                paths = [Path(directory) / p for p in ['.tmp', '.tmp/dependency-installs', '.tmp/dependency-installs/compiler-backups']]
                before = [(p.stat().st_ino, p.stat().st_ctime_ns) for p in paths]
                helper.prepare_dependency_namespace(directory)
                self.assertEqual([(p.stat().st_ino, p.stat().st_ctime_ns) for p in paths], before)
                self.assertEqual([stat.S_IMODE(p.stat().st_mode) for p in paths], [0o755] * 3)
                os.chmod(paths[-1], 0o700)
                with self.assertRaisesRegex(helper.Unavailable, 'dependency-staging-ancestor'):
                    helper.prepare_dependency_namespace(directory)
                self.assertEqual(stat.S_IMODE(paths[-1].stat().st_mode), 0o700)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / 'external'
            external.mkdir(mode=0o700)
            (root / '.tmp').symlink_to(external, target_is_directory=True)
            with self.assertRaises(OSError):
                helper.prepare_dependency_namespace(directory)
            self.assertEqual(list(external.iterdir()), [])

    def test_new_directory_replacement_link_fails_without_changing_external_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / 'external'
            external.mkdir(mode=0o700)
            parent = helper.nofollow_directory(str(root))
            original = os.mkdir
            def replace_after_create(name, mode, *, dir_fd):
                original(name, mode, dir_fd=dir_fd)
                os.rmdir(name, dir_fd=dir_fd)
                os.symlink(str(external), name, dir_fd=dir_fd)
            try:
                with patch.object(helper.os, 'mkdir', replace_after_create):
                    with self.assertRaises(OSError):
                        helper.create_runtime_directory(parent, 'new', 0o755)
                self.assertEqual(stat.S_IMODE(external.stat().st_mode), 0o700)
            finally:
                os.close(parent)


if __name__ == '__main__':
    unittest.main()
