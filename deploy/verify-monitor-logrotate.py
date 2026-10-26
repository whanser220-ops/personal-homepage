#!/usr/bin/env python3
"""Exercise privacy-log rotation in isolated transient units, never real logs.

The fixture inherits the deployed unit's sandbox and capability limits. All
configuration, state, synthetic lines and archives are confined to its own /run
directory; every transient unit has an unpredictable task-owned name.
"""
import configparser
import gzip
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import uuid

REPO = Path(__file__).resolve().parent.parent
LOG_PATH = '/var/log/personal-homepage-monitor/traffic.jsonl'
SOURCE = REPO / 'services/server-monitor/grafana/traffic.logrotate'
UNIT = REPO / 'services/server-monitor/personal-homepage-monitor-logrotate.service'


def candidate_config(log):
    text = SOURCE.read_text()
    if text.count(LOG_PATH) != 1 or any(line.lstrip().startswith('su ') for line in text.splitlines()):
        raise RuntimeError('The root-owned non-writable log directory must not require identity switching')
    return text.replace(LOG_PATH, log.as_posix())


def unit_properties(directory):
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    parser.read(UNIT)
    service = parser['Service']
    properties = [key + '=' + service[key] for key in
                  ('NoNewPrivileges','PrivateTmp','ProtectSystem','ProtectHome','CapabilityBoundingSet')]
    if set(service['CapabilityBoundingSet'].split()) != {'CAP_CHOWN','CAP_DAC_OVERRIDE','CAP_FOWNER'}:
        raise RuntimeError('The rotation fixture must retain the restricted production capabilities')
    properties += ['ReadWritePaths=' + directory.as_posix(), 'TimeoutStartSec=15s']
    return properties


def rotation_command(state, configuration):
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    parser.read(UNIT)
    original = shlex.split(parser['Service']['ExecStart'])
    if (len(original) != 4 or original[:2] != ['/usr/sbin/logrotate','--state'] or
            original[2] != '/var/lib/personal-homepage-monitor-logrotate/status' or
            original[3] != '/etc/personal-homepage-grafana/traffic.logrotate'):
        raise RuntimeError('Unexpected production rotation command')
    return [original[0], '--force', '--state', state.as_posix(), configuration.as_posix()]


def verify():
    import grp
    if os.geteuid() != 0:
        raise RuntimeError('Root is required for the isolated unit fixture')
    group = grp.getgrnam('www-data').gr_gid
    transient_units = []
    with tempfile.TemporaryDirectory(prefix='monitor-logrotate-fixture-',dir='/run') as temporary:
        directory = Path(temporary)
        logs = directory / 'logs'
        logs.mkdir(mode=0o750)
        os.chown(logs,0,group)
        log = logs / 'traffic.jsonl'
        lines = [(json.dumps({'service':'website','status':200,'request_time':.01,'body_bytes_sent':index})+'\n').encode()
                 for index in (101,202,303)]
        log.write_bytes(lines[0])
        log.chmod(0o640)
        os.chown(log,0,group)
        inode = log.stat().st_ino
        configuration = directory / 'rotation.conf'
        configuration.write_text(candidate_config(log))
        configuration.chmod(0o644)
        broken = directory / 'previous.conf'
        broken.write_text(configuration.read_text().replace('\n}', '\n    su root www-data\n}'))
        broken.chmod(0o644)

        def run(config):
            name = 'monitor-logrotate-fixture-' + uuid.uuid4().hex
            transient_units.append(name)
            arguments = ['systemd-run','--unit='+name,'--wait','--collect','--pipe','--quiet']
            for setting in unit_properties(directory):
                arguments += ['--property',setting]
            arguments += rotation_command(directory/'state',config)
            return subprocess.run(arguments,capture_output=True,text=True,timeout=25)

        try:
            previous = run(broken)
            if previous.returncode == 0 or 'Operation not permitted' not in previous.stderr:
                raise RuntimeError('The fixture did not reproduce the restricted setgid failure')
            for index,line in enumerate(lines):
                log.write_bytes(line)
                result = run(configuration)
                if result.returncode:
                    raise RuntimeError('The corrected config failed inside the real restricted unit')
                if (log.stat().st_size != 0 or log.stat().st_ino != inode or
                        log.stat().st_uid != 0 or log.stat().st_gid != group or log.stat().st_mode & 0o777 != 0o640 or
                        (logs/'traffic.jsonl.1').read_bytes() != line):
                    raise RuntimeError('copytruncate changed ownership, inode or expected archived bytes')
                if index:
                    if gzip.decompress((logs/'traffic.jsonl.2.gz').read_bytes()) != lines[index-1]:
                        raise RuntimeError('Compressed rotation did not retain the expected prior observation')
            retained = list(logs.glob('traffic.jsonl.*'))
            if len(retained) != 2:
                raise RuntimeError('Rotation retention is not limited to two archives')
            print(json.dumps({'test':'isolated-real-unit-logrotate','previousSetgidFailureReproduced':True,
                'restrictedCapabilityRotations':3,'copytruncateInodePreserved':True,'privateOwnershipPreserved':True,
                'archivesRetained':2,'productionLogTouched':False}))
        finally:
            for name in transient_units:
                # Only unpredictable names created by this invocation are used.
                subprocess.run(['systemctl','stop',name],capture_output=True,check=False,timeout=10)
                subprocess.run(['systemctl','reset-failed',name],capture_output=True,check=False,timeout=10)


if __name__ == '__main__':
    try:
        verify()
    except Exception as error:
        print(f'Privacy rotation fixture failed ({type(error).__name__})',file=sys.stderr)
        raise SystemExit(1)
