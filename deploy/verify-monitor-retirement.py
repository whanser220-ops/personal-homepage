#!/usr/bin/env python3
"""Run the retirement transaction on an isolated PG + systemd fixture only.

No production database, service, environment file or public route is changed.
The container has no network or published ports and only the cached PG image.
"""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import uuid


def execute(*args, check=True, input=None):
    return subprocess.run(args,capture_output=True,text=True,check=check,input=input,timeout=30)


def verify():
    if os.geteuid()!=0:raise RuntimeError('Root is required for the isolated fixture')
    identity=uuid.uuid4().hex
    name='monitor-retirement-fixture-'+identity[:12]
    label='personal-homepage.monitor-retirement-fixture'
    unit=name+'.service'
    unit_path=Path('/run/systemd/system')/unit
    spec=importlib.util.spec_from_file_location('retirement_fixture',Path(__file__).with_name('retire-grafana.py'))
    installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
    def sql(statement):
        return execute('docker','exec','-i','-u','postgres',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','fixture','-d','fixture','-At',input=statement).stdout.strip()
    def login_succeeds():
        return execute('docker','exec','-u','postgres',name,'psql','-X','-h','127.0.0.1','-U',installer.ROLE,'-d','fixture','-At','-c','select 1',check=False).returncode==0
    def require(condition):
        if not condition:raise RuntimeError('Isolated retirement state or data check failed')
    created=False
    with tempfile.TemporaryDirectory(prefix=name+'-',dir='/run') as temporary:
        installer.BACKUP=Path(temporary)/'backup'
        installer.SERVICE=unit
        # Only the fixture's empty port is checked; the actual dashboard remains up.
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0));installer.PORT=reservation.getsockname()[1]
        installer.sql=sql
        try:
            execute('docker','run','--detach','--name',name,'--label',label+'='+identity,
                '--network','none','--memory','128m','--cpus','0.5','--pids-limit','64',
                '--env','POSTGRES_USER=fixture','--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine')
            created=True
            for attempt in range(40):
                if execute('docker','exec',name,'pg_isready','-q','-U','fixture',check=False).returncode==0:break
                if attempt==39:raise RuntimeError('Isolated PostgreSQL readiness failed')
                time.sleep(.5)
            sql("create role monitor_grafana_history login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2;"
                "comment on role monitor_grafana_history is 'personal-homepage-grafana-history:"+identity+"';"
                "create table monitor_samples(value text);insert into monitor_samples values ('preserve-samples');"
                "create table monitor_sessions(value text);insert into monitor_sessions values ('preserve-sessions');")
            unit_path.write_text('[Unit]\nDescription=Isolated monitor retirement fixture\n[Service]\nExecStart=/usr/bin/sleep 180\nMemoryMax=16M\nNoNewPrivileges=yes\n')
            unit_path.chmod(0o644)
            execute('systemctl','daemon-reload');execute('systemctl','start',unit)
            before=installer.role_state();require(login_succeeds())
            installer.prepare();require(installer.unit_state()['active'] and installer.role_state()==before)
            installer.rollback();require(installer.unit_state()['active'] and login_succeeds())
            installer.prepare();installer.finalize()
            require(not installer.unit_state()['active'] and not login_succeeds() and not installer.role_state()['login'])
            installer.rollback()
            require(installer.unit_state()['active'] and installer.role_state()==before and login_succeeds())
            installer.prepare();installer.finalize();installer.commit()
            require(not installer.BACKUP.exists() and not login_succeeds())
            require(sql("select value from monitor_samples union all select value from monitor_sessions order by value;")=='preserve-samples\npreserve-sessions')
            print(json.dumps({'test':'isolated-monitor-retirement','readOnlyPrepare':True,'noLogin':True,
                'loginBeforeServiceRollback':True,'samplesAndSessionsPreserved':True,'network':'none'}))
        finally:
            execute('systemctl','stop',unit,check=False)
            if unit_path.exists():unit_path.unlink()
            execute('systemctl','daemon-reload',check=False)
            if created:
                proof=execute('docker','inspect','--format','{{json .Config.Labels}}',name,check=False)
                if proof.returncode==0 and json.loads(proof.stdout).get(label)==identity:
                    execute('docker','rm','--force','--volumes',name)
                else:raise RuntimeError('Fixture cleanup identity mismatch')


if __name__=='__main__':
    try:verify()
    except Exception as error:
        print('Isolated retirement fixture failed ('+type(error).__name__+')',file=sys.stderr);raise SystemExit(1)
