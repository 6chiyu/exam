import json
import os
import random
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request


PYTHON_EXE = os.environ.get(
    'PYTHON_EXE',
    r'C:\Users\池鱼\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
)


class V5HttpIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        cls.port = free_port()
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.temp_dir.name, 'http.sqlite3')
        env = os.environ.copy()
        env['EXAM_PORT'] = str(cls.port)
        env['EXAM_DB_PATH'] = cls.db_path
        env['EXAM_DEV_CAPTCHA'] = '1'
        env.pop('DEEPSEEK_API_KEY', None)
        cls.process = subprocess.Popen(
            [PYTHON_EXE, os.path.join(cls.root, 'server.py')],
            cwd=cls.root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        cls.base = f'http://127.0.0.1:{cls.port}'
        wait_until_ready(cls.base)

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
        cls.temp_dir.cleanup()

    def test_full_v5_user_journey_and_api_surface(self):
        html = raw_get(f'{self.base}/v5/index.html')
        self.assertIn('题练云 v5', html)

        username = f'user{random.randint(100000, 999999)}'
        email = f'{username}@qq.com'
        missing_captcha = request_json(
            self.base,
            '/api/email/send-code',
            {'email': email},
            expect_status=400
        )
        self.assertIn('图形识别码', missing_captcha['error'])
        captcha = request_json(self.base, '/api/captcha')
        self.assertIn('captcha_svg', captcha)
        self.assertNotIn('dev_code', captcha)
        dev_captcha = request_json(self.base, '/api/captcha?dev=1')
        self.assertIn('dev_code', dev_captcha)
        verification = request_json(
            self.base,
            '/api/email/send-code',
            {
                'email': email,
                'captchaId': dev_captcha['id'],
                'captchaCode': dev_captcha['dev_code']
            },
            expect_status=200
        )
        self.assertEqual(verification['email'], email)
        registered = request_json(
            self.base,
            '/api/register',
            {
                'username': username,
                'password': 'StrongPass123',
                'nickname': '集成测试用户',
                'email': email,
                'emailCode': verification['dev_code']
            },
            expect_status=201
        )
        self.assertEqual(registered['user']['username'], username)
        self.assertEqual(registered['user']['email'], email)

        login = request_json(self.base, '/api/login', {'username': username, 'password': 'StrongPass123'})
        token = login['token']
        self.assertTrue(token)

        me = request_json(self.base, '/api/me', token=token)
        self.assertEqual(me['nickname'], '集成测试用户')
        ai_account = request_json(self.base, '/api/ai/account', token=token)
        self.assertEqual(ai_account['remaining'], 20)
        seeded = request_json(self.base, '/api/papers', token=token)
        self.assertEqual(len(seeded['papers']), 1)
        self.assertEqual(seeded['papers'][0]['title'], '计算机网络基础初始题库')
        self.assertEqual(seeded['papers'][0]['question_count'], 60)

        text = """1.题目 DNS 的作用是？
A.域名解析
B.图片压缩
C.加密通信
D.浏览器插件管理
答案:A
解析:DNS 将域名解析为 IP 地址。

2.题目 下列属于传输层协议的是？
A.TCP
B.HTML
C.CSS
D.PNG
答案:A
解析:TCP 工作在传输层。"""

        parsed = request_json(self.base, '/api/import/parse', {'text': text})
        self.assertEqual(len(parsed['questions']), 2)

        ai_parsed = request_json(self.base, '/api/import/ai', {'text': text})
        self.assertEqual(ai_parsed['mode'], 'fallback')
        self.assertEqual(len(ai_parsed['questions']), 2)

        paper = request_json(
            self.base,
            '/api/papers',
            {'title': '集成测试卷', 'category': '计算机', 'group_name': '网络专题', 'source': 'regex', 'questions': parsed['questions']},
            token=token,
            expect_status=201
        )
        self.assertEqual(paper['question_count'], 2)
        self.assertEqual(paper['group_name'], '网络专题')

        papers = request_json(self.base, '/api/papers', token=token)
        self.assertEqual(len(papers['papers']), 2)

        paper_detail = request_json(self.base, f"/api/papers/{paper['id']}", token=token)
        self.assertEqual(len(paper_detail['questions']), 2)

        patched_paper = request_json(
            self.base,
            f"/api/papers/{paper['id']}",
            {'title': 'Network edited paper', 'category': 'Network', 'group_name': 'Edited group'},
            token=token,
            method='PATCH'
        )
        self.assertTrue(patched_paper['updated'])
        first_question = paper_detail['questions'][0]
        patched_question = request_json(
            self.base,
            f"/api/questions/{first_question['id']}",
            {
                'question': 'WWW is based on which network?',
                'options': ['Internet', 'LAN', 'Bluetooth', 'Printer'],
                'answer': 'A',
                'analysis': 'WWW runs on Internet.'
            },
            token=token,
            method='PATCH'
        )
        self.assertTrue(patched_question['updated'])
        paper_detail = request_json(self.base, f"/api/papers/{paper['id']}", token=token)
        self.assertEqual(paper_detail['title'], 'Network edited paper')
        self.assertEqual(paper_detail['group_name'], 'Edited group')
        self.assertEqual(paper_detail['questions'][0]['question'], 'WWW is based on which network?')
        self.assertEqual(paper_detail['questions'][0]['options'][0], 'Internet')

        deleted_question = request_json(
            self.base,
            f"/api/questions/{paper_detail['questions'][1]['id']}",
            token=token,
            method='DELETE'
        )
        self.assertTrue(deleted_question['deleted'])
        paper_detail = request_json(self.base, f"/api/papers/{paper['id']}", token=token)
        self.assertEqual(paper_detail['question_count'], 1)

        session = request_json(
            self.base,
            '/api/sessions',
            {'paperId': paper['id'], 'mode': 'practice'},
            token=token,
            expect_status=201
        )
        first_question = paper_detail['questions'][0]
        updated_analysis = request_json(
            self.base,
            f"/api/questions/{first_question['id']}/analysis",
            {'analysis': 'www 不是协议，记成 Internet 上的应用功能。'},
            token=token,
            method='PATCH'
        )
        self.assertTrue(updated_analysis['updated'])
        self.assertEqual(updated_analysis['analysis'], 'www 不是协议，记成 Internet 上的应用功能。')

        refreshed_paper = request_json(self.base, f"/api/papers/{paper['id']}", token=token)
        self.assertEqual(refreshed_paper['questions'][0]['analysis'], 'www 不是协议，记成 Internet 上的应用功能。')

        favorite = request_json(
            self.base,
            f"/api/questions/{first_question['id']}/favorite",
            {'favorite': True},
            token=token,
            method='PATCH'
        )
        self.assertTrue(favorite['favorite'])
        favorites = request_json(self.base, '/api/favorites', token=token)
        self.assertEqual(len(favorites['favorites']), 1)
        self.assertEqual(favorites['favorites'][0]['question_id'], first_question['id'])

        answer = request_json(
            self.base,
            '/api/answer',
            {
                'sessionId': session['id'],
                'questionId': first_question['id'],
                'answer': 'B',
                'timeSpentMs': 1800
            },
            token=token
        )
        self.assertFalse(answer['correct'])
        self.assertIn('www 不是协议', answer['analysis'])

        wrongbook = request_json(self.base, '/api/wrongbook', token=token)
        self.assertEqual(len(wrongbook['wrongbook']), 1)
        wrong_id = wrongbook['wrongbook'][0]['id']
        patched = request_json(
            self.base,
            f'/api/wrongbook/{wrong_id}',
            {'reason': '概念不清', 'note': 'DNS 不等于浏览器缓存'},
            token=token,
            method='PATCH'
        )
        self.assertTrue(patched['updated'])

        reviews = request_json(self.base, '/api/review/due?includeFuture=1', token=token)
        self.assertEqual(len(reviews['reviews']), 1)

        stats = request_json(self.base, '/api/stats', token=token)
        self.assertEqual(stats['papers'], 2)
        self.assertEqual(stats['questions'], 61)
        self.assertEqual(stats['answers'], 1)
        self.assertEqual(stats['wrong'], 1)

        order_error = request_json(
            self.base,
            '/api/payments/ai-package',
            {'amount_yuan': 1.25, 'provider': 'alipay'},
            token=token,
            expect_status=503
        )
        self.assertIn('暂未开放', order_error['error'])
        ai_account = request_json(self.base, '/api/ai/account', token=token)
        self.assertEqual(ai_account['paid_credits'], 0)
        self.assertEqual(ai_account['remaining'], 20)

        finished = request_json(
            self.base,
            f"/api/sessions/{session['id']}/finish",
            {},
            token=token,
            method='POST'
        )
        self.assertEqual(finished['answered'], 1)
        self.assertEqual(finished['total'], 1)
        self.assertEqual(finished['correct'], 0)

        deepseek_error = request_json(
            self.base,
            '/api/deepseek',
            {'messages': [{'role': 'user', 'content': 'ping'}]},
            expect_status=503
        )
        self.assertIn('DEEPSEEK_API_KEY', deepseek_error['message'])

        deleted_paper = request_json(
            self.base,
            f"/api/papers/{paper['id']}",
            token=token,
            method='DELETE'
        )
        self.assertTrue(deleted_paper['deleted'])
        papers = request_json(self.base, '/api/papers', token=token)
        self.assertEqual(len(papers['papers']), 1)
        self.assertEqual(papers['papers'][0]['title'], '计算机网络基础初始题库')


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_until_ready(base):
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            raw_get(f'{base}/v5/index.html')
            return
        except Exception:
            time.sleep(0.15)
    raise RuntimeError('server did not become ready')


def raw_get(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        return response.read().decode('utf-8')


def request_json(base, path, payload=None, token=None, method=None, expect_status=200):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(
        f'{base}{path}',
        data=body,
        headers=headers,
        method=method or ('GET' if payload is None else 'POST')
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read().decode('utf-8'))
            if response.status != expect_status:
                raise AssertionError(f'Expected {expect_status}, got {response.status}: {data}')
            return data
    except urllib.error.HTTPError as error:
        data = json.loads(error.read().decode('utf-8'))
        if error.code != expect_status:
            raise AssertionError(f'Expected {expect_status}, got {error.code}: {data}')
        return data


if __name__ == '__main__':
    unittest.main()
