import json
import os
import sqlite3
import tempfile
import unittest

import exam_core


class V5BackendTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, 'exam.sqlite3')
        self.app = exam_core.ExamApp(self.db_path)
        self.app.init_db()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_init_db_migrates_legacy_users_before_email_index(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'legacy.sqlite3')
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    CREATE TABLE users (
                      id TEXT PRIMARY KEY,
                      username TEXT NOT NULL UNIQUE,
                      nickname TEXT NOT NULL,
                      password_hash TEXT NOT NULL,
                      salt TEXT NOT NULL,
                      created_at TEXT NOT NULL
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()

            app = exam_core.ExamApp(db_path)
            app.init_db()

            conn = sqlite3.connect(db_path)
            try:
                columns = [row[1] for row in conn.execute('PRAGMA table_info(users)').fetchall()]
                indexes = [row[1] for row in conn.execute('PRAGMA index_list(users)').fetchall()]
            finally:
                conn.close()

        self.assertIn('email', columns)
        self.assertIn('email_verified_at', columns)
        self.assertIn('idx_users_email', indexes)

    def test_register_login_and_profile_use_sqlite_database(self):
        registered = self.app.register('alice', 'StrongPass123', 'Alice')
        self.assertEqual(registered['username'], 'alice')

        papers = self.app.list_papers(self.app.login('alice', 'StrongPass123')['token'])
        self.assertEqual(len(papers), 1)
        self.assertEqual(papers[0]['title'], '计算机网络基础初始题库')
        self.assertEqual(papers[0]['question_count'], 60)

        logged_in = self.app.login('alice', 'StrongPass123')
        self.assertIn('token', logged_in)
        self.assertEqual(logged_in['user']['nickname'], 'Alice')

        profile = self.app.require_user(logged_in['token'])
        self.assertEqual(profile['username'], 'alice')

    def test_init_db_seeds_existing_users_once(self):
        user = self.app.register('seeded', 'StrongPass123', 'Seeded')
        token = self.app.login('seeded', 'StrongPass123')['token']
        self.assertEqual(len(self.app.list_papers(token)), 1)

        self.app.init_db()
        self.app.init_db()
        papers = self.app.list_papers(token)

        self.assertEqual(len(papers), 1)
        self.assertEqual(papers[0]['source'], 'initial_seed')
        self.assertEqual(papers[0]['question_count'], 60)

    def test_qq_email_verification_registration_and_free_ai_quota(self):
        challenge = self.app.create_captcha(include_dev_code=True)
        self.assertRegex(challenge['dev_code'], r'^\d{5}$')
        verification = self.app.create_email_verification(
            'student@qq.com',
            deliver=False,
            captcha_id=challenge['id'],
            captcha_code=challenge['dev_code'],
            require_captcha=True
        )
        self.assertEqual(verification['email'], 'student@qq.com')
        self.assertIn('dev_code', verification)

        fresh_challenge = self.app.create_captcha(include_dev_code=True)
        with self.assertRaises(exam_core.AppError) as cooldown_error:
            self.app.create_email_verification(
                'student@qq.com',
                deliver=False,
                captcha_id=fresh_challenge['id'],
                captcha_code=fresh_challenge['dev_code'],
                require_captcha=True
            )
        self.assertEqual(cooldown_error.exception.status, 429)

        with self.assertRaises(exam_core.AppError):
            self.app.create_email_verification(
                'student@qq.com',
                deliver=False,
                captcha_id=challenge['id'],
                captcha_code=challenge['dev_code'],
                require_captcha=True
            )

        with self.assertRaises(exam_core.AppError):
            self.app.register(
                'mailbad',
                'StrongPass123',
                'Mail Bad',
                email='student@163.com',
                email_code=verification['dev_code'],
                require_email=True
            )

        registered = self.app.register(
            'mailuser',
            'StrongPass123',
            'Mail User',
            email='student@qq.com',
            email_code=f"{verification['dev_code'][:3]} {verification['dev_code'][3:]}",
            require_email=True
        )
        self.assertEqual(registered['email'], 'student@qq.com')

        token = self.app.login('mailuser', 'StrongPass123')['token']
        account = self.app.get_ai_account(token)
        self.assertEqual(account['free_credits'], 5)
        self.assertEqual(account['paid_credits'], 0)
        self.assertEqual(account['remaining'], 5)

        for _ in range(5):
            self.app.consume_ai_credit(token)
        empty = self.app.get_ai_account(token)
        self.assertEqual(empty['remaining'], 0)
        with self.assertRaises(exam_core.AppError):
            self.app.ensure_ai_credit(token)

    def test_alipay_ai_payment_order_supports_custom_amount(self):
        challenge = self.app.create_captcha(include_dev_code=True)
        verification = self.app.create_email_verification(
            'buyer@qq.com',
            deliver=False,
            captcha_id=challenge['id'],
            captcha_code=challenge['dev_code'],
            require_captcha=True
        )
        self.app.register(
            'buyer',
            'StrongPass123',
            'Buyer',
            email='buyer@qq.com',
            email_code=verification['dev_code'],
            require_email=True
        )
        token = self.app.login('buyer', 'StrongPass123')['token']

        order = self.app.create_ai_payment_order(token, {'amount_yuan': 2.5, 'provider': 'alipay'})
        self.assertEqual(order['provider'], 'alipay')
        self.assertEqual(order['amount_yuan'], 2.5)
        self.assertEqual(order['credits'], 100)
        self.assertEqual(order['status'], 'pending')

        paid = self.app.complete_payment_order(token, order['id'])
        self.assertEqual(paid['status'], 'paid')
        account = self.app.get_ai_account(token)
        self.assertEqual(account['paid_credits'], 100)
        self.assertEqual(account['remaining'], 105)

    def test_custom_regex_import_creates_questions(self):
        text = """1.题目
A.选项A
B.选项B
C.选项C
D.选项D
答案:A
解析:可以没有

2.第二题
A.对
B.错
答案:B"""
        rules = {
            'questionStart': r'(?m)^\s*\d+[\.、]\s*',
            'option': r'(?m)^([A-D])[\.\、]\s*(.+)$',
            'answer': r'答案[:：]\s*([A-D]+)',
            'analysis': r'解析[:：]\s*(.*)'
        }

        questions = self.app.parse_questions(text, rules)
        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[0]['answer'], 'A')
        self.assertEqual(questions[0]['analysis'], '可以没有')

    def test_ai_import_falls_back_to_rule_parser_without_api_key(self):
        text = """1. DNS 的作用是？
A.域名解析
B.图片压缩
C.加密
D.缓存
答案:A"""
        parsed = self.app.ai_parse_questions(text, api_key=None)
        self.assertEqual(parsed['mode'], 'fallback')
        self.assertEqual(parsed['questions'][0]['answer'], 'A')

    def test_paper_answer_wrongbook_and_review_flow(self):
        user = self.app.register('bob', 'StrongPass123', 'Bob')
        token = self.app.login('bob', 'StrongPass123')['token']
        questions = self.app.parse_questions("""1. DNS 的作用是？
A.域名解析
B.图片压缩
C.加密
D.缓存
答案:A
解析:DNS 负责域名到 IP 的解析。""")

        paper = self.app.create_paper(user['id'], {
            'title': '网络基础',
            'category': '计算机',
            'group_name': '期末冲刺',
            'questions': questions
        })
        self.assertEqual(paper['group_name'], '期末冲刺')
        session = self.app.start_session(token, paper['id'], 'practice')
        result = self.app.submit_answer(token, session['id'], questions[0]['id'], 'B', 3200)

        self.assertFalse(result['correct'])
        self.assertIn('DNS 负责', result['analysis'])

        wrongbook = self.app.list_wrongbook(token)
        self.assertEqual(len(wrongbook), 1)
        self.assertEqual(wrongbook[0]['wrong_count'], 1)

        due = self.app.list_due_reviews(token, include_future=True)
        self.assertEqual(len(due), 1)

        finished = self.app.finish_session(token, session['id'])
        self.assertEqual(finished['answered'], 1)
        self.assertEqual(finished['total'], 1)
        self.assertTrue(finished['finished_at'])

    def test_update_question_analysis_for_owned_paper(self):
        user = self.app.register('carol', 'StrongPass123', 'Carol')
        token = self.app.login('carol', 'StrongPass123')['token']
        questions = [{
            'id': 'q_custom_analysis',
            'question': 'WWW 鏄粈涔堬紵',
            'options': ['搴旂敤鍔熻兘', '缂栫▼璇█'],
            'answer': 'A',
            'analysis': '鍘熷瑙ｆ瀽',
            'type': 'single',
            'tags': [],
            'score': 1
        }]
        paper = self.app.create_paper(user['id'], {
            'title': '瑙ｆ瀽缂栬緫',
            'category': '璁＄畻鏈?',
            'questions': questions
        })

        updated = self.app.update_question_analysis(token, questions[0]['id'], 'www 不是协议，要记成应用服务。')

        self.assertTrue(updated['updated'])
        self.assertEqual(updated['analysis'], 'www 不是协议，要记成应用服务。')
        paper_detail = self.app.get_paper(token, paper['id'])
        self.assertEqual(paper_detail['questions'][0]['analysis'], 'www 不是协议，要记成应用服务。')

    def test_question_favorite_flow(self):
        user = self.app.register('dora', 'StrongPass123', 'Dora')
        token = self.app.login('dora', 'StrongPass123')['token']
        questions = [{
            'id': 'q_favorite_flow',
            'question': 'Which layer does TCP belong to?',
            'options': ['Application layer', 'Transport layer'],
            'answer': 'B',
            'analysis': 'TCP works at the transport layer.',
            'type': 'single',
            'tags': [],
            'score': 1
        }]
        self.app.create_paper(user['id'], {
            'title': 'Favorite test',
            'category': 'Network',
            'questions': questions
        })

        favorited = self.app.set_question_favorite(token, questions[0]['id'], True)
        favorites = self.app.list_favorites(token)
        unfavorited = self.app.set_question_favorite(token, questions[0]['id'], False)

        self.assertTrue(favorited['favorite'])
        self.assertEqual(len(favorites), 1)
        self.assertEqual(favorites[0]['question_id'], questions[0]['id'])
        self.assertFalse(unfavorited['favorite'])
        self.assertEqual(self.app.list_favorites(token), [])

    def test_update_paper_metadata_and_question_content(self):
        user = self.app.register('editor', 'StrongPass123', 'Editor')
        token = self.app.login('editor', 'StrongPass123')['token']
        questions = [{
            'id': 'q_editable_content',
            'question': 'Old DNS question',
            'options': ['Old A', 'Old B'],
            'answer': 'B',
            'analysis': 'Old analysis',
            'type': 'single',
            'tags': [],
            'score': 1
        }]
        paper = self.app.create_paper(user['id'], {
            'title': 'Old paper',
            'category': 'Old category',
            'group_name': 'Old group',
            'questions': questions
        })

        updated_paper = self.app.update_paper(token, paper['id'], {
            'title': 'Network final review',
            'category': 'Network',
            'group_name': 'Final'
        })
        updated_question = self.app.update_question(token, questions[0]['id'], {
            'question': 'DNS maps domains to what?',
            'options': ['IP address', 'Image file', 'Browser theme'],
            'answer': 'A',
            'analysis': 'DNS resolves domain names to IP addresses.',
            'type': 'single'
        })
        detail = self.app.get_paper(token, paper['id'])

        self.assertTrue(updated_paper['updated'])
        self.assertEqual(detail['title'], 'Network final review')
        self.assertEqual(detail['category'], 'Network')
        self.assertEqual(detail['group_name'], 'Final')
        self.assertTrue(updated_question['updated'])
        self.assertEqual(detail['questions'][0]['question'], 'DNS maps domains to what?')
        self.assertEqual(detail['questions'][0]['options'], ['IP address', 'Image file', 'Browser theme'])
        self.assertEqual(detail['questions'][0]['answer'], 'A')
        self.assertEqual(detail['questions'][0]['analysis'], 'DNS resolves domain names to IP addresses.')

    def test_delete_question_and_paper_for_owned_bank(self):
        user = self.app.register('deleter', 'StrongPass123', 'Deleter')
        token = self.app.login('deleter', 'StrongPass123')['token']
        questions = [
            {
                'id': 'q_delete_one',
                'question': 'Delete question one?',
                'options': ['Yes', 'No'],
                'answer': 'A',
                'analysis': '',
                'type': 'single',
                'tags': [],
                'score': 1
            },
            {
                'id': 'q_delete_two',
                'question': 'Delete question two?',
                'options': ['Yes', 'No'],
                'answer': 'B',
                'analysis': '',
                'type': 'single',
                'tags': [],
                'score': 1
            }
        ]
        paper = self.app.create_paper(user['id'], {
            'title': 'Delete paper',
            'category': 'Maintenance',
            'questions': questions
        })

        deleted_question = self.app.delete_question(token, 'q_delete_one')
        detail = self.app.get_paper(token, paper['id'])

        self.assertTrue(deleted_question['deleted'])
        self.assertEqual(detail['question_count'], 1)
        self.assertEqual([item['id'] for item in detail['questions']], ['q_delete_two'])

        deleted_paper = self.app.delete_paper(token, paper['id'])
        papers = self.app.list_papers(token)

        self.assertTrue(deleted_paper['deleted'])
        self.assertEqual(len(papers), 1)
        self.assertEqual(papers[0]['title'], '计算机网络基础初始题库')

    def test_delete_wrongbook_record(self):
        user = self.app.register('erin', 'StrongPass123', 'Erin')
        token = self.app.login('erin', 'StrongPass123')['token']
        questions = [{
            'id': 'q_wrong_delete',
            'question': 'DNS maps names to what?',
            'options': ['IP address', 'Image file'],
            'answer': 'A',
            'analysis': 'DNS maps domain names to IP addresses.',
            'type': 'single',
            'tags': [],
            'score': 1
        }]
        paper = self.app.create_paper(user['id'], {
            'title': 'Wrong delete test',
            'category': 'Network',
            'questions': questions
        })
        session = self.app.start_session(token, paper['id'], 'practice')
        self.app.submit_answer(token, session['id'], questions[0]['id'], 'B', 1000)
        wrong_id = self.app.list_wrongbook(token)[0]['id']

        deleted = self.app.delete_wrongbook(token, wrong_id)

        self.assertTrue(deleted['deleted'])
        self.assertEqual(self.app.list_wrongbook(token), [])

    def test_stats_include_local_learning_insights(self):
        user = self.app.register('faye', 'StrongPass123', 'Faye')
        token = self.app.login('faye', 'StrongPass123')['token']
        questions = [
            {
                'id': 'q_insight_ok',
                'question': 'TCP belongs to which layer?',
                'options': ['Application', 'Transport'],
                'answer': 'B',
                'analysis': 'TCP is a transport layer protocol.',
                'type': 'single',
                'tags': ['network'],
                'score': 1
            },
            {
                'id': 'q_insight_wrong',
                'question': 'DNS maps domains to what?',
                'options': ['IP addresses', 'Images'],
                'answer': 'A',
                'analysis': 'DNS maps domain names to IP addresses.',
                'type': 'single',
                'tags': ['network'],
                'score': 1
            }
        ]
        paper = self.app.create_paper(user['id'], {
            'title': 'Insight paper',
            'category': 'Network',
            'group_name': '专题训练',
            'questions': questions
        })
        session = self.app.start_session(token, paper['id'], 'practice')
        self.app.submit_answer(token, session['id'], questions[0]['id'], 'B', 1200)
        self.app.submit_answer(token, session['id'], questions[1]['id'], 'B', 3600)
        self.app.set_question_favorite(token, questions[1]['id'], True)
        wrong_id = self.app.list_wrongbook(token)[0]['id']
        self.app.update_wrongbook(token, wrong_id, {'reason': '记忆混淆'})

        stats = self.app.stats(token)

        self.assertEqual(stats['questions'], 62)
        self.assertEqual(stats['favorites'], 1)
        self.assertEqual(stats['avg_time_ms'], 2400)
        self.assertEqual(stats['recent_accuracy'], 50)
        self.assertEqual(stats['weakest_groups'][0]['group_name'], '专题训练')
        self.assertEqual(stats['weakest_groups'][0]['accuracy'], 50)
        self.assertEqual(stats['wrong_reason_stats'][0]['reason'], '记忆混淆')
        self.assertEqual(stats['wrong_reason_stats'][0]['count'], 1)
        self.assertTrue(stats['recommendations'])


if __name__ == '__main__':
    unittest.main()
