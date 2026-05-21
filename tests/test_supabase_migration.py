import json
import os
import sqlite3
import tempfile
import unittest

from scripts.migrate_sqlite_to_supabase import (
    TABLE_PLAN,
    collect_rows,
    json_or_default,
    sqlite_bool,
)


class SupabaseMigrationScriptTest(unittest.TestCase):
    def test_table_plan_respects_foreign_key_order(self):
        names = [item['table'] for item in TABLE_PLAN]
        self.assertLess(names.index('users'), names.index('papers'))
        self.assertLess(names.index('papers'), names.index('questions'))
        self.assertLess(names.index('questions'), names.index('answers'))
        self.assertLess(names.index('questions'), names.index('wrongbook'))
        self.assertLess(names.index('questions'), names.index('favorites'))

    def test_collect_rows_transforms_sqlite_values_for_supabase(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'exam.sqlite3')
            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(
                    """
                    create table papers (
                      id text primary key,
                      user_id text,
                      title text,
                      category text,
                      group_name text,
                      source text,
                      question_count integer,
                      created_at text
                    );
                    create table questions (
                      id text primary key,
                      paper_id text,
                      type text,
                      question text,
                      options_json text,
                      answer text,
                      analysis text,
                      tags_json text,
                      score real
                    );
                    create table answers (
                      id text primary key,
                      session_id text,
                      user_id text,
                      question_id text,
                      user_answer text,
                      correct integer,
                      time_spent_ms integer,
                      created_at text
                    );
                    """
                )
                conn.execute(
                    "insert into papers values(?,?,?,?,?,?,?,?)",
                    ('paper_1', 'user_1', '卷一', '综合', '默认分组', 'manual', 2, '2026-01-01T00:00:00Z')
                )
                conn.execute(
                    "insert into questions values(?,?,?,?,?,?,?,?,?)",
                    ('q_1', 'paper_1', 'single', '题目一', '["A","B"]', 'A', '', '["tag"]', 1)
                )
                conn.execute(
                    "insert into questions values(?,?,?,?,?,?,?,?,?)",
                    ('q_2', 'paper_1', 'single', '题目二', 'not json', 'B', '', '', 1)
                )
                conn.execute(
                    "insert into answers values(?,?,?,?,?,?,?,?)",
                    ('a_1', 's_1', 'user_1', 'q_1', 'A', 1, 1200, '2026-01-01T00:01:00Z')
                )
                conn.commit()
            finally:
                conn.close()

            conn = sqlite3.connect(db_path)
            try:
                conn.row_factory = sqlite3.Row
                rows_by_table = collect_rows(conn)
            finally:
                conn.close()

        questions = rows_by_table['questions']
        self.assertEqual(questions[0]['options_json'], ['A', 'B'])
        self.assertEqual(questions[0]['tags_json'], ['tag'])
        self.assertEqual(questions[0]['position'], 0)
        self.assertEqual(questions[1]['options_json'], [])
        self.assertEqual(questions[1]['position'], 1)
        self.assertIs(rows_by_table['answers'][0]['correct'], True)

    def test_json_and_bool_helpers_are_defensive(self):
        self.assertEqual(json_or_default(json.dumps({'a': 1}), {}), {'a': 1})
        self.assertEqual(json_or_default('', []), [])
        self.assertEqual(json_or_default('bad', []), [])
        self.assertTrue(sqlite_bool(1))
        self.assertFalse(sqlite_bool(0))


if __name__ == '__main__':
    unittest.main()
