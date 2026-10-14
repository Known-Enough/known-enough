#!/usr/bin/env python3
"""Install one frozen source copy and pinned Node in the caller's own durable home."""
import argparse,hashlib,json,os,pathlib,platform,re,shlex,subprocess,tarfile,urllib.request,uuid
NODE='24.21.0';NPM='11.19.0'
SHAS={'x86_64':('x64','fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6'),'aarch64':('arm64','6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2')}
def download(url,path,expected,maximum):
    if path.exists():
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ValueError('CACHED_ARCHIVE_HASH_MISMATCH')
        return
    request=urllib.request.Request(url,headers={'User-Agent':'KnownEnough-FIX04-pinned-setup'})
    with urllib.request.urlopen(request,timeout=30) as response:
        temporary=path.with_suffix(path.suffix+'.new-'+uuid.uuid4().hex[:8]);total=0;digest=hashlib.sha256()
        with temporary.open('xb') as out:
            os.chmod(temporary,0o600)
            while True:
                chunk=response.read(1024*1024)
                if not chunk:break
                total+=len(chunk)
                if total>maximum:raise ValueError('ARCHIVE_SIZE_LIMIT')
                digest.update(chunk);out.write(chunk)
        if digest.hexdigest()!=expected:raise ValueError('ARCHIVE_HASH_MISMATCH')
        temporary.replace(path)
def extract(archive,destination,expected_root):
    if destination.exists():raise ValueError('SOURCE_DIRECTORY_ALREADY_EXISTS')
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            name=pathlib.PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0]!=expected_root or member.isdev() or member.isfifo():raise ValueError('ARCHIVE_PATH_INVALID')
            if member.issym() or member.islnk():
                target=pathlib.PurePosixPath(member.linkname)
                if target.is_absolute():raise ValueError('ARCHIVE_LINK_INVALID')
                relative=pathlib.PurePosixPath(*name.parts[1:]);linked=pathlib.PurePosixPath(member.linkname);linked=pathlib.PurePosixPath(*linked.parts[1:]) if member.islnk() and linked.parts and linked.parts[0]==expected_root else linked
                resolved=(destination/relative.parent/linked).resolve() if member.issym() else (destination/linked).resolve()
                if not resolved.is_relative_to(destination.resolve()):raise ValueError('ARCHIVE_LINK_INVALID')
    destination.mkdir(mode=0o700)
    subprocess.run(['tar','--extract','--file',str(archive),'--directory',str(destination),'--strip-components=1','--no-same-owner','--no-same-permissions'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source-sha',required=True);parser.add_argument('--archive-sha256',required=True);args=parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}',args.source_sha) or not re.fullmatch('[a-f0-9]{64}',args.archive_sha256):raise ValueError('PINNED_SOURCE_REQUIRED')
    if platform.system()!='Linux' or platform.machine() not in SHAS:raise ValueError('CLOUDSHELL_LINUX_REQUIRED')
    root=pathlib.Path.home()/'.known-enough'/'access-users';root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if root.is_symlink():raise ValueError('PRIVATE_HOME_REQUIRED')
    os.chmod(root,0o700);architecture,node_hash=SHAS[platform.machine()];node_name=f'node-v{NODE}-linux-{architecture}';node_dir=root/node_name;node_archive=root/(node_name+'.tar.xz')
    download(f'https://nodejs.org/dist/v{NODE}/{node_name}.tar.xz',node_archive,node_hash,100*1024*1024)
    if not node_dir.exists():extract(node_archive,node_dir,node_name)
    source=root/('source-'+args.source_sha);archive=root/('source-'+args.source_sha+'.tar.gz')
    download(f'https://codeload.github.com/Known-Enough/known-enough/tar.gz/{args.source_sha}',archive,args.archive_sha256,100*1024*1024)
    if not source.exists():extract(archive,source,'known-enough-'+args.source_sha)
    env={**os.environ,'PATH':str(node_dir/'bin')+os.pathsep+os.environ.get('PATH','')}
    node=node_dir/'bin'/'node';npm=node_dir/'bin'/'npm'
    if subprocess.check_output([str(node),'--version'],env=env,text=True).strip()!='v'+NODE or subprocess.check_output([str(npm),'--version'],env=env,text=True).strip()!=NPM:raise ValueError('PINNED_RUNTIME_MISMATCH')
    marker=source/'.fix04-tool-verified.json'
    with tarfile.open(archive) as frozen:
        files={str(pathlib.PurePosixPath(*pathlib.PurePosixPath(member.name).parts[1:])):hashlib.sha256(frozen.extractfile(member).read()).hexdigest() for member in frozen.getmembers() if member.isfile()}
    if any(not (source/name).resolve().is_relative_to(source.resolve()) or hashlib.sha256((source/name).read_bytes()).hexdigest()!=value for name,value in files.items()):raise ValueError('SOURCE_FILES_CHANGED')
    if marker.exists():
        if json.loads(marker.read_text())!=files:raise ValueError('SOURCE_MANIFEST_CHANGED')
        result='FIX04_TOOL_ALREADY_MATCHED'
    else:
        subprocess.run([str(npm),'ci','--ignore-scripts','--no-audit','--no-fund'],cwd=source,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        marker.write_text(json.dumps(files,sort_keys=True));os.chmod(marker,0o600);result='FIX04_TOOL_SOURCE_VERIFIED'
    wrapper=root/'access-users';wrapper.write_text('#!/usr/bin/env bash\nset -euo pipefail\nexport PATH='+shlex.quote(str(node_dir/'bin'))+':"$PATH"\nexec '+shlex.quote(str(node))+' --no-warnings --experimental-transform-types '+shlex.quote(str(source/'scripts/fix04/access-users.mjs'))+' "$@"\n');os.chmod(wrapper,0o700)
    print(json.dumps({'result':result,'source':args.source_sha,'command':str(wrapper),'awsWrites':0,'providerRequests':0,'emailSent':False}))
if __name__=='__main__':
    try:main()
    except Exception as error:
        safe=error.args[0] if isinstance(error,ValueError) and isinstance(error.args[0],str) and re.fullmatch('[A-Z_]+',error.args[0]) else 'LOCAL_SETUP_UNAVAILABLE'
        print(json.dumps({'result':'FIX04_TOOL_SETUP_BLOCKED','error':safe,'awsWrites':0,'providerRequests':0}));raise SystemExit(1)
