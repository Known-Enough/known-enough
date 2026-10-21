"""Native host atomic writer used by the Windows browser controller over WSL."""
import os,pathlib,sys,tempfile
p=pathlib.Path(sys.argv[1]).resolve()
allowed=[pathlib.Path('/home/battousai/projects/known-enough/test-results/E2E04'),pathlib.Path.home()/'.known-enough/e2e04']
if not any(p.is_relative_to(root) for root in allowed):raise SystemExit('OUTPUT_PATH_DENIED')
p.parent.mkdir(parents=True,exist_ok=True)
fd,tmp=tempfile.mkstemp(prefix='.'+p.name+'.',dir=p.parent)
try:
 with os.fdopen(fd,'wb') as f:
  f.write(sys.stdin.buffer.read());f.flush();os.fsync(f.fileno())
 os.replace(tmp,p)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
