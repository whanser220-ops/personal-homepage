#!/usr/bin/env python3
"""A private, SELECT-only Grafana view over retained pre-Prometheus samples.

Only the fixed role/view and their own grants are changed. Application samples,
sessions and OAuth tables are never written. SQL is passed on stdin, and neither
SQL, credentials, command stderr nor role snapshots are printed.
"""
import base64
from datetime import datetime, timezone
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import uuid

APP_ENV = Path('/etc/personal-homepage/app.env')
MONITOR_ENV = Path('/etc/personal-homepage-monitor/web.env')
HISTORY_ENV = Path('/etc/personal-homepage-grafana/history.env')
BACKUP = Path('/var/lib/personal-homepage-grafana-history-deployment')
CONTAINER = 'personal-homepage-postgres'
NETWORK = 'personal-homepage-net'
ROLE = 'monitor_grafana_history'
VIEW = 'monitor_grafana_resource_history'
GROUP = 'sre-grafana'
FIELDS = {
    'cpu_percent': ('cpu', 'percent'), 'memory_percent': ('memory', 'usedPercent'),
    'swap_percent': ('swap', 'usedPercent'), 'disk_percent': ('disk', 'usedPercent'),
    'disk_read_bytes_per_second': ('disk', 'readBytesPerSecond'),
    'disk_write_bytes_per_second': ('disk', 'writeBytesPerSecond'),
    'rx_bytes_per_second': ('network', 'rxBytesPerSecond'),
    'tx_bytes_per_second': ('network', 'txBytesPerSecond'),
}
ENV_KEYS = {'MONITOR_HISTORY_HOST', 'MONITOR_HISTORY_PORT', 'MONITOR_HISTORY_DATABASE',
            'MONITOR_HISTORY_USER', 'MONITOR_HISTORY_PASSWORD'}


def read_env(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if line and not line.startswith('#') and '=' in line) if path.exists() else {}


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def identifier(value):
    return '"' + str(value).replace('"', '""') + '"'


def write(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), mode)
            output.write(value.encode() if isinstance(value, str) else value)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def database_identity():
    address = urllib.parse.urlsplit(read_env(APP_ENV).get('DATABASE_URL', ''))
    user = urllib.parse.unquote(address.username or '')
    database = urllib.parse.unquote(address.path.lstrip('/'))
    if address.scheme not in ('postgres', 'postgresql') or not all(re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', value) for value in (user, database)):
        raise RuntimeError('invalid_application_database_identity')
    return {'user': user, 'database': database}


def private_ipv4(value):
    address = ipaddress.ip_address(value)
    if address.version != 4 or not any(address in ipaddress.ip_network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
        raise RuntimeError('invalid_history_private_address')
    return str(address)


def database_host():
    template = '{{with index .NetworkSettings.Networks "' + NETWORK + '"}}{{.IPAddress}}{{end}}'
    result = subprocess.run(['docker', 'inspect', '--format', template, CONTAINER],
                            capture_output=True, text=True, check=True, timeout=10)
    return private_ipv4(result.stdout.strip())


def cutover_timestamp():
    value = read_env(MONITOR_ENV).get('MONITOR_PROMETHEUS_CUTOVER_AT', '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z', value):
        raise RuntimeError('existing_prometheus_cutover_required')
    timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if timestamp > datetime.now(timezone.utc):
        raise RuntimeError('history_cutover_cannot_be_future')
    return timestamp.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def sql(value):
    identity = database_identity()
    result = subprocess.run(['docker', 'exec', '-i', '-u', 'postgres', CONTAINER,
                             'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', identity['user'],
                             '-d', identity['database'], '-At', '-f', '-'],
                            input=value, capture_output=True, text=True, check=True, timeout=20)
    return result.stdout.strip()


def query(value):
    result = sql(value)
    return json.loads(result) if result else None


def role_snapshot():
    return query(f"""select json_build_object(
      'attributes', to_jsonb(a) - 'oid', 'comment', shobj_description(a.oid, 'pg_authid'),
      'settings', coalesce((select json_agg(json_build_object('database', d.datname, 'values', s.setconfig))
        from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase where s.setrole=a.oid), '[]'::json),
      'memberships', coalesce((select json_agg(m.roleid) from pg_auth_members m where m.member=a.oid or m.roleid=a.oid), '[]'::json),
      'owned_objects', (select count(*) from pg_class where relowner=a.oid) + (select count(*) from pg_proc where proowner=a.oid))
      from pg_authid a where a.rolname={literal(ROLE)};""")


def view_snapshot():
    result = query(f"""select json_build_object('kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
      'definition', case when c.relkind='v' then pg_get_viewdef(c.oid, true) else null end,
      'options', c.reloptions, 'comment', obj_description(c.oid, 'pg_class'),
      'acl', coalesce((select json_agg(json_build_object('grantee', case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
        'privilege', x.privilege_type, 'grantable', x.is_grantable))
        from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x), '[]'::json))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname={literal(VIEW)};""")
    if result and result['kind'] != 'v':
        raise RuntimeError('history_view_name_is_not_a_view')
    return result


def grant_snapshot():
    return query(f"""select json_build_object(
      'database', coalesce((select json_agg(json_build_object('privilege', x.privilege_type, 'grantable', x.is_grantable))
        from pg_database d cross join lateral aclexplode(coalesce(d.datacl, acldefault('d',d.datdba))) x
        where d.datname=current_database() and x.grantee=(select oid from pg_roles where rolname={literal(ROLE)})), '[]'::json),
      'schema', coalesce((select json_agg(json_build_object('privilege', x.privilege_type, 'grantable', x.is_grantable))
        from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n',n.nspowner))) x
        where n.nspname='public' and x.grantee=(select oid from pg_roles where rolname={literal(ROLE)})), '[]'::json));""")


def scram_verifier(password, salt=None):
    salt = secrets.token_bytes(16) if salt is None else salt
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    stored = hashlib.sha256(hmac.new(salted, b'Client Key', hashlib.sha256).digest()).digest()
    server = hmac.new(salted, b'Server Key', hashlib.sha256).digest()
    encode = lambda value: base64.b64encode(value).decode()
    return f'SCRAM-SHA-256$4096:{encode(salt)}${encode(stored)}:{encode(server)}'


def password_matches(password, verifier):
    try:
        algorithm, settings, keys = verifier.split('$')
        iterations, salt = settings.split(':')
        if algorithm != 'SCRAM-SHA-256' or iterations != '4096':
            return False
        return hmac.compare_digest(scram_verifier(password, base64.b64decode(salt, validate=True)), verifier)
    except (AttributeError, ValueError, TypeError):
        return False


def validate_existing_role(state, password):
    attributes = state['attributes']
    if (any(attributes.get(name) for name in ('rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit', 'rolreplication', 'rolbypassrls'))
            or attributes.get('rolcanlogin') is not True or attributes.get('rolconnlimit') != 2
            or state['memberships'] or state['owned_objects'] or not password_matches(password, attributes.get('rolpassword'))):
        raise RuntimeError('unexpected_existing_history_role')
    defaults = next((item['values'] for item in state['settings'] if item['database'] is None), [])
    if 'default_transaction_read_only=on' not in defaults or 'statement_timeout=8s' not in defaults:
        raise RuntimeError('unexpected_existing_history_defaults')
    if any(item['database'] is not None for item in state['settings']):
        raise RuntimeError('unexpected_database_specific_history_defaults')


def history_settings(existing=None):
    identity = database_identity()
    existing = read_env(HISTORY_ENV) if existing is None else existing
    password = existing.get('MONITOR_HISTORY_PASSWORD') or secrets.token_urlsafe(48)
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', password):
        raise RuntimeError('invalid_history_password_format')
    if existing and (set(existing) != ENV_KEYS or existing.get('MONITOR_HISTORY_USER') != ROLE
                     or existing.get('MONITOR_HISTORY_PORT') != '5432'
                     or existing.get('MONITOR_HISTORY_DATABASE') != identity['database']):
        raise RuntimeError('unexpected_existing_history_environment')
    return {'MONITOR_HISTORY_HOST': database_host(), 'MONITOR_HISTORY_PORT': '5432',
            'MONITOR_HISTORY_DATABASE': identity['database'], 'MONITOR_HISTORY_USER': ROLE,
            'MONITOR_HISTORY_PASSWORD': password}


def view_definition(cutoff):
    columns = []
    for name, path in FIELDS.items():
        location = '{host,' + ','.join(path) + '}'
        columns.append(f"case when jsonb_typeof(sample #> {literal(location)})='number' then (sample #>> {literal(location)})::double precision else null end as {identifier(name)}")
    return ("select collected_at,\n  " + ',\n  '.join(columns) + "\nfrom public.monitor_samples\n"
            f"where host_id='cloud-primary' and collected_at < {literal(cutoff)}::timestamptz\n"
            "  and collected_at >= now() - interval '7 days'")


def transaction(value):
    # Session-local logging limits and a verifier keep plaintext credentials out
    # of both client arguments and SQL statement logging. No global setting is changed.
    return ("begin;\nset local log_statement='none';\nset local log_min_error_statement='panic';\n"
            "set local log_min_duration_statement=-1;\n" + value + "\ncommit;")


def prepare_sql(metadata, settings):
    statements = []
    if metadata['role'] is None:
        statements += [f"create role {ROLE} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password {literal(scram_verifier(settings['MONITOR_HISTORY_PASSWORD']))};",
                       f"alter role {ROLE} set default_transaction_read_only=on;",
                       f"alter role {ROLE} set statement_timeout='8s';",
                       f"comment on role {ROLE} is {literal(metadata['tag'])};"]
    qualified = 'public.' + VIEW
    statements += [f"create or replace view {qualified} with (security_barrier=true, security_invoker=false) as {view_definition(metadata['cutoff'])};",
                   f"alter view {qualified} owner to {identifier(database_identity()['user'])};",
                   f"comment on view {qualified} is {literal(metadata['tag'])};",
                   f"revoke all on {qualified} from public, {ROLE};",
                   f"grant connect on database {identifier(settings['MONITOR_HISTORY_DATABASE'])} to {ROLE};",
                   f"grant usage on schema public to {ROLE};",
                   f"grant select on {qualified} to {ROLE};"]
    return transaction('\n'.join(statements))


def ensure_group():
    import grp
    try:
        return grp.getgrnam(GROUP).gr_gid
    except KeyError:
        subprocess.run(['groupadd', '--system', GROUP], capture_output=True, check=True, timeout=10)
        return grp.getgrnam(GROUP).gr_gid


def snapshot():
    if BACKUP.exists():
        raise RuntimeError('unfinished_history_transaction')
    BACKUP.mkdir(mode=0o700)
    try:
        existed = HISTORY_ENV.exists()
        metadata = {'tag': 'personal-homepage-grafana-history:' + uuid.uuid4().hex,
                    'role': role_snapshot(), 'view': view_snapshot(), 'grants': grant_snapshot(),
                    'cutoff': cutover_timestamp(), 'environment': {'exists': existed}}
        if existed:
            info = HISTORY_ENV.stat()
            metadata['environment'].update({'mode': info.st_mode & 0o777, 'uid': info.st_uid, 'gid': info.st_gid})
            write(BACKUP / 'history.env', HISTORY_ENV.read_bytes())
        write(BACKUP / 'metadata.json', json.dumps(metadata))
        return metadata
    except Exception:
        shutil.rmtree(BACKUP)
        raise


def prepare():
    metadata = snapshot()
    try:
        existing = read_env(HISTORY_ENV)
        if metadata['role'] and not existing.get('MONITOR_HISTORY_PASSWORD'):
            raise RuntimeError('existing_history_role_requires_saved_password')
        settings = history_settings(existing)
        if metadata['role']:
            validate_existing_role(metadata['role'], settings['MONITOR_HISTORY_PASSWORD'])
        gid = ensure_group()
        sql(prepare_sql(metadata, settings))
        HISTORY_ENV.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        HISTORY_ENV.parent.chmod(0o750)
        os.chown(HISTORY_ENV.parent, 0, gid)
        write(HISTORY_ENV, ''.join(f'{key}={value}\n' for key, value in settings.items()), 0o640)
        os.chown(HISTORY_ENV, 0, gid)
        verify()
    except Exception:
        rollback()
        raise


def verify():
    settings = read_env(HISTORY_ENV)
    expected = history_settings(settings)
    if settings != expected:
        raise RuntimeError('history_database_address_changed')
    validate_existing_role(role_snapshot(), settings['MONITOR_HISTORY_PASSWORD'])
    view = view_snapshot()
    if not view or not {'security_barrier=true', 'security_invoker=false'} <= set(view['options'] or []) or view['owner'] == ROLE:
        raise RuntimeError('history_view_security_invalid')
    # Probe using the real fixed role inside an explicitly read-only admin
    # transaction. This consumes no third login slot while Grafana's pool of two
    # connections is active. The role's LOGIN defaults are verified above.
    result = query(f"""begin read only;
      set local role {ROLE};
      select json_build_object('role', current_user, 'readonly', current_setting('transaction_read_only'),
        'columns', (select json_agg(column_name order by ordinal_position) from information_schema.columns
          where table_schema='public' and table_name={literal(VIEW)}),
        'view_select', has_table_privilege(current_user, 'public.{VIEW}', 'SELECT'),
        'view_write', has_table_privilege(current_user, 'public.{VIEW}', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
        'schema_create', has_schema_privilege(current_user, 'public', 'CREATE'),
        'database_create', has_database_privilege(current_user, current_database(), 'CREATE'),
        'other_data_access', exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
          and n.nspname not like 'pg_temp_%' and c.relkind in ('r','p','v','m','f')
          and c.oid <> 'public.{VIEW}'::regclass and (has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
            or has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))),
        'definer_access', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where p.prosecdef and n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(current_user,p.oid,'EXECUTE')));
      rollback;""")
    if (result['role'] != ROLE or result['readonly'] != 'on' or not result['view_select']
            or any(result[field] for field in ('view_write', 'schema_create', 'database_create', 'other_data_access', 'definer_access'))
            or result['columns'] != ['collected_at', *FIELDS]):
        raise RuntimeError('history_role_exposes_unexpected_privileges')
    # The view's filter definition and permission are checked without logging
    # retained resource values. SELECT only; application rows remain unchanged.
    sql(f'begin read only; set local role {ROLE}; select collected_at from public.{VIEW} limit 0; rollback;')


def grant_statements(target, entries, grantee=ROLE):
    allowed = {'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN', 'CONNECT', 'CREATE', 'TEMPORARY', 'USAGE'}
    statements = []
    for entry in entries:
        if entry['privilege'] not in allowed:
            raise RuntimeError('unexpected_saved_history_privilege')
        who = 'public' if entry.get('grantee', grantee) == 'PUBLIC' else identifier(entry.get('grantee', grantee))
        statements.append(f"grant {entry['privilege']} on {target} to {who}" + (' with grant option' if entry.get('grantable') else '') + ';')
    return statements


def rollback():
    if not (BACKUP / 'metadata.json').exists():
        return
    metadata = json.loads((BACKUP / 'metadata.json').read_text())
    current_view, current_role = view_snapshot(), role_snapshot()
    applied = bool(current_view and current_view['comment'] == metadata['tag']) or bool(current_role and metadata['role'] is None and current_role['comment'] == metadata['tag'])
    if applied:
        if current_view and current_view['comment'] != metadata['tag']:
            raise RuntimeError('history_view_changed_during_transaction')
        statements, qualified = [], 'public.' + VIEW
        if current_view:
            if metadata['view'] is None:
                statements.append(f'drop view {qualified};')
            else:
                previous = metadata['view']
                for grantee in {entry['grantee'] for entry in current_view['acl']} | {ROLE, 'PUBLIC'}:
                    who = 'public' if grantee == 'PUBLIC' else identifier(grantee)
                    statements.append(f'revoke all on {qualified} from {who};')
                options = previous['options'] or []
                if any(not re.fullmatch(r'(?:security_barrier|security_invoker)=(?:true|false)', item) for item in options):
                    raise RuntimeError('unsupported_saved_history_view_options')
                statements.append(f'create or replace view {qualified} as {previous["definition"].rstrip(";")};')
                statements.append(f'alter view {qualified} reset (security_barrier, security_invoker);')
                if options:
                    statements.append(f'alter view {qualified} set ({", ".join(options)});')
                statements.append(f'alter view {qualified} owner to {identifier(previous["owner"])};')
                statements += grant_statements(qualified, previous['acl'])
                statements.append(f'comment on view {qualified} is {literal(previous["comment"]) if previous["comment"] is not None else "null"};')
        if current_role:
            if metadata['role'] is None and current_role['comment'] != metadata['tag']:
                raise RuntimeError('history_role_is_not_owned_by_transaction')
            database = identifier(database_identity()['database'])
            statements += [f'revoke all on database {database} from {ROLE};', f'revoke all on schema public from {ROLE};']
            statements += grant_statements('database ' + database, metadata['grants']['database'])
            statements += grant_statements('schema public', metadata['grants']['schema'])
            if metadata['role'] is None:
                statements.append(f'drop role {ROLE};')
        sql(transaction('\n'.join(statements)))
    previous = metadata['environment']
    if previous['exists']:
        write(HISTORY_ENV, (BACKUP / 'history.env').read_bytes(), previous['mode'])
        os.chown(HISTORY_ENV, previous['uid'], previous['gid'])
    else:
        HISTORY_ENV.unlink(missing_ok=True)
    shutil.rmtree(BACKUP)


def commit():
    if BACKUP.exists():
        shutil.rmtree(BACKUP)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('root_required')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    actions = {'prepare': prepare, 'verify': verify, 'rollback': rollback, 'commit': commit}
    if action not in actions:
        raise RuntimeError('expected_prepare_verify_rollback_or_commit')
    actions[action]()


if __name__ == '__main__':
    try:
        main()
        print('Grafana history installation step completed')
    except Exception as error:
        print(f'Grafana history installation failed ({type(error).__name__})', file=sys.stderr)
        sys.exit(1)
