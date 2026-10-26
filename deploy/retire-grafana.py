#!/usr/bin/env python3
"""Reversibly stop the retired dashboard only after the custom UI passes.

prepare is read-only apart from its private backup. finalize changes only the
known service state and the fixed dedicated role's LOGIN bit. No databases,
views, credentials, binaries, samples or sessions are removed or rewritten.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

SERVICE='personal-homepage-grafana.service'
ROLE='monitor_grafana_history'
BACKUP=Path('/var/lib/personal-homepage-grafana-retirement')
APP_ENV=Path('/etc/personal-homepage/app.env')
CONTAINER='personal-homepage-postgres'
PORT=19110


def run(*args,check=True,timeout=30,input=None):
    return subprocess.run(args,check=check,capture_output=True,text=True,timeout=timeout,input=input)


def sql(statement):
    values=dict(line.split('=',1) for line in APP_ENV.read_text().splitlines() if '=' in line and not line.startswith('#'))
    address=urllib.parse.urlsplit(values.get('DATABASE_URL',''))
    user=urllib.parse.unquote(address.username or '');database=urllib.parse.unquote(address.path.lstrip('/'))
    if address.scheme not in ('postgres','postgresql') or not all(re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',value) for value in (user,database)):
        raise RuntimeError('Invalid application database identity')
    return run('docker','exec','-i','-u','postgres',CONTAINER,'psql','-X','-v','ON_ERROR_STOP=1','-U',user,'-d',database,'-At',
        input=statement,timeout=15).stdout.strip()


def role_state():
    value=sql("select json_build_object('login',rolcanlogin,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,"
        "'inherit',rolinherit,'replication',rolreplication,'bypassRls',rolbypassrls,'connections',rolconnlimit,"
        "'comment',shobj_description(oid,'pg_authid')) from pg_roles where rolname='monitor_grafana_history';")
    return json.loads(value) if value else None


def validate_role(value):
    if value is None:return
    if (any(value.get(name) for name in ('super','createDb','createRole','inherit','replication','bypassRls')) or
        value.get('connections')!=2 or not re.fullmatch(r'personal-homepage-grafana-history:[0-9a-f]{32}',value.get('comment') or '') or
        not isinstance(value.get('login'),bool)):
        raise RuntimeError('Refusing to change an unexpected history role')


def unit_state():
    return {'active':run('systemctl','is-active',SERVICE,check=False).returncode==0,
        'enabled':run('systemctl','is-enabled',SERVICE,check=False).stdout.strip() in ('enabled','enabled-runtime')}


def save(value):
    descriptor,temporary=tempfile.mkstemp(prefix='.state-',dir=BACKUP)
    try:
        with os.fdopen(descriptor,'w') as stream:
            os.fchmod(stream.fileno(),0o600)
            stream.write(json.dumps(value));stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,BACKUP/'state.json')
    finally:Path(temporary).unlink(missing_ok=True)


def prepare():
    if BACKUP.exists():raise RuntimeError('Unfinished dashboard retirement transaction')
    role=role_state();validate_role(role)
    BACKUP.mkdir(mode=0o700,parents=True)
    try:save({'unit':unit_state(),'role':role,'touched':False})
    except Exception:shutil.rmtree(BACKUP);raise


def set_login(enabled):
    # Fixed role and fixed syntax only; credentials never appear in SQL/argv.
    sql('begin; alter role '+ROLE+(' login;' if enabled else ' nologin;')+' commit;')


def verify():
    state=unit_state()
    if state['active'] or state['enabled']:raise RuntimeError('Retired dashboard service remains active or enabled')
    role=role_state();validate_role(role)
    if role and role['login']:raise RuntimeError('Retired dashboard database login remains enabled')
    for line in run('ss','-lntH').stdout.splitlines():
        if len(line.split())>=4 and line.split()[3].rpartition(':')[2]==str(PORT):
            raise RuntimeError('Retired dashboard port remains reachable')


def finalize():
    metadata=json.loads((BACKUP/'state.json').read_text())
    current=role_state();validate_role(current)
    if current!=metadata['role']:raise RuntimeError('Dashboard role changed during deployment')
    metadata['touched']=True;save(metadata)
    # Closing the process closes its dedicated PostgreSQL connections first.
    run('systemctl','stop',SERVICE,check=False)
    if unit_state()['active']:raise RuntimeError('Retired dashboard did not stop')
    run('systemctl','disable',SERVICE,check=False)
    if current and current['login']:set_login(False)
    verify()


def rollback():
    if not (BACKUP/'state.json').exists():return
    metadata=json.loads((BACKUP/'state.json').read_text())
    if metadata['touched']:
        current=role_state();validate_role(current)
        if metadata['role'] is not None:
            if current is None:raise RuntimeError('Dedicated history role disappeared during rollback')
            set_login(metadata['role']['login'])
        # Restore database authentication BEFORE starting the old service.
        run('systemctl','enable' if metadata['unit']['enabled'] else 'disable',SERVICE,check=False)
        if metadata['unit']['active']:run('systemctl','start',SERVICE)
    shutil.rmtree(BACKUP)


def commit():
    if BACKUP.exists():shutil.rmtree(BACKUP)


def main():
    if os.geteuid()!=0:raise RuntimeError('Root is required')
    action=sys.argv[1] if len(sys.argv)==2 else ''
    actions={'prepare':prepare,'finalize':finalize,'verify':verify,'rollback':rollback,'commit':commit}
    if action not in actions:raise RuntimeError('Expected prepare, finalize, verify, rollback or commit')
    actions[action]()


if __name__=='__main__':
    try:main();print('Retired dashboard transaction step passed')
    except Exception as error:
        print('Dashboard retirement step failed ('+type(error).__name__+')',file=sys.stderr);raise SystemExit(1)
