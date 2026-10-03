import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';

/** Required semantics only. Neither this policy nor its digest grants root access. */
export const LINUX_HOSTED_BOOTSTRAP_PROFILE = Object.freeze({
  schema: 'sec-linux-hosted-vm-bootstrap-v1',
  platform: 'authenticated-exclusive-disposable-github-ubuntu-24.04-x64',
  privilegedEntry: 'retained-original-root-owned-sudo-inode-fixed-helper',
  privilegePrerequisites: Object.freeze(['setuid', 'not-nosuid', 'no-new-privileges-clear', 'noninteractive-sudoers']),
  dockerVersion: '28.0.4',
  dockerEndpoint: '/run/docker.sock',
  dockerConfiguration: '/etc/docker/daemon.json',
  daemonChange: 'preserve-other-fields-enable-containerd-snapshotter-restart-only-on-disabled-to-enabled-transition',
  laterPhase: 'read-current-enabled-config-and-daemon-without-restart',
  daemonAdmission: 'no-existing-containers',
  daemonResidueOwner: 'authenticated-disposable-job-vm',
  appArmor: 'docker-28-default-restrictions-with-exact-sut-mount-root-exceptions',
  maximumSandboxRoots: 2,
  maximumConfigurationBytes: 65536,
  lifetime: 'original-operation-deadline-no-refresh',
  processSettlement: 'sudo-and-independent-root-process-group-physical-readback',
  qualification: 'actual-oci-export-and-original-sut-self-test-still-required'
} as const);

export function canonicalHostedSandboxRoots(roots: readonly string[]): readonly string[] {
  if (!Array.isArray(roots) || roots.length > LINUX_HOSTED_BOOTSTRAP_PROFILE.maximumSandboxRoots) throw new Error('Hosted bootstrap sandbox roots are not a closed exact set.');
  const captured: string[] = [];
  for (let index = 0; index < roots.length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(roots, index);
    if (slot === undefined || !('value' in slot) || typeof slot.value !== 'string'
        || !/^\/tmp\/sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(slot.value)) throw new Error('Hosted bootstrap sandbox roots are not a closed exact set.');
    captured.push(slot.value);
  }
  if (new Set(captured).size !== captured.length) throw new Error('Hosted bootstrap sandbox roots are not a closed exact set.');
  return Object.freeze(captured.sort());
}

// Adapted from Moby v28.0.4 profiles/apparmor/template.go (Apache-2.0).
// Includes are deliberately absent: the complete accepted policy is source-owned,
// not an ambient /etc/apparmor.d include/search closure. Only /proc is used.
const restrictions = `  network,
  capability,
  file,
  signal (receive) peer=unconfined,
  signal (receive) peer=runc,
  signal (receive) peer=crun,
  signal (receive) peer=/usr/bin/dockerd,
  deny /proc/* w,
  deny /proc/{[^1-9],[^1-9][^0-9],[^1-9s][^0-9y][^0-9s],[^1-9][^0-9][^0-9][^0-9/]*}/** w,
  deny /proc/sys/[^k]** w,
  deny /proc/sys/kernel/{?,??,[^s][^h][^m]**} w,
  deny /proc/sysrq-trigger rwklx,
  deny /proc/kcore rwklx,
  deny /sys/[^f]*/** wklx,
  deny /sys/f[^s]*/** wklx,
  deny /sys/fs/[^c]*/** wklx,
  deny /sys/fs/c[^g]*/** wklx,
  deny /sys/fs/cg[^r]*/** wklx,
  deny /sys/firmware/** rwklx,
  deny /sys/devices/virtual/powercap/** rwklx,
  deny /sys/kernel/security/** rwklx,`;

/** Data compiler, never an AppArmor loading capability. */
export function compileHostedSutAppArmorProfile(input: Readonly<{
  profileName: string;
  sandboxRoots: readonly string[];
}>): Readonly<{ name: string; roots: readonly string[]; bytes: string; digest: `sha256:${string}` }> {
  const name = input.profileName;
  if (!/^sec-sut-[0-9a-f]{32}$/u.test(name)) throw new Error('Hosted AppArmor profile name is not owner-scoped.');
  const roots = canonicalHostedSandboxRoots(input.sandboxRoots);
  if (roots.length === 0) throw new Error('SUT AppArmor policy requires an exact sandbox root.');
  const mounts = ['  mount options=(rw,rprivate) -> /,'];
  for (const root of roots) {
    for (const leaf of ['', '/workspace']) mounts.push(`  mount fstype=tmpfs options=(rw,nosuid,nodev) tmpfs -> ${root}${leaf}/,`);
    for (const leaf of ['/tmp', '/home']) mounts.push(`  mount fstype=tmpfs options=(rw,nosuid,nodev,noexec) tmpfs -> ${root}${leaf}/,`);
    mounts.push(`  mount fstype=tmpfs options=(rw,nosuid,noexec) tmpfs -> ${root}/dev/,`);
    for (const device of ['null', 'zero', 'random', 'urandom']) {
      mounts.push(`  mount options=(rw,bind) /dev/${device} -> ${root}/dev/${device},`);
      mounts.push(`  mount options=(rw,remount,bind,nosuid,noexec) -> ${root}/dev/${device},`);
    }
    mounts.push(`  mount fstype=proc options=(rw,nosuid,nodev,noexec) proc -> ${root}/proc/,`);
    mounts.push(`  umount ${root}/{,**},`);
  }
  // AppArmor path mediation after chroot may use the new root-relative alias.
  // Its only mount operation is the existing trusted proc setup, before uid/cap drop.
  mounts.push('  mount fstype=proc options=(rw,nosuid,nodev,noexec) proc -> /proc/,');
  const bytes = `# SEC source-owned SUT profile; default-deny mount, exact exceptions only.\nprofile ${name} flags=(attach_disconnected,mediate_deleted) {\n${restrictions}\n  signal (send,receive) peer=${name},\n  ptrace (trace,read,tracedby,readby) peer=${name},\n${mounts.join('\n')}\n}\n`;
  return Object.freeze({ name, roots, bytes, digest: rawSha256(Buffer.from(bytes)) });
}

/** Source-owned exact MainHealth setup exception. The authenticated original
 * bootstrap selects this profile only for its real MainHealth job; this pure
 * compiler never issues permission or proves that the kernel loaded it. */
export function compileHostedMainHealthAppArmorProfile(profileName: string): ReturnType<typeof compileHostedSutAppArmorProfile> {
  if (!/^sec-sut-[0-9a-f]{32}$/u.test(profileName)) throw new Error('MainHealth profile name is not owner-scoped.');
  const bytes = `# SEC MainHealth: one source-superblock freeze; no writable remount or namespace setup.\nprofile ${profileName} flags=(attach_disconnected,mediate_deleted) {\n${restrictions}\n  signal (send,receive) peer=${profileName},\n  ptrace (trace,read,tracedby,readby) peer=${profileName},\n  mount options=(ro,remount,nosuid,nodev,noexec) -> /sec-runtime/,\n}\n`;
  return Object.freeze({ name: profileName, roots: Object.freeze([]), bytes, digest: rawSha256(Buffer.from(bytes)) });
}

// Bind the actual emitted restriction/mount grammar as well as its declared
// policy. These fixed canonical sample names do not grant runtime ownership.
export const LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST = sha256({
  policy: LINUX_HOSTED_BOOTSTRAP_PROFILE,
  appArmorGrammar: compileHostedSutAppArmorProfile({
    profileName: `sec-sut-${'0'.repeat(32)}`,
    sandboxRoots: [`/tmp/sec-sut-${'0'.repeat(16)}-${'0'.repeat(32)}`]
  }).bytes,
  mainHealthAppArmorGrammar: compileHostedMainHealthAppArmorProfile(`sec-sut-${'0'.repeat(32)}`).bytes
});
