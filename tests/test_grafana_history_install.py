"""Private history helper contracts; real PostgreSQL fixture is run separately."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('grafana_history', Path(__file__).resolve().parents[1] / 'deploy/install-grafana-history.py')
history = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(history)
PASSWORD = 'fixture_' + 'a' * 48
CUTOFF = '2026-10-01T12:00:00.123Z'


def role(comment='original role'):
    return {'attributes': {'rolname': history.ROLE, 'rolsuper': False, 'rolcreatedb': False, 'rolcreaterole': False,
            'rolinherit': False, 'rolreplication': False, 'rolbypassrls': False, 'rolcanlogin': True,
            'rolconnlimit': 2, 'rolpassword': history.scram_verifier(PASSWORD, b'1234567890123456')},
            'comment': comment, 'memberships': [], 'owned_objects': 0,
            'settings': [{'database': None, 'values': ['statement_timeout=8s', 'default_transaction_read_only=on']}]}


def view(comment='original view'):
    return {'kind': 'v', 'owner': 'app', 'definition': "select collected_at from public.monitor_samples where host_id='old';",
            'options': ['security_barrier=true', 'security_invoker=false'], 'comment': comment,
            'acl': [{'grantee': history.ROLE, 'privilege': 'SELECT', 'grantable': False}]}


@contextmanager
def paths():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        values = {'APP_ENV': root / 'app.env', 'MONITOR_ENV': root / 'monitor.env',
                  'HISTORY_ENV': root / 'grafana/history.env', 'BACKUP': root / 'transaction'}
        values['APP_ENV'].write_text('DATABASE_URL=postgresql://app:private-not-printed@database/site\n')
        values['MONITOR_ENV'].write_text('MONITOR_PROMETHEUS_CUTOVER_AT=' + CUTOFF + '\n')
        with mock.patch.multiple(history, **values), mock.patch.object(history, 'database_host', return_value='172.18.0.3'), \
             mock.patch.object(history, 'ensure_group', return_value=1234), \
             mock.patch.object(history.os, 'fchmod', create=True), mock.patch.object(history.os, 'chown', create=True) as chown:
            yield root, chown


def save_environment():
    settings = history.history_settings({'MONITOR_HISTORY_HOST': '172.18.0.3', 'MONITOR_HISTORY_PORT': '5432',
        'MONITOR_HISTORY_DATABASE': 'site', 'MONITOR_HISTORY_USER': history.ROLE, 'MONITOR_HISTORY_PASSWORD': PASSWORD})
    history.write(history.HISTORY_ENV, ''.join(key + '=' + value + '\n' for key, value in settings.items()), 0o640)
    return history.HISTORY_ENV.read_bytes()


class SettingsTests(unittest.TestCase):
    def test_current_docker_network_ip_is_private_ipv4_not_a_proxy_or_public_address(self):
        for value in ('10.2.3.4', '172.18.0.3', '192.168.1.2'):
            self.assertEqual(history.private_ipv4(value), value)
        for value in ('127.0.0.1', '0.0.0.0', '169.254.169.254', '8.8.8.8', '224.0.0.1', '::1', 'database', '172.18.0.3:5432'):
            with self.assertRaises((RuntimeError, ValueError)):
                history.private_ipv4(value)

    def test_cutover_is_existing_strict_utc_and_cannot_be_silently_reset_or_future(self):
        with paths():
            self.assertEqual(history.cutover_timestamp(), CUTOFF)
            for value in ('', "2026-10-01T12:00:00Z';drop table x;--", '2026-02-30T00:00:00Z',
                          (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')):
                history.MONITOR_ENV.write_text('MONITOR_PROMETHEUS_CUTOVER_AT=' + value + '\n')
                with self.assertRaises((RuntimeError, ValueError)):
                    history.cutover_timestamp()

    def test_existing_password_is_reused_while_database_ip_is_refreshed(self):
        with paths():
            save_environment()
            history.database_host.return_value = '172.18.0.4'
            settings = history.history_settings()
            self.assertEqual(settings['MONITOR_HISTORY_PASSWORD'], PASSWORD)
            self.assertEqual(settings['MONITOR_HISTORY_HOST'], '172.18.0.4')
            self.assertEqual(set(settings), history.ENV_KEYS)
            self.assertEqual(settings['MONITOR_HISTORY_PORT'], '5432')
            bad = {**settings, 'MONITOR_HISTORY_USER': 'postgres'}
            with self.assertRaises(RuntimeError):
                history.history_settings(bad)

    def test_scram_verifier_roundtrip_does_not_put_plaintext_password_in_sql(self):
        verifier = history.scram_verifier(PASSWORD, b'1234567890123456')
        self.assertTrue(history.password_matches(PASSWORD, verifier))
        self.assertFalse(history.password_matches('different', verifier))
        self.assertFalse(history.password_matches(PASSWORD, 'malformed'))
        metadata = {'role': None, 'tag': 'fixture-tag', 'cutoff': CUTOFF}
        with paths():
            text = history.prepare_sql(metadata, history.history_settings())
        self.assertIn('SCRAM-SHA-256$', text)
        self.assertNotIn(PASSWORD, text)
        for clause in ('nosuperuser', 'nocreatedb', 'nocreaterole', 'noinherit', 'nobypassrls', 'connection limit 2', "statement_timeout='8s'", 'default_transaction_read_only=on'):
            self.assertIn(clause, text)

    def test_existing_role_is_validated_and_never_has_its_password_rotated(self):
        history.validate_existing_role(role(), PASSWORD)
        with paths():
            text = history.prepare_sql({'role': role(), 'tag': 'fixture-tag', 'cutoff': CUTOFF}, history.history_settings())
        self.assertNotIn('create role', text)
        self.assertNotIn('alter role', text)
        self.assertNotIn('password ', text)
        for field in ('rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit', 'rolreplication', 'rolbypassrls'):
            state = role()
            state['attributes'][field] = True
            with self.assertRaises(RuntimeError):
                history.validate_existing_role(state, PASSWORD)
        state = role()
        state['memberships'] = [12]
        with self.assertRaises(RuntimeError):
            history.validate_existing_role(state, PASSWORD)

    def test_sql_uses_fixed_postgres_os_identity_and_stdin_never_a_password_argument(self):
        with paths(), mock.patch.object(history.subprocess, 'run', return_value=mock.Mock(stdout='42\n')) as run:
            self.assertEqual(history.sql('select 42;'), '42')
        args = run.call_args.args[0]
        self.assertEqual(args[:6], ['docker', 'exec', '-i', '-u', 'postgres', history.CONTAINER])
        self.assertEqual(run.call_args.kwargs['input'], 'select 42;')
        self.assertIn('-q', args)  # JSON reads inside BEGIN/SET/ROLLBACK must not contain command tags.
        self.assertNotIn('private-not-printed', ' '.join(args))


class ViewTests(unittest.TestCase):
    def test_view_exposes_only_time_and_eight_numeric_fields_with_strict_scope(self):
        definition = history.view_definition(CUTOFF)
        self.assertIn("host_id='cloud-primary'", definition)
        self.assertIn("collected_at < '" + CUTOFF + "'::timestamptz", definition)
        self.assertIn("collected_at >= now() - interval '7 days'", definition)
        self.assertEqual(definition.count('::double precision'), 8)
        self.assertEqual(definition.count("jsonb_typeof"), 8)
        for column in history.FIELDS:
            self.assertIn(' as "' + column + '"', definition)
        for forbidden in ('monitor_sessions', 'monitor_oauth', 'select *', 'received_at', 'password', 'containers', 'services'):
            self.assertNotIn(forbidden, definition)

    def test_schema_is_quoted_instead_of_allowing_database_or_owner_sql_injection(self):
        self.assertEqual(history.identifier('x";bad'), '"x"";bad"')
        self.assertEqual(history.literal("x';bad"), "'x'';bad'")
        with paths():
            history.APP_ENV.write_text("DATABASE_URL=postgresql://bad%27user:secret@db/site\n")
            with self.assertRaises(RuntimeError):
                history.database_identity()


class TransactionTests(unittest.TestCase):
    def metadata(self, *, previous_role=None, previous_view=None):
        return {'tag': 'personal-homepage-grafana-history:fixture', 'role': previous_role, 'view': previous_view,
                'grants': {'database': [], 'schema': []}, 'cutoff': CUTOFF, 'environment': {'exists': False}}

    def test_new_role_and_view_rollback_drop_only_owned_objects_and_keep_application_rows_untouched(self):
        with paths(), mock.patch.object(history, 'sql') as sql:
            metadata = self.metadata()
            history.write(history.BACKUP / 'metadata.json', json.dumps(metadata))
            history.write(history.HISTORY_ENV, 'new private credential\n')
            with mock.patch.object(history, 'view_snapshot', return_value=view(metadata['tag'])), \
                 mock.patch.object(history, 'role_snapshot', return_value=role(metadata['tag'])):
                history.rollback()
            text = sql.call_args.args[0]
            self.assertIn('drop view public.' + history.VIEW, text)
            self.assertIn('drop role ' + history.ROLE, text)
            for forbidden in ('drop owned', 'cascade', 'delete from', 'insert into', 'update public.', 'monitor_sessions'):
                self.assertNotIn(forbidden, text.lower())
            self.assertFalse(history.HISTORY_ENV.exists())
            self.assertFalse(history.BACKUP.exists())

    def test_existing_role_view_and_environment_are_restored_without_changing_role_password(self):
        with paths() as (_, chown), mock.patch.object(history, 'sql') as sql:
            original = save_environment()
            metadata = self.metadata(previous_role=role(), previous_view=view())
            metadata['environment'] = {'exists': True, 'mode': 0o640, 'uid': 0, 'gid': 1234}
            history.write(history.BACKUP / 'history.env', original)
            history.write(history.BACKUP / 'metadata.json', json.dumps(metadata))
            history.write(history.HISTORY_ENV, 'changed\n')
            with mock.patch.object(history, 'view_snapshot', return_value=view(metadata['tag'])), \
                 mock.patch.object(history, 'role_snapshot', return_value=role()):
                history.rollback()
            text = sql.call_args.args[0]
            self.assertIn(metadata['view']['definition'].rstrip(';'), text)
            self.assertIn('original view', text)
            self.assertNotIn('drop role', text)
            self.assertNotIn('alter role', text)
            self.assertEqual(history.HISTORY_ENV.read_bytes(), original)
            chown.assert_called_with(history.HISTORY_ENV, 0, 1234)

    def test_failed_create_transaction_does_not_drop_a_same_named_foreign_role(self):
        with paths(), mock.patch.object(history, 'sql') as sql:
            metadata = self.metadata()
            history.write(history.BACKUP / 'metadata.json', json.dumps(metadata))
            with mock.patch.object(history, 'view_snapshot', return_value=None), \
                 mock.patch.object(history, 'role_snapshot', return_value=role('foreign role')):
                history.rollback()
            sql.assert_not_called()

    def test_concurrent_view_replacement_is_not_overwritten_or_dropped(self):
        with paths(), mock.patch.object(history, 'sql') as sql:
            metadata = self.metadata()
            history.write(history.BACKUP / 'metadata.json', json.dumps(metadata))
            with mock.patch.object(history, 'view_snapshot', return_value=view('foreign replacement')), \
                 mock.patch.object(history, 'role_snapshot', return_value=role(metadata['tag'])):
                with self.assertRaisesRegex(RuntimeError, 'changed_during'):
                    history.rollback()
            sql.assert_not_called()
            self.assertTrue(history.BACKUP.exists())

    def test_commit_removes_only_private_transaction_backup_and_keeps_current_credentials(self):
        with paths():
            original = save_environment()
            history.write(history.BACKUP / 'metadata.json', '{}')
            history.commit()
            self.assertFalse(history.BACKUP.exists())
            self.assertEqual(history.HISTORY_ENV.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
