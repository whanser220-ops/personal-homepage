#!/usr/bin/env python3
"""Independent privacy log and rotation transaction, preserving the live inode.

The old policy is retained for restoring a prior unit during rollback. Neither
the log, its archives, nor the existing rotation state file are removed.
"""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parent.parent
CONFIG = Path('/etc/personal-homepage-monitor/traffic.logrotate')
LOG_DIR = Path('/var/log/personal-homepage-monitor')
LOG = LOG_DIR / 'traffic.jsonl'
SERVICE = 'personal-homepage-monitor-logrotate.service'
TIMER = 'personal-homepage-monitor-logrotate.timer'
BACKUP = Path('/var/lib/personal-homepage-logrotate-deployment')
UNITS = [SERVICE,TIMER]
TARGETS = [CONFIG,*[Path('/etc/systemd/system')/unit for unit in UNITS]]


def run(*args,check=True,timeout=30):
    return subprocess.run(args,capture_output=True,text=True,check=check,timeout=timeout)


def write(path,data,mode=0o644):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix='.'+path.name,dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            os.fchmod(stream.fileno(),mode)
            stream.write(data.encode() if isinstance(data,str) else data)
            stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def unit_state(unit):
    return {'active':run('systemctl','is-active',unit,check=False).returncode==0,
        'enabled':run('systemctl','is-enabled',unit,check=False).stdout.strip() in ('enabled','enabled-runtime')}


def snapshot():
    if BACKUP.exists():
        raise RuntimeError('Unfinished privacy rotation transaction')
    BACKUP.mkdir(mode=0o700,parents=True)
    try:
        state={'units':{name:unit_state(name) for name in UNITS},'files':[]}
        for index,path in enumerate(TARGETS):
            entry={'path':str(path),'exists':path.exists()}
            if path.exists():
                if not path.is_file() or path.is_symlink():raise RuntimeError('Unexpected rotation file type')
                info=path.stat();entry.update(mode=info.st_mode&0o777,uid=info.st_uid,gid=info.st_gid)
                write(BACKUP/str(index),path.read_bytes(),0o600)
            state['files'].append(entry)
        write(BACKUP/'state.json',json.dumps(state),0o600)
    except Exception:
        shutil.rmtree(BACKUP);raise


def prepare_log():
    import grp
    gid=grp.getgrnam('www-data').gr_gid
    if LOG_DIR.is_symlink() or LOG.is_symlink():raise RuntimeError('Privacy log must not be a symlink')
    LOG_DIR.mkdir(parents=True,exist_ok=True)
    os.chown(LOG_DIR,0,gid);LOG_DIR.chmod(0o750)
    fd=os.open(LOG,os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW|os.O_NONBLOCK,0o640)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):raise RuntimeError('Privacy log must be a regular file')
        os.fchown(fd,0,gid);os.fchmod(fd,0o640)
    finally:os.close(fd)


def verify():
    import grp
    gid=grp.getgrnam('www-data').gr_gid
    for path,mode in [(LOG_DIR,0o750),(LOG,0o640)]:
        info=path.stat()
        if path.is_symlink() or (path==LOG and not stat.S_ISREG(info.st_mode)) or info.st_uid!=0 or info.st_gid!=gid or info.st_mode&0o777!=mode:
            raise RuntimeError('Privacy log ownership or mode is invalid')
    if not unit_state(TIMER)['active'] or not unit_state(TIMER)['enabled']:
        raise RuntimeError('Privacy rotation timer is not enabled and active')
    result=dict(line.split('=',1) for line in run('systemctl','show',SERVICE,'-p','Result','-p','ExecMainStatus').stdout.splitlines() if '=' in line)
    if result.get('Result')!='success' or result.get('ExecMainStatus')!='0':
        raise RuntimeError('Normal privacy rotation failed')
    installed=(Path('/etc/systemd/system')/SERVICE).read_text()
    if str(CONFIG) not in installed or 'personal-homepage-grafana' in installed:
        raise RuntimeError('Rotation must use its independent policy path')


def install_runtime():
    prepare_log()
    sources={CONFIG:REPO/'services/server-monitor/traffic.logrotate',
        **{Path('/etc/systemd/system')/unit:REPO/'services/server-monitor'/unit for unit in UNITS}}
    for target,source in sources.items():
        data=source.read_bytes()
        if not target.exists() or target.read_bytes()!=data:write(target,data)
    run('/usr/sbin/logrotate','--debug',str(CONFIG))
    run('systemctl','daemon-reload')
    run('systemctl','enable',TIMER)
    run('systemctl','start',TIMER)
    # Normal execution; this never forces early production rotation.
    run('systemctl','start',SERVICE)


def prepare():
    run(sys.executable,str(REPO/'deploy/verify-monitor-logrotate.py'),timeout=90)
    snapshot()
    try:
        install_runtime();verify()
    except Exception:
        rollback();raise


def rollback():
    if not (BACKUP/'state.json').exists():return
    state=json.loads((BACKUP/'state.json').read_text())
    run('systemctl','stop',TIMER,SERVICE,check=False)
    for index,entry in enumerate(state['files']):
        target=Path(entry['path'])
        if entry['exists']:
            write(target,(BACKUP/str(index)).read_bytes(),entry['mode'])
            os.chown(target,entry['uid'],entry['gid'])
        else:target.unlink(missing_ok=True)
    run('systemctl','daemon-reload')
    for name,previous in state['units'].items():
        run('systemctl','enable' if previous['enabled'] else 'disable',name,check=False)
        if previous['active']:run('systemctl','start',name)
    shutil.rmtree(BACKUP)


def commit():
    if BACKUP.exists():shutil.rmtree(BACKUP)


def main():
    if os.geteuid()!=0:raise RuntimeError('Root is required')
    action=sys.argv[1] if len(sys.argv)==2 else ''
    actions={'prepare':prepare,'verify':verify,'rollback':rollback,'commit':commit}
    if action not in actions:raise RuntimeError('Expected prepare, verify, rollback or commit')
    actions[action]()


if __name__=='__main__':
    try:main();print('Independent privacy rotation step passed')
    except Exception as error:
        print('Privacy rotation step failed ('+type(error).__name__+')',file=sys.stderr);raise SystemExit(1)
