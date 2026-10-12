/**
 * Fixed root-side program for the one authenticated disposable-VM bootstrap.
 * It is never supplied by a caller. stdin is bounded plan data, not Python or
 * shell source. All child programs/argv, paths and environment are closed here.
 * The parent's retained process owner also enforces the original deadline.
 */
export const LINUX_HOSTED_BOOTSTRAP_HELPER = String.raw`
import os, sys, time, signal
os.environ.clear()
os.environ.update({'PATH':'', 'HOME':'/root', 'LANG':'C', 'LC_ALL':'C'})
os.umask(0o077)
if os.getuid() != 0 or os.geteuid() != 0: raise RuntimeError('root-required')
if len(sys.argv)!=2 or not sys.argv[1].isascii() or not sys.argv[1].isdecimal(): raise RuntimeError('deadline-argument')
original_deadline=int(sys.argv[1])
deadline = original_deadline / 1000
if deadline <= time.time(): raise RuntimeError('expired')
monotonic_deadline = time.monotonic() + deadline - time.time()
def remaining():
    value = min(deadline-time.time(), monotonic_deadline-time.monotonic())
    if value <= 0: raise RuntimeError('expired')
    return value
if os.getpgrp() != os.getpid(): os.setsid()
group = os.getpgrp()
if group != os.getpid(): raise RuntimeError('root-group')
child = None
def stop(signum, frame):
    # The root worker owns this exact group. It never signals arbitrary PIDs.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    try: os.killpg(group, signal.SIGKILL)
    finally: os._exit(124)
for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT, signal.SIGALRM): signal.signal(sig, stop)
signal.setitimer(signal.ITIMER_REAL, remaining())
# The absolute root-side timer is armed before reading stdin or importing the
# larger standard-library closure. A stuck input cannot postpone the budget.
import json, subprocess, socket, http.client, hashlib, stat, re, selectors
def exact_pairs(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise RuntimeError('duplicate-json-key')
        result[key]=value
    return result
def exact_json(data): return json.loads(data, object_pairs_hook=exact_pairs)
raw = sys.stdin.buffer.read(131073)
if len(raw) > 131072: raise RuntimeError('request-bound')
request = exact_json(raw)
if set(request) != {'mode','id','root','deadline','profileName','profileBytes','profileDigest','expectedConfig'}: raise RuntimeError('request-shape')
if request['mode'] not in ('apply','observe','retire') or request['deadline']!=original_deadline: raise RuntimeError('mode-or-deadline')
if not re.fullmatch('[0-9a-f]{32}', request['id']): raise RuntimeError('id')

def nofollow_dir(value, administrator=False):
    if not value.startswith('/') or os.path.normpath(value) != value: raise RuntimeError('path')
    fd = os.open('/', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in value.split('/')[1:]:
            if not part: continue
            nxt = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = nxt
            current=os.fstat(fd)
            if administrator and (current.st_uid!=0 or current.st_mode&0o022): raise RuntimeError('administrator-chain')
        return fd
    except: os.close(fd); raise

root = request['root']
if set(root) != {'path','device','inode','uid'} or root['path'] != '/tmp/sec-host-bootstrap-'+request['id']: raise RuntimeError('root-path')
rootfd = nofollow_dir(root['path'])
rootstat = os.fstat(rootfd)
if (str(rootstat.st_dev),str(rootstat.st_ino),rootstat.st_uid,stat.S_IMODE(rootstat.st_mode)) != (root['device'],root['inode'],root['uid'],0o700): raise RuntimeError('root-identity')
start = open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19]
print(json.dumps({'kind':'root-start','id':request['id'],'pid':os.getpid(),'group':group,'start':start}), flush=True)
while True:
    remaining()
    try:
        admit = os.open('admit', os.O_RDONLY|os.O_NOFOLLOW, dir_fd=rootfd)
    except FileNotFoundError: time.sleep(min(0.01,remaining())); continue
    try:
        info = os.fstat(admit)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != root['uid'] or info.st_nlink != 1 or os.read(admit,128) != request['id'].encode(): raise RuntimeError('admit')
    finally: os.close(admit)
    break

def digest(data): return 'sha256:'+hashlib.sha256(data).hexdigest()
def read_file_at(parent,name,limit):
    fd = os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0 or stat.S_IMODE(info.st_mode) not in (0o400,0o444,0o600,0o644): raise RuntimeError('root-file')
        data = os.read(fd,limit+1)
        if len(data)>limit: raise RuntimeError('read-bound')
        return data, {'device':str(info.st_dev),'inode':str(info.st_ino),'mode':stat.S_IMODE(info.st_mode),'gid':info.st_gid,'digest':digest(data)}
    finally: os.close(fd)

def run_tool(args, data=None):
    global child
    remaining()
    child = subprocess.Popen(args,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'','HOME':'/root','LANG':'C','LC_ALL':'C'},close_fds=True)
    try:
        if data is not None:
            child.stdin.write(data); child.stdin.close()
        chunks=[]; total=0
        with selectors.DefaultSelector() as ready:
            ready.register(child.stdout,selectors.EVENT_READ)
            ready.register(child.stderr,selectors.EVENT_READ)
            while ready.get_map():
                for key,events in ready.select(min(0.1,remaining())):
                    part=os.read(key.fileobj.fileno(),8192)
                    if not part: ready.unregister(key.fileobj); continue
                    total+=len(part)
                    if total>262144: raise RuntimeError('tool-output-bound')
                    if key.fileobj is child.stdout: chunks.append(part)
        child.wait(timeout=remaining())
        if child.returncode != 0: raise RuntimeError('platform-tool-failed')
        return b''.join(chunks)
    finally:
        if child.poll() is None:
            child.kill(); child.wait(timeout=max(0.001,remaining()))
        child = None

daemon_peer = None
class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        global daemon_peer
        self.sock = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.settimeout(min(5,remaining()))
        self.sock.connect('/run/docker.sock')
        import struct
        pid,uid,gid = struct.unpack('3i',self.sock.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
        if uid != 0 or pid <= 0: raise RuntimeError('daemon-peer')
        peerstart=open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()[19]
        inode=os.stat('/run/docker.sock',follow_symlinks=False)
        if not stat.S_ISSOCK(inode.st_mode): raise RuntimeError('daemon-socket')
        observed_peer={'pid':pid,'start':peerstart,'uid':uid,'device':str(inode.st_dev),'inode':str(inode.st_ino)}
        if daemon_peer is not None and daemon_peer != observed_peer: raise RuntimeError('daemon-peer-changed')
        daemon_peer=observed_peer
def docker(route):
    conn = DockerConnection('localhost',timeout=min(5,remaining()))
    try:
        conn.request('GET',route,headers={'Connection':'close'})
        response = conn.getresponse()
        body = response.read(1048577)
        if response.status!=200 or len(body)>1048576: raise RuntimeError('daemon-readback')
        return exact_json(body)
    finally: conn.close()

name = request['profileName']
profile = request['profileBytes']
if name is None:
    if profile is not None or request['profileDigest'] is not None: raise RuntimeError('profile-shape')
else:
    if not re.fullmatch('sec-sut-[0-9a-f]{32}',name) or not isinstance(profile,str) or len(profile)>32768 or digest(profile.encode()) != request['profileDigest']: raise RuntimeError('profile-shape')
    if ('profile '+name+' flags=') not in profile or '#include' in profile: raise RuntimeError('profile-source')
def profiles():
    with open('/sys/kernel/security/apparmor/profiles','rb') as stream: value=stream.read(1048577)
    if len(value)>1048576: raise RuntimeError('profile-bound')
    return value.decode().splitlines()
def profile_present(): return name is not None and name+' (enforce)' in profiles()
def containers():
    value = docker('/v1.48/containers/json?all=1')
    if not isinstance(value,list) or len(value)>1024: raise RuntimeError('container-bound')
    return value

directory = nofollow_dir('/etc/docker',True)
ds = os.fstat(directory)
if ds.st_uid!=0 or ds.st_mode&0o022: raise RuntimeError('config-parent')
try: original, before = read_file_at(directory,'daemon.json',65536)
except FileNotFoundError: original, before = b'{}', None
config = exact_json(original)
if not isinstance(config,dict) or not isinstance(config.get('features',{}),dict): raise RuntimeError('config-shape')
version = docker('/version')
if version.get('Version') != '28.0.4': raise RuntimeError('daemon-version')
changed = False
profile_loaded = False
expected_final_config=before
expected_final_bytes=original
if request['mode']=='apply':
    if containers(): raise RuntimeError('preexisting-containers')
    if name is not None and any(line.split(' (',1)[0]==name for line in profiles()): raise RuntimeError('foreign-profile')
    if config.get('features',{}).get('containerd-snapshotter') is not True:
        # The only admitted configuration change. Preserve every other value.
        config['features'] = dict(config.get('features',{}))
        config['features']['containerd-snapshotter'] = True
        data = (json.dumps(config,sort_keys=True,separators=(',',':'))+'\n').encode()
        if len(data)>65536: raise RuntimeError('config-bound')
        tmp = '.sec-bootstrap-'+request['id']
        fd = os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=directory)
        try:
            temporary=os.fstat(fd)
            print(json.dumps({'kind':'config-intent','id':request['id'],'path':'/etc/docker/'+tmp,'device':str(temporary.st_dev),'inode':str(temporary.st_ino),'before':before}),flush=True)
            os.fchmod(fd,0o644 if before is None else before['mode'])
            os.fchown(fd,0,0 if before is None else before['gid'])
            written=0
            while written<len(data): written+=os.write(fd,data[written:])
            os.fsync(fd)
            written_stat=os.fstat(fd)
            expected_final_config={'device':str(written_stat.st_dev),'inode':str(written_stat.st_ino),'mode':stat.S_IMODE(written_stat.st_mode),'gid':written_stat.st_gid,'digest':digest(data)}
            expected_final_bytes=data
        finally: os.close(fd)
        try:
            current, now = read_file_at(directory,'daemon.json',65536)
            if before is None or now != before or current != original: raise RuntimeError('config-drift')
        except FileNotFoundError:
            if before is not None: raise RuntimeError('config-drift')
        remaining()
        os.rename(tmp,'daemon.json',src_dir_fd=directory,dst_dir_fd=directory)
        os.fsync(directory)
        changed=True
        print(json.dumps({'kind':'config-published','id':request['id'],'path':'/etc/docker/daemon.json','device':str(temporary.st_dev),'inode':str(temporary.st_ino)}),flush=True)
        run_tool(['/usr/bin/systemctl','--no-ask-password','restart','docker.service'])
        # Only this deliberate pre-retention restart may change the peer.
        daemon_peer=None
    if name is not None:
        # No parser defaults, caches, parallel compilation, or ambient includes.
        run_tool(['/usr/sbin/apparmor_parser','--config-file=/dev/null','--skip-cache','--jobs=0','--Werror','--add'],profile.encode())
        profile_loaded=True
elif request['mode']=='retire':
    if name is not None:
        if not profile_present(): raise RuntimeError('owned-profile-missing')
        for item in containers():
            cid=item.get('Id')
            if not isinstance(cid,str) or not re.fullmatch('[0-9a-f]{64}',cid): raise RuntimeError('container-id')
            inspected=docker('/v1.48/containers/'+cid+'/json')
            if inspected.get('AppArmorProfile')==name: raise RuntimeError('profile-still-in-use')
        run_tool(['/usr/sbin/apparmor_parser','--config-file=/dev/null','--skip-cache','--jobs=0','--remove'],profile.encode())
        if any(line.split(' (',1)[0]==name for line in profiles()): raise RuntimeError('profile-retire-readback')

final_bytes, final_config = read_file_at(directory,'daemon.json',65536)
if exact_json(final_bytes).get('features',{}).get('containerd-snapshotter') is not True: raise RuntimeError('feature-readback')
if request['mode']=='apply':
    if final_config!=expected_final_config or final_bytes!=expected_final_bytes: raise RuntimeError('config-publish-readback')
elif final_config!=request['expectedConfig']: raise RuntimeError('config-drift')
info=docker('/v1.48/info')
if info.get('DriverStatus') is None or ['driver-type','io.containerd.snapshotter.v1'] not in info['DriverStatus']: raise RuntimeError('snapshotter-readback')
if name is not None and request['mode']!='retire' and not profile_present(): raise RuntimeError('profile-enforcement')
remaining()
version=docker('/version')
if version.get('Version')!='28.0.4': raise RuntimeError('daemon-version')
print(json.dumps({'kind':'result','id':request['id'],'config':final_config,'restarted':changed,'profile':name,'profileInputDigest':request['profileDigest'],'profileState':('absent' if request['mode']=='retire' or name is None else 'enforce'),'daemonId':info.get('ID'),'daemonVersion':version.get('Version'),'daemonPeer':daemon_peer}),flush=True)
os.close(directory); os.close(rootfd)
`;
