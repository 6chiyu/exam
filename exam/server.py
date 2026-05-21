#!/usr/bin/env python3
import http.server
import json
import os
import socketserver
from urllib.parse import parse_qs, urlparse

from exam_core import AppError, ExamApp, call_deepseek

PORT = int(os.environ.get('EXAM_PORT', '8002'))
APP = ExamApp()
APP.init_db()


class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == '/api/me':
                return self._json(200, APP.require_user(self._token()))
            if parsed.path == '/api/ai/account':
                return self._json(200, APP.get_ai_account(self._token()))
            if parsed.path == '/api/payments':
                return self._json(200, {'orders': APP.list_payment_orders(self._token())})
            if parsed.path == '/api/stats':
                return self._json(200, APP.stats(self._token()))
            if parsed.path == '/api/papers':
                return self._json(200, {'papers': APP.list_papers(self._token())})
            if parsed.path.startswith('/api/papers/'):
                paper_id = parsed.path.rsplit('/', 1)[-1]
                return self._json(200, APP.get_paper(self._token(), paper_id))
            if parsed.path == '/api/wrongbook':
                return self._json(200, {'wrongbook': APP.list_wrongbook(self._token())})
            if parsed.path == '/api/favorites':
                return self._json(200, {'favorites': APP.list_favorites(self._token())})
            if parsed.path == '/api/review/due':
                query = parse_qs(parsed.query)
                include_future = query.get('includeFuture', ['0'])[0] == '1'
                return self._json(200, {'reviews': APP.list_due_reviews(self._token(), include_future)})
        except AppError as error:
            return self._json(error.status, {'error': str(error)})
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            body = self._body()
            if parsed.path == '/api/email/send-code':
                return self._json(200, APP.create_email_verification(body.get('email'), deliver=True))
            if parsed.path == '/api/register':
                user = APP.register(
                    body.get('username'),
                    body.get('password'),
                    body.get('nickname', ''),
                    body.get('email', ''),
                    body.get('emailCode') or body.get('email_code', ''),
                    require_email=True
                )
                return self._json(201, {'user': user})
            if parsed.path == '/api/login':
                return self._json(200, APP.login(body.get('username'), body.get('password')))
            if parsed.path == '/api/import/parse':
                questions = APP.parse_questions(body.get('text', ''), body.get('rules') or None)
                return self._json(200, {'questions': questions})
            if parsed.path == '/api/import/ai':
                api_key = os.environ.get('DEEPSEEK_API_KEY')
                if api_key:
                    APP.ensure_ai_credit(self._token())
                result = APP.ai_parse_questions(body.get('text', ''), api_key)
                if api_key and result.get('mode') == 'ai':
                    result['ai_account'] = APP.consume_ai_credit(self._token())
                return self._json(200, result)
            if parsed.path == '/api/papers':
                user = APP.require_user(self._token())
                paper = APP.create_paper(user['id'], body)
                return self._json(201, paper)
            if parsed.path == '/api/sessions':
                session = APP.start_session(self._token(), body.get('paperId'), body.get('mode', 'practice'))
                return self._json(201, session)
            if parsed.path.startswith('/api/sessions/') and parsed.path.endswith('/finish'):
                session_id = parsed.path.split('/')[-2]
                return self._json(200, APP.finish_session(self._token(), session_id))
            if parsed.path == '/api/answer':
                result = APP.submit_answer(
                    self._token(),
                    body.get('sessionId'),
                    body.get('questionId'),
                    body.get('answer'),
                    body.get('timeSpentMs', 0)
                )
                return self._json(200, result)
            if parsed.path == '/api/deepseek':
                return self._deepseek(body)
            if parsed.path == '/api/payments/ai-package':
                return self._json(201, APP.create_ai_payment_order(self._token(), body))
            if parsed.path.startswith('/api/payments/') and parsed.path.endswith('/complete'):
                order_id = parsed.path.split('/')[-2]
                return self._json(200, APP.complete_payment_order(self._token(), order_id))
        except AppError as error:
            return self._json(error.status, {'error': str(error)})
        except ValueError:
            return self._json(400, {'error': 'Invalid JSON body'})
        return self._json(404, {'error': 'Not found'})

    def do_PATCH(self):
        parsed = urlparse(self.path)
        try:
            body = self._body()
            if parsed.path.startswith('/api/papers/'):
                paper_id = parsed.path.rsplit('/', 1)[-1]
                return self._json(200, APP.update_paper(self._token(), paper_id, body))
            if parsed.path.startswith('/api/questions/') and parsed.path.endswith('/analysis'):
                question_id = parsed.path.split('/')[-2]
                return self._json(200, APP.update_question_analysis(self._token(), question_id, body.get('analysis', '')))
            if parsed.path.startswith('/api/questions/') and parsed.path.endswith('/favorite'):
                question_id = parsed.path.split('/')[-2]
                return self._json(200, APP.set_question_favorite(self._token(), question_id, body.get('favorite', True)))
            if parsed.path.startswith('/api/questions/'):
                question_id = parsed.path.rsplit('/', 1)[-1]
                return self._json(200, APP.update_question(self._token(), question_id, body))
            if parsed.path.startswith('/api/wrongbook/'):
                wrong_id = parsed.path.rsplit('/', 1)[-1]
                return self._json(200, APP.update_wrongbook(self._token(), wrong_id, body))
        except AppError as error:
            return self._json(error.status, {'error': str(error)})
        return self._json(404, {'error': 'Not found'})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith('/api/papers/'):
                paper_id = parsed.path.rsplit('/', 1)[-1]
                return self._json(200, APP.delete_paper(self._token(), paper_id))
            if parsed.path.startswith('/api/questions/'):
                question_id = parsed.path.rsplit('/', 1)[-1]
                return self._json(200, APP.delete_question(self._token(), question_id))
            if parsed.path.startswith('/api/wrongbook/'):
                wrong_id = parsed.path.rsplit('/', 1)[-1]
                return self._json(200, APP.delete_wrongbook(self._token(), wrong_id))
        except AppError as error:
            return self._json(error.status, {'error': str(error)})
        return self._json(404, {'error': 'Not found'})

    def _deepseek(self, body):
        api_key = os.environ.get('DEEPSEEK_API_KEY')
        if not api_key:
            return self._json(
                503,
                {
                    'error': 'DeepSeek API is not configured',
                    'message': 'Set DEEPSEEK_API_KEY before starting server.py.'
                }
            )
        messages = body.get('messages')
        if not isinstance(messages, list) or not messages:
            return self._json(400, {'error': 'messages must be a non-empty list'})
        APP.ensure_ai_credit(self._token())
        content = call_deepseek(
            api_key,
            messages,
            body.get('model', 'deepseek-chat'),
            body.get('temperature', 0.35),
            min(int(body.get('max_tokens', 1200)), 2000)
        )
        account = APP.consume_ai_credit(self._token())
        return self._json(200, {'content': content, 'ai_account': account})

    def _token(self):
        header = self.headers.get('Authorization', '')
        if header.lower().startswith('bearer '):
            return header.split(' ', 1)[1].strip()
        return ''

    def _body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def _json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)


os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(('', PORT), MyHTTPRequestHandler) as httpd:
    print(f'Serving at http://localhost:{PORT}')
    httpd.serve_forever()
