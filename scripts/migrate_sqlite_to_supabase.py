#!/usr/bin/env python3
"""Migrate the local v5 SQLite database into Supabase Postgres via REST.

Run schema creation first with supabase/schema.sql, then execute:

  python scripts/migrate_sqlite_to_supabase.py --dry-run
  $env:SUPABASE_URL='https://xxx.supabase.co'
  $env:SUPABASE_SERVICE_ROLE_KEY='...'
  python scripts/migrate_sqlite_to_supabase.py
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from exam_core import (
    ExamApp,
    INITIAL_BANK_CATEGORY,
    INITIAL_BANK_GROUP,
    INITIAL_BANK_PATH,
    INITIAL_BANK_TITLE,
    new_id,
    utc_now,
)


DEFAULT_DB = ROOT / 'data' / 'exam_app.sqlite3'


TABLE_PLAN = [
    {'table': 'users', 'conflict': 'id'},
    {'table': 'auth_tokens', 'conflict': 'token'},
    {'table': 'papers', 'conflict': 'id'},
    {'table': 'questions', 'conflict': 'id'},
    {'table': 'sessions', 'conflict': 'id'},
    {'table': 'answers', 'conflict': 'id'},
    {'table': 'wrongbook', 'conflict': 'id'},
    {'table': 'review_schedule', 'conflict': 'user_id,question_id'},
    {'table': 'favorites', 'conflict': 'user_id,question_id'},
    {'table': 'captcha_challenges', 'conflict': 'id'},
    {'table': 'email_verifications', 'conflict': 'id'},
    {'table': 'ai_accounts', 'conflict': 'user_id'},
    {'table': 'payment_orders', 'conflict': 'id'},
]

JSON_FIELDS = {
    'questions': {'options_json': [], 'tags_json': []},
    'payment_orders': {'metadata_json': {}},
}

BOOL_FIELDS = {
    'answers': ['correct'],
    'wrongbook': ['mastered'],
}


def main() -> int:
    parser = argparse.ArgumentParser(description='Migrate local SQLite v5 data to Supabase.')
    parser.add_argument('--db', default=str(DEFAULT_DB), help='SQLite database path.')
    parser.add_argument('--supabase-url', default=os.environ.get('SUPABASE_URL', ''), help='Supabase project URL.')
    parser.add_argument('--service-role-key', default=os.environ.get('SUPABASE_SERVICE_ROLE_KEY', ''), help='Supabase service role key.')
    parser.add_argument('--batch-size', type=int, default=500, help='Rows per REST upsert batch.')
    parser.add_argument('--dry-run', action='store_true', help='Only inspect SQLite data and print counts.')
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f'SQLite database not found: {db_path}')

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows_by_table = collect_rows(conn)

    print_summary(rows_by_table)

    if args.dry_run:
        print('Dry run complete. No data was sent to Supabase.')
        return 0

    if not args.supabase_url or not args.service_role_key:
        raise SystemExit('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running a real migration.')

    client = SupabaseRestClient(args.supabase_url, args.service_role_key)
    for spec in TABLE_PLAN:
        table = spec['table']
        rows = rows_by_table.get(table, [])
        if not rows:
            continue
        print(f'Upserting {len(rows)} rows into {table}...')
        client.upsert(table, rows, spec['conflict'], args.batch_size)

    print('Migration complete.')
    return 0


def collect_rows(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    rows_by_table: dict[str, list[dict[str, Any]]] = {}
    for spec in TABLE_PLAN:
        table = spec['table']
        if not table_exists(conn, table):
            rows_by_table[table] = []
            continue
        rows = read_table(conn, table)
        rows_by_table[table] = transform_rows(table, rows)
    seed_missing_initial_question_banks(rows_by_table)
    return rows_by_table


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "select 1 from sqlite_master where type = 'table' and name = ?",
        (table,)
    ).fetchone()
    return bool(row)


def read_table(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    if table == 'questions':
        query = 'select rowid as __rowid, * from questions order by paper_id asc, rowid asc'
    else:
        query = f'select * from {table}'
    return [dict(row) for row in conn.execute(query).fetchall()]


def transform_rows(table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    transformed: list[dict[str, Any]] = []
    position_by_paper: dict[str, int] = {}
    for row in rows:
        item = {key: value for key, value in row.items() if not key.startswith('__')}

        for field, default in JSON_FIELDS.get(table, {}).items():
            item[field] = json_or_default(item.get(field), default)

        for field in BOOL_FIELDS.get(table, []):
            item[field] = sqlite_bool(item.get(field))

        if table == 'questions':
            paper_id = str(item.get('paper_id') or '')
            item['position'] = position_by_paper.get(paper_id, 0)
            position_by_paper[paper_id] = item['position'] + 1

        transformed.append(item)
    return transformed


def json_or_default(value: Any, default: Any) -> Any:
    if value is None or value == '':
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


def sqlite_bool(value: Any) -> bool:
    return str(value).lower() not in {'', '0', 'false', 'none', 'null'}


def print_summary(rows_by_table: dict[str, list[dict[str, Any]]]) -> None:
    print('SQLite migration summary:')
    for spec in TABLE_PLAN:
        table = spec['table']
        count = len(rows_by_table.get(table, []))
        print(f'  {table}: {count}')


def seed_missing_initial_question_banks(rows_by_table: dict[str, list[dict[str, Any]]]) -> None:
    users = rows_by_table.get('users', [])
    papers = rows_by_table.setdefault('papers', [])
    questions_table = rows_by_table.setdefault('questions', [])
    if not users or not Path(INITIAL_BANK_PATH).exists():
        return

    parser = ExamApp(':memory:')
    with open(INITIAL_BANK_PATH, 'r', encoding='utf-8') as source:
        questions = parser.parse_questions(source.read())
    if not questions:
        return

    seeded_user_ids = {paper['user_id'] for paper in papers if paper.get('source') == 'initial_seed'}
    for user in users:
        user_id = user['id']
        if user_id in seeded_user_ids:
            continue
        paper_id = new_id('paper')
        papers.append({
            'id': paper_id,
            'user_id': user_id,
            'title': INITIAL_BANK_TITLE,
            'category': INITIAL_BANK_CATEGORY,
            'group_name': INITIAL_BANK_GROUP,
            'source': 'initial_seed',
            'question_count': len(questions),
            'created_at': utc_now()
        })
        for position, question in enumerate(questions):
            questions_table.append({
                'id': question['id'],
                'paper_id': paper_id,
                'type': question['type'],
                'question': question['question'],
                'options_json': question['options'],
                'answer': question['answer'],
                'analysis': question.get('analysis', ''),
                'tags_json': question.get('tags', []),
                'score': question.get('score', 1),
                'position': position
            })


class SupabaseRestClient:
    def __init__(self, url: str, service_role_key: str):
        self.base_url = url.rstrip('/')
        self.service_role_key = service_role_key

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str, batch_size: int) -> None:
        for index in range(0, len(rows), batch_size):
            batch = rows[index:index + batch_size]
            self._post_batch(table, batch, on_conflict)

    def _post_batch(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> None:
        conflict = urllib.parse.quote(on_conflict, safe=',')
        endpoint = f'{self.base_url}/rest/v1/{table}?on_conflict={conflict}'
        payload = json.dumps(rows, ensure_ascii=False).encode('utf-8')
        request = urllib.request.Request(
            endpoint,
            data=payload,
            method='POST',
            headers={
                'apikey': self.service_role_key,
                'Authorization': f'Bearer {self.service_role_key}',
                'Content-Type': 'application/json',
                'User-Agent': 'exam-supabase-migration/1.0',
                'Prefer': 'resolution=merge-duplicates,return=minimal'
            }
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                if response.status not in (200, 201, 204):
                    body = response.read().decode('utf-8', errors='ignore')
                    raise RuntimeError(f'Supabase returned {response.status}: {body}')
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', errors='ignore')
            raise RuntimeError(
                f'Failed to upsert {table}. '
                f'Confirm supabase/schema.sql has been run. HTTP {error.code}: {body}'
            ) from error


if __name__ == '__main__':
    sys.exit(main())
