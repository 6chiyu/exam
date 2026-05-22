import base64
import hashlib
import json
import os
import re
import secrets
import smtplib
import sqlite3
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from email.message import EmailMessage


DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'exam_app.sqlite3')
INITIAL_BANK_PATH = os.path.join(os.path.dirname(__file__), 'data', 'initial_question_bank.txt')
INITIAL_BANK_TITLE = '计算机网络基础初始题库'
INITIAL_BANK_CATEGORY = '计算机网络'
INITIAL_BANK_GROUP = '系统初始题库'
FREE_AI_CREDITS = 20
AI_CREDITS_PER_YUAN = 40
EMAIL_CODE_TTL_SECONDS = 10 * 60
EMAIL_CODE_COOLDOWN_SECONDS = 60
CAPTCHA_TTL_SECONDS = 5 * 60
CAPTCHA_CHARS = '0123456789'


class AppError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class ExamApp:
    def __init__(self, db_path=None):
        self.db_path = db_path or os.environ.get('EXAM_DB_PATH') or DEFAULT_DB_PATH
        db_dir = os.path.dirname(self.db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

    def connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        return conn

    @contextmanager
    def db(self):
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_db(self):
        with self.db() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                  version INTEGER PRIMARY KEY,
                  name TEXT NOT NULL,
                  applied_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS users (
                  id TEXT PRIMARY KEY,
                  username TEXT NOT NULL UNIQUE,
                  email TEXT,
                  email_verified_at TEXT,
                  nickname TEXT NOT NULL,
                  password_hash TEXT NOT NULL,
                  salt TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS auth_tokens (
                  token TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS papers (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  title TEXT NOT NULL,
                  category TEXT NOT NULL,
                  group_name TEXT NOT NULL DEFAULT '默认分组',
                  source TEXT NOT NULL DEFAULT 'manual',
                  question_count INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS questions (
                  id TEXT PRIMARY KEY,
                  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
                  type TEXT NOT NULL,
                  question TEXT NOT NULL,
                  options_json TEXT NOT NULL,
                  answer TEXT NOT NULL,
                  analysis TEXT NOT NULL DEFAULT '',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  score REAL NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS sessions (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
                  mode TEXT NOT NULL,
                  started_at TEXT NOT NULL,
                  finished_at TEXT
                );

                CREATE TABLE IF NOT EXISTS answers (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
                  user_answer TEXT NOT NULL,
                  correct INTEGER NOT NULL,
                  time_spent_ms INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS wrongbook (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
                  user_answer TEXT NOT NULL,
                  reason TEXT NOT NULL DEFAULT '待归因',
                  note TEXT NOT NULL DEFAULT '',
                  mastered INTEGER NOT NULL DEFAULT 0,
                  wrong_count INTEGER NOT NULL DEFAULT 1,
                  updated_at TEXT NOT NULL,
                  UNIQUE(user_id, question_id)
                );

                CREATE TABLE IF NOT EXISTS review_schedule (
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
                  level INTEGER NOT NULL DEFAULT 0,
                  next_review_at INTEGER NOT NULL,
                  correct_count INTEGER NOT NULL DEFAULT 0,
                  wrong_count INTEGER NOT NULL DEFAULT 0,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY(user_id, question_id)
                );

                CREATE TABLE IF NOT EXISTS favorites (
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(user_id, question_id)
                );

                CREATE TABLE IF NOT EXISTS captcha_challenges (
                  id TEXT PRIMARY KEY,
                  purpose TEXT NOT NULL DEFAULT 'email',
                  code_hash TEXT NOT NULL,
                  salt TEXT NOT NULL,
                  expires_at INTEGER NOT NULL,
                  attempts INTEGER NOT NULL DEFAULT 0,
                  used_at TEXT,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS email_verifications (
                  id TEXT PRIMARY KEY,
                  email TEXT NOT NULL,
                  purpose TEXT NOT NULL DEFAULT 'register',
                  code_hash TEXT NOT NULL,
                  salt TEXT NOT NULL,
                  expires_at INTEGER NOT NULL,
                  used_at TEXT,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS ai_accounts (
                  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  free_credits INTEGER NOT NULL DEFAULT 20,
                  paid_credits INTEGER NOT NULL DEFAULT 0,
                  total_used INTEGER NOT NULL DEFAULT 0,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS payment_orders (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  provider TEXT NOT NULL,
                  amount_cents INTEGER NOT NULL,
                  credits INTEGER NOT NULL,
                  status TEXT NOT NULL,
                  payment_url TEXT NOT NULL DEFAULT '',
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  paid_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_questions_paper ON questions(paper_id);
                CREATE INDEX IF NOT EXISTS idx_answers_user ON answers(user_id);
                CREATE INDEX IF NOT EXISTS idx_wrongbook_user ON wrongbook(user_id);
                CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedule(user_id, next_review_at);
                CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_captcha_challenges ON captcha_challenges(purpose, expires_at);
                CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email, purpose, expires_at);
                CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id, created_at);
                """
            )
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, name, applied_at) VALUES(1, 'initial_schema', ?)",
                (utc_now(),)
            )
            ensure_column(conn, 'papers', 'group_name', "TEXT NOT NULL DEFAULT '默认分组'")
            ensure_column(conn, 'users', 'email', 'TEXT')
            ensure_column(conn, 'users', 'email_verified_at', 'TEXT')
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL AND email != ''"
            )
            self._seed_missing_initial_question_banks(conn)

    def create_captcha(self, purpose='email', include_dev_code=False):
        purpose = clean_text(purpose) or 'email'
        code = ''.join(secrets.choice(CAPTCHA_CHARS) for _ in range(5))
        salt = secrets.token_hex(8)
        captcha_id = new_id('captcha')
        expires_at = int(time.time()) + CAPTCHA_TTL_SECONDS
        svg = render_captcha_svg(code)
        with self.db() as conn:
            conn.execute(
                """
                INSERT INTO captcha_challenges(id, purpose, code_hash, salt, expires_at, created_at)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (captcha_id, purpose, hash_password(code, salt), salt, expires_at, utc_now())
            )
        result = {
            'id': captcha_id,
            'captcha_svg': svg,
            'captcha_image': 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode('utf-8')).decode('ascii'),
            'expires_in': CAPTCHA_TTL_SECONDS
        }
        if include_dev_code:
            result['dev_code'] = code
        return result

    def create_email_verification(
        self,
        email,
        purpose='register',
        deliver=True,
        captcha_id='',
        captcha_code='',
        require_captcha=False
    ):
        email = normalize_email(email)
        purpose = clean_text(purpose) or 'register'
        if not is_qq_email(email):
            raise AppError('请使用 QQ 邮箱接收验证码')
        code = f'{secrets.randbelow(1000000):06d}'
        salt = secrets.token_hex(8)
        expires_at = int(time.time()) + EMAIL_CODE_TTL_SECONDS
        with self.db() as conn:
            recent = conn.execute(
                """
                SELECT id FROM email_verifications
                WHERE email = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (email, purpose, int(time.time()) + EMAIL_CODE_TTL_SECONDS - EMAIL_CODE_COOLDOWN_SECONDS)
            ).fetchone()
            if recent:
                raise AppError('验证码已发送，请 60 秒后再试', 429)
            if require_captcha:
                self._verify_captcha(conn, captcha_id, captcha_code, 'email')
            conn.execute(
                """
                INSERT INTO email_verifications(id, email, purpose, code_hash, salt, expires_at, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id('mail'), email, purpose, hash_password(code, salt), salt, expires_at, utc_now())
            )

        delivered = False
        if deliver and qq_smtp_configured():
            send_qq_email_code(email, code, purpose)
            delivered = True
        result = {
            'sent': delivered,
            'email': email,
            'expires_in': EMAIL_CODE_TTL_SECONDS,
            'message': '验证码已发送到 QQ 邮箱' if delivered else '本地开发模式：SMTP 未配置，已返回 dev_code'
        }
        if not delivered:
            result['dev_code'] = code
        return result

    def create_password_reset_verification(
        self,
        email,
        deliver=True,
        captcha_id='',
        captcha_code='',
        require_captcha=False
    ):
        email = normalize_email(email)
        if not is_qq_email(email):
            raise AppError('请使用注册 QQ 邮箱接收验证码')
        with self.db() as conn:
            user = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if not user:
            raise AppError('这个 QQ 邮箱还没有注册账号', 404)
        return self.create_email_verification(
            email,
            purpose='reset_password',
            deliver=deliver,
            captcha_id=captcha_id,
            captcha_code=captcha_code,
            require_captcha=require_captcha
        )

    def _verify_captcha(self, conn, captcha_id, captcha_code, purpose='email'):
        captcha_id = clean_text(captcha_id)
        captcha_code = clean_text(captcha_code).upper().replace(' ', '')
        if not captcha_id or not captcha_code:
            raise AppError('请先完成图形识别码')
        now_ts = int(time.time())
        row = conn.execute(
            """
            SELECT * FROM captcha_challenges
            WHERE id = ? AND purpose = ? AND used_at IS NULL
            """,
            (captcha_id, purpose)
        ).fetchone()
        if not row or row['expires_at'] < now_ts:
            raise AppError('图形识别码不存在或已过期，请刷新后重试')
        if int(row['attempts'] or 0) >= 5:
            raise AppError('图形识别码尝试次数过多，请刷新后重试')
        if row['code_hash'] != hash_password(captcha_code, row['salt']):
            conn.execute('UPDATE captcha_challenges SET attempts = attempts + 1 WHERE id = ?', (captcha_id,))
            raise AppError('图形识别码错误，请重新识别')
        conn.execute('UPDATE captcha_challenges SET used_at = ? WHERE id = ?', (utc_now(), captcha_id))

    def register(self, username, password, nickname='', email='', email_code='', require_email=False):
        username = clean_text(username)
        nickname = clean_text(nickname) or username
        email = normalize_email(email)
        if not re.fullmatch(r'[A-Za-z0-9_\-\u4e00-\u9fa5]{3,32}', username):
            raise AppError('用户名需为 3-32 位中文、字母、数字、下划线或短横线')
        if len(password or '') < 8:
            raise AppError('密码至少 8 位')
        if require_email or email or email_code:
            if not is_qq_email(email):
                raise AppError('注册需要通过 QQ 邮箱验证')
            if not clean_text(email_code):
                raise AppError('请填写 QQ 邮箱验证码')

        user_id = new_id('user')
        salt = secrets.token_hex(16)
        password_hash = hash_password(password, salt)
        try:
            with self.db() as conn:
                verified_at = None
                if require_email or email or email_code:
                    self._verify_email_code(conn, email, email_code, 'register')
                    verified_at = utc_now()
                conn.execute(
                    """
                    INSERT INTO users(id, username, email, email_verified_at, nickname, password_hash, salt, created_at)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, username, email or None, verified_at, nickname, password_hash, salt, utc_now())
                )
                self._ensure_ai_account(conn, user_id)
                self._seed_initial_question_bank(conn, user_id)
            return {'id': user_id, 'username': username, 'nickname': nickname, 'email': email}
        except sqlite3.IntegrityError:
            raise AppError('用户名或 QQ 邮箱已存在', 409)

    def login(self, username, password):
        with self.db() as conn:
            user = conn.execute('SELECT * FROM users WHERE username = ?', (clean_text(username),)).fetchone()
            if not user or user['password_hash'] != hash_password(password or '', user['salt']):
                raise AppError('用户名或密码错误', 401)
            token = secrets.token_urlsafe(32)
            conn.execute(
                'INSERT INTO auth_tokens(token, user_id, created_at) VALUES(?, ?, ?)',
                (token, user['id'], utc_now())
            )
            self._ensure_ai_account(conn, user['id'])
        return {'token': token, 'user': public_user(user)}

    def reset_password_by_email(self, email, email_code, new_password):
        email = normalize_email(email)
        if not is_qq_email(email):
            raise AppError('请使用注册 QQ 邮箱重置密码')
        if len(new_password or '') < 8:
            raise AppError('新密码至少 8 位')
        salt = secrets.token_hex(16)
        password_hash = hash_password(new_password, salt)
        with self.db() as conn:
            user = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
            if not user:
                raise AppError('这个 QQ 邮箱还没有注册账号', 404)
            self._verify_email_code(conn, email, email_code, 'reset_password')
            conn.execute(
                'UPDATE users SET password_hash = ?, salt = ? WHERE id = ?',
                (password_hash, salt, user['id'])
            )
            conn.execute('DELETE FROM auth_tokens WHERE user_id = ?', (user['id'],))
        return {'reset': True, 'email': email}

    def require_user(self, token):
        if not token:
            raise AppError('请先登录', 401)
        with self.db() as conn:
            row = conn.execute(
                """
                SELECT users.* FROM auth_tokens
                JOIN users ON users.id = auth_tokens.user_id
                WHERE auth_tokens.token = ?
                """,
                (token,)
            ).fetchone()
        if not row:
            raise AppError('登录已失效', 401)
        return public_user(row)

    def _verify_email_code(self, conn, email, code, purpose='register'):
        code = re.sub(r'\s+', '', str(code or ''))
        now_ts = int(time.time())
        row = conn.execute(
            """
            SELECT * FROM email_verifications
            WHERE email = ? AND purpose = ? AND used_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (email, purpose)
        ).fetchone()
        if not row or row['expires_at'] < now_ts:
            raise AppError('邮箱验证码不存在或已过期')
        if row['code_hash'] != hash_password(code, row['salt']):
            raise AppError('邮箱验证码错误')
        conn.execute('UPDATE email_verifications SET used_at = ? WHERE id = ?', (utc_now(), row['id']))

    def _ensure_ai_account(self, conn, user_id):
        conn.execute(
            """
            INSERT OR IGNORE INTO ai_accounts(user_id, free_credits, paid_credits, total_used, updated_at)
            VALUES(?, ?, 0, 0, ?)
            """,
            (user_id, FREE_AI_CREDITS, utc_now())
        )
        conn.execute(
            """
            UPDATE ai_accounts
            SET free_credits = max(0, ? - total_used), updated_at = ?
            WHERE user_id = ? AND free_credits < max(0, ? - total_used)
            """,
            (FREE_AI_CREDITS, utc_now(), user_id, FREE_AI_CREDITS)
        )

    def get_ai_account(self, token):
        user = self.require_user(token)
        with self.db() as conn:
            self._ensure_ai_account(conn, user['id'])
            row = conn.execute('SELECT * FROM ai_accounts WHERE user_id = ?', (user['id'],)).fetchone()
        return ai_account_from_row(row)

    def ensure_ai_credit(self, token, amount=1):
        account = self.get_ai_account(token)
        if account['remaining'] < amount:
            raise AppError('AI 次数不足，当前充值功能暂未开放，请稍后再试', 402)
        return account

    def consume_ai_credit(self, token, amount=1):
        if amount <= 0:
            return self.get_ai_account(token)
        user = self.require_user(token)
        with self.db() as conn:
            self._ensure_ai_account(conn, user['id'])
            row = conn.execute('SELECT * FROM ai_accounts WHERE user_id = ?', (user['id'],)).fetchone()
            free = int(row['free_credits'])
            paid = int(row['paid_credits'])
            if free + paid < amount:
                raise AppError('AI 次数不足，当前充值功能暂未开放，请稍后再试', 402)
            use_free = min(free, amount)
            use_paid = amount - use_free
            conn.execute(
                """
                UPDATE ai_accounts
                SET free_credits = free_credits - ?,
                    paid_credits = paid_credits - ?,
                    total_used = total_used + ?,
                    updated_at = ?
                WHERE user_id = ?
                """,
                (use_free, use_paid, amount, utc_now(), user['id'])
            )
            row = conn.execute('SELECT * FROM ai_accounts WHERE user_id = ?', (user['id'],)).fetchone()
        return ai_account_from_row(row)

    def create_ai_payment_order(self, token, payload):
        raise AppError('AI 充值功能暂未开放，当前每个用户免费体验 20 次', 503)
        user = self.require_user(token)
        provider = clean_text((payload or {}).get('provider') or 'alipay').lower()
        if provider != 'alipay':
            raise AppError('当前仅支持支付宝支付交互')
        amount_cents = parse_amount_cents((payload or {}).get('amount_yuan') or (payload or {}).get('amount') or 1)
        if amount_cents < 100:
            raise AppError('AI 充值金额最低 1 元')
        credits = int((Decimal(amount_cents) / Decimal(100) * Decimal(AI_CREDITS_PER_YUAN)).to_integral_value(rounding=ROUND_HALF_UP))
        order_id = new_id('pay')
        amount_yuan = cents_to_yuan(amount_cents)
        payment_url = f'alipay://exam-v5/pay?order={order_id}&amount={amount_yuan}&credits={credits}'
        with self.db() as conn:
            self._ensure_ai_account(conn, user['id'])
            conn.execute(
                """
                INSERT INTO payment_orders(id, user_id, provider, amount_cents, credits, status, payment_url, metadata_json, created_at)
                VALUES(?, ?, ?, ?, ?, 'pending', ?, ?, ?)
                """,
                (
                    order_id,
                    user['id'],
                    provider,
                    amount_cents,
                    credits,
                    payment_url,
                    json.dumps({'rate': AI_CREDITS_PER_YUAN, 'local_confirm': True}, ensure_ascii=False),
                    utc_now()
                )
            )
            row = conn.execute('SELECT * FROM payment_orders WHERE id = ?', (order_id,)).fetchone()
        return payment_order_from_row(row)

    def complete_payment_order(self, token, order_id):
        raise AppError('AI 充值功能暂未开放，当前每个用户免费体验 20 次', 503)
        user = self.require_user(token)
        with self.db() as conn:
            self._ensure_ai_account(conn, user['id'])
            row = conn.execute(
                'SELECT * FROM payment_orders WHERE id = ? AND user_id = ?',
                (order_id, user['id'])
            ).fetchone()
            if not row:
                raise AppError('支付订单不存在', 404)
            if row['status'] == 'pending':
                conn.execute(
                    'UPDATE payment_orders SET status = ?, paid_at = ? WHERE id = ?',
                    ('paid', utc_now(), order_id)
                )
                conn.execute(
                    """
                    UPDATE ai_accounts
                    SET paid_credits = paid_credits + ?,
                        updated_at = ?
                    WHERE user_id = ?
                    """,
                    (int(row['credits']), utc_now(), user['id'])
                )
            row = conn.execute('SELECT * FROM payment_orders WHERE id = ?', (order_id,)).fetchone()
        return payment_order_from_row(row)

    def list_payment_orders(self, token):
        user = self.require_user(token)
        with self.db() as conn:
            rows = conn.execute(
                'SELECT * FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC',
                (user['id'],)
            ).fetchall()
        return [payment_order_from_row(row) for row in rows]

    def parse_questions(self, text, rules=None):
        text = (text or '').replace('\r\n', '\n').replace('\r', '\n').strip()
        if not text:
            return []

        json_questions = self._try_parse_json(text)
        if json_questions:
            return json_questions

        rules = rules or {}
        question_start = rules.get('questionStart') or r'(?m)^\s*\d+[\.\、]\s*'
        option_re = re.compile(rules.get('option') or r'(?m)^([A-Ha-h])[\.\、\)]\s*(.+)$')
        answer_re = re.compile(rules.get('answer') or r'(?:参考)?答案[:：]\s*([A-Ha-h]+|正确|错误|对|错)', re.I)
        analysis_re = re.compile(rules.get('analysis') or r'解析[:：]\s*(.*)', re.I | re.S)

        starts = list(re.finditer(question_start, text))
        if not starts:
            starts = [re.match(r'', text)]

        blocks = []
        for index, match in enumerate(starts):
            start = match.start()
            end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
            block = text[start:end].strip()
            if block:
                blocks.append(block)

        questions = []
        for block in blocks:
            question = self._parse_block(block, question_start, option_re, answer_re, analysis_re)
            if question:
                questions.append(question)
        return questions

    def ai_parse_questions(self, text, api_key=None):
        if not api_key:
            return {'mode': 'fallback', 'questions': self.parse_questions(text)}

        prompt = (
            '请把下面的试题文本解析成 JSON 数组。每题字段必须包含 question, options, answer, analysis, type。'
            '无法判断解析时 analysis 用空字符串，type 为 single/multi/judge/blank。只返回 JSON。\n\n'
            + text
        )
        try:
            content = call_deepseek(api_key, [
                {'role': 'system', 'content': '你是严谨的试题结构化解析器，只输出 JSON。'},
                {'role': 'user', 'content': prompt}
            ])
            questions = self._try_parse_json(extract_json(content))
            if questions:
                return {'mode': 'ai', 'questions': questions}
        except Exception:
            pass
        return {'mode': 'fallback', 'questions': self.parse_questions(text)}

    def create_paper(self, user_id, payload):
        questions = normalize_questions(payload.get('questions') or [])
        if not questions:
            raise AppError('试卷至少需要 1 道题')
        paper_id = payload.get('id') or new_id('paper')
        title = clean_text(payload.get('title')) or '未命名试卷'
        category = clean_text(payload.get('category')) or '综合'
        group_name = clean_text(payload.get('group_name') or payload.get('groupName')) or '默认分组'
        source = clean_text(payload.get('source')) or 'manual'

        with self.db() as conn:
            self._insert_paper(conn, paper_id, user_id, title, category, group_name, source, questions)
        return {'id': paper_id, 'title': title, 'category': category, 'group_name': group_name, 'question_count': len(questions), 'questions': questions}

    def list_papers(self, token):
        user = self.require_user(token)
        with self.db() as conn:
            rows = conn.execute(
                'SELECT * FROM papers WHERE user_id = ? ORDER BY created_at DESC',
                (user['id'],)
            ).fetchall()
        return [dict(row) for row in rows]

    def get_paper(self, token, paper_id):
        user = self.require_user(token)
        with self.db() as conn:
            paper = conn.execute('SELECT * FROM papers WHERE id = ? AND user_id = ?', (paper_id, user['id'])).fetchone()
            if not paper:
                raise AppError('试卷不存在', 404)
            questions = conn.execute('SELECT * FROM questions WHERE paper_id = ? ORDER BY rowid ASC', (paper_id,)).fetchall()
        result = dict(paper)
        result['questions'] = [question_from_row(row) for row in questions]
        return result

    def update_paper(self, token, paper_id, payload):
        user = self.require_user(token)
        allowed = {
            'title': clean_text(payload.get('title')) if 'title' in payload else None,
            'category': clean_text(payload.get('category')) if 'category' in payload else None,
            'group_name': clean_text(payload.get('group_name') or payload.get('groupName')) if ('group_name' in payload or 'groupName' in payload) else None
        }
        fields = []
        values = []
        defaults = {
            'title': '未命名试卷',
            'category': '综合',
            'group_name': '默认分组'
        }
        for key, value in allowed.items():
            if value is not None:
                fields.append(f'{key} = ?')
                values.append(value or defaults[key])
        if not fields:
            return {'updated': False, 'paper_id': paper_id}
        values.extend([paper_id, user['id']])
        with self.db() as conn:
            cursor = conn.execute(
                f"UPDATE papers SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
                values
            )
        if cursor.rowcount == 0:
            raise AppError('试卷不存在', 404)
        paper = self.get_paper(token, paper_id)
        return {'updated': True, 'paper': paper}

    def update_question(self, token, question_id, payload):
        user = self.require_user(token)
        with self.db() as conn:
            row = conn.execute(
                """
                SELECT questions.*
                FROM questions
                JOIN papers ON papers.id = questions.paper_id
                WHERE questions.id = ? AND papers.user_id = ?
                """,
                (question_id, user['id'])
            ).fetchone()
            if not row:
                raise AppError('题目不存在', 404)
            current = question_from_row(row)
            question_text = clean_text(payload.get('question', current['question']))
            answer = normalize_answer(payload.get('answer', current['answer']))
            options = payload.get('options', current['options'])
            if isinstance(options, str):
                options = [line for line in options.splitlines()]
            options = [clean_text(option) for option in (options or []) if clean_text(option)]
            qtype = clean_text(payload.get('type', current['type'])) or infer_type(options, answer)
            analysis = clean_text(payload.get('analysis', current.get('analysis', '')))
            tags = payload.get('tags', current.get('tags', []))
            if isinstance(tags, str):
                tags = [item.strip() for item in tags.split(',') if item.strip()]
            score = payload.get('score', current.get('score', 1))
            try:
                score = float(score or 1)
            except (TypeError, ValueError):
                score = 1
            if not question_text:
                raise AppError('题干不能为空')
            if not answer:
                raise AppError('答案不能为空')
            conn.execute(
                """
                UPDATE questions
                SET type = ?, question = ?, options_json = ?, answer = ?, analysis = ?, tags_json = ?, score = ?
                WHERE id = ?
                """,
                (
                    qtype, question_text, json.dumps(options, ensure_ascii=False), answer, analysis,
                    json.dumps(tags or [], ensure_ascii=False), score, question_id
                )
            )
            updated = conn.execute('SELECT * FROM questions WHERE id = ?', (question_id,)).fetchone()
        return {'updated': True, 'question': question_from_row(updated)}

    def delete_paper(self, token, paper_id):
        user = self.require_user(token)
        with self.db() as conn:
            cursor = conn.execute(
                'DELETE FROM papers WHERE id = ? AND user_id = ?',
                (paper_id, user['id'])
            )
        if cursor.rowcount == 0:
            raise AppError('试卷不存在', 404)
        return {'deleted': True, 'id': paper_id}

    def delete_question(self, token, question_id):
        user = self.require_user(token)
        with self.db() as conn:
            row = conn.execute(
                """
                SELECT questions.id, questions.paper_id
                FROM questions
                JOIN papers ON papers.id = questions.paper_id
                WHERE questions.id = ? AND papers.user_id = ?
                """,
                (question_id, user['id'])
            ).fetchone()
            if not row:
                raise AppError('题目不存在', 404)

            paper_id = row['paper_id']
            conn.execute('DELETE FROM questions WHERE id = ?', (question_id,))
            question_count = conn.execute(
                'SELECT COUNT(*) AS c FROM questions WHERE paper_id = ?',
                (paper_id,)
            ).fetchone()['c']
            conn.execute(
                'UPDATE papers SET question_count = ? WHERE id = ? AND user_id = ?',
                (question_count, paper_id, user['id'])
            )
        return {
            'deleted': True,
            'id': question_id,
            'paper_id': paper_id,
            'question_count': question_count
        }

    def start_session(self, token, paper_id, mode='practice'):
        user = self.require_user(token)
        self.get_paper(token, paper_id)
        session_id = new_id('session')
        with self.db() as conn:
            conn.execute(
                'INSERT INTO sessions(id, user_id, paper_id, mode, started_at) VALUES(?, ?, ?, ?, ?)',
                (session_id, user['id'], paper_id, mode or 'practice', utc_now())
            )
        return {'id': session_id, 'paper_id': paper_id, 'mode': mode or 'practice'}

    def submit_answer(self, token, session_id, question_id, user_answer, time_spent_ms=0):
        user = self.require_user(token)
        with self.db() as conn:
            session = conn.execute(
                'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
                (session_id, user['id'])
            ).fetchone()
            if not session:
                raise AppError('刷题会话不存在', 404)
            row = conn.execute('SELECT * FROM questions WHERE id = ?', (question_id,)).fetchone()
            if not row:
                raise AppError('题目不存在', 404)

            question = question_from_row(row)
            correct = normalize_answer(user_answer) == normalize_answer(question['answer'])
            conn.execute(
                """
                INSERT INTO answers(id, session_id, user_id, question_id, user_answer, correct, time_spent_ms, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id('answer'), session_id, user['id'], question_id, str(user_answer), int(correct), int(time_spent_ms or 0), utc_now())
            )
            self._upsert_review(conn, user['id'], question_id, correct, int(time_spent_ms or 0))
            if not correct:
                self._upsert_wrong(conn, user['id'], question_id, str(user_answer))

        return {
            'correct': bool(correct),
            'answer': question['answer'],
            'analysis': question.get('analysis', ''),
            'question': question
        }

    def finish_session(self, token, session_id):
        user = self.require_user(token)
        with self.db() as conn:
            session = conn.execute(
                'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
                (session_id, user['id'])
            ).fetchone()
            if not session:
                raise AppError('刷题会话不存在', 404)
            total = conn.execute(
                'SELECT COUNT(*) c FROM questions WHERE paper_id = ?',
                (session['paper_id'],)
            ).fetchone()['c']
            answered = conn.execute(
                'SELECT COUNT(DISTINCT question_id) c FROM answers WHERE session_id = ? AND user_id = ?',
                (session_id, user['id'])
            ).fetchone()['c']
            correct = conn.execute(
                'SELECT COUNT(DISTINCT question_id) c FROM answers WHERE session_id = ? AND user_id = ? AND correct = 1',
                (session_id, user['id'])
            ).fetchone()['c']
            finished_at = utc_now()
            conn.execute(
                'UPDATE sessions SET finished_at = ? WHERE id = ? AND user_id = ?',
                (finished_at, session_id, user['id'])
            )
        return {
            'id': session_id,
            'total': total,
            'answered': answered,
            'unanswered': max(total - answered, 0),
            'correct': correct,
            'accuracy': round(correct / answered * 100) if answered else 0,
            'finished_at': finished_at
        }

    def list_wrongbook(self, token):
        user = self.require_user(token)
        with self.db() as conn:
            rows = conn.execute(
                """
                SELECT wrongbook.*, questions.question, questions.answer, questions.analysis, questions.options_json, questions.type
                FROM wrongbook
                JOIN questions ON questions.id = wrongbook.question_id
                WHERE wrongbook.user_id = ?
                ORDER BY wrongbook.updated_at DESC
                """,
                (user['id'],)
            ).fetchall()
        return [wrong_from_row(row) for row in rows]

    def update_wrongbook(self, token, wrong_id, payload):
        user = self.require_user(token)
        fields = []
        values = []
        for key in ('reason', 'note'):
            if key in payload:
                fields.append(f'{key} = ?')
                values.append(clean_text(payload[key]))
        if 'mastered' in payload:
            fields.append('mastered = ?')
            values.append(1 if payload['mastered'] else 0)
        if not fields:
            return {'updated': False}
        fields.append('updated_at = ?')
        values.append(utc_now())
        values.extend([wrong_id, user['id']])
        with self.db() as conn:
            conn.execute(f"UPDATE wrongbook SET {', '.join(fields)} WHERE id = ? AND user_id = ?", values)
        return {'updated': True}

    def delete_wrongbook(self, token, wrong_id):
        user = self.require_user(token)
        with self.db() as conn:
            cursor = conn.execute(
                'DELETE FROM wrongbook WHERE id = ? AND user_id = ?',
                (wrong_id, user['id'])
            )
        if cursor.rowcount == 0:
            raise AppError('错题记录不存在', 404)
        return {'deleted': True, 'id': wrong_id}

    def update_question_analysis(self, token, question_id, analysis):
        user = self.require_user(token)
        analysis = clean_text(analysis)
        if len(analysis) > 5000:
            raise AppError('解析最多 5000 字')
        with self.db() as conn:
            row = conn.execute(
                """
                SELECT questions.id
                FROM questions
                JOIN papers ON papers.id = questions.paper_id
                WHERE questions.id = ? AND papers.user_id = ?
                """,
                (question_id, user['id'])
            ).fetchone()
            if not row:
                raise AppError('题目不存在', 404)
            conn.execute('UPDATE questions SET analysis = ? WHERE id = ?', (analysis, question_id))
        return {'updated': True, 'question_id': question_id, 'analysis': analysis}

    def set_question_favorite(self, token, question_id, favorite=True):
        user = self.require_user(token)
        with self.db() as conn:
            self._require_owned_question(conn, user['id'], question_id)
            if favorite:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO favorites(user_id, question_id, created_at)
                    VALUES(?, ?, ?)
                    """,
                    (user['id'], question_id, utc_now())
                )
            else:
                conn.execute(
                    'DELETE FROM favorites WHERE user_id = ? AND question_id = ?',
                    (user['id'], question_id)
                )
        return {'updated': True, 'question_id': question_id, 'favorite': bool(favorite)}

    def list_favorites(self, token):
        user = self.require_user(token)
        with self.db() as conn:
            rows = conn.execute(
                """
                SELECT favorites.created_at AS favorite_created_at,
                       papers.title AS paper_title,
                       questions.*
                FROM favorites
                JOIN questions ON questions.id = favorites.question_id
                JOIN papers ON papers.id = questions.paper_id
                WHERE favorites.user_id = ?
                ORDER BY favorites.created_at DESC
                """,
                (user['id'],)
            ).fetchall()
        return [favorite_from_row(row) for row in rows]

    def list_due_reviews(self, token, include_future=False):
        user = self.require_user(token)
        cutoff = 9999999999999 if include_future else int(time.time() * 1000)
        with self.db() as conn:
            rows = conn.execute(
                """
                SELECT review_schedule.*, questions.question, questions.answer, questions.analysis, questions.options_json, questions.type
                FROM review_schedule
                JOIN questions ON questions.id = review_schedule.question_id
                WHERE review_schedule.user_id = ? AND review_schedule.next_review_at <= ?
                ORDER BY review_schedule.next_review_at ASC
                """,
                (user['id'], cutoff)
            ).fetchall()
        return [review_from_row(row) for row in rows]

    def stats(self, token):
        user = self.require_user(token)
        with self.db() as conn:
            paper_count = conn.execute('SELECT COUNT(*) c FROM papers WHERE user_id = ?', (user['id'],)).fetchone()['c']
            question_count = conn.execute(
                """
                SELECT COUNT(*) c
                FROM questions
                JOIN papers ON papers.id = questions.paper_id
                WHERE papers.user_id = ?
                """,
                (user['id'],)
            ).fetchone()['c']
            answer_count = conn.execute('SELECT COUNT(*) c FROM answers WHERE user_id = ?', (user['id'],)).fetchone()['c']
            correct_count = conn.execute('SELECT COUNT(*) c FROM answers WHERE user_id = ? AND correct = 1', (user['id'],)).fetchone()['c']
            wrong_count = conn.execute('SELECT COUNT(*) c FROM wrongbook WHERE user_id = ? AND mastered = 0', (user['id'],)).fetchone()['c']
            favorite_count = conn.execute('SELECT COUNT(*) c FROM favorites WHERE user_id = ?', (user['id'],)).fetchone()['c']
            avg_time_row = conn.execute(
                'SELECT AVG(time_spent_ms) avg_time FROM answers WHERE user_id = ?',
                (user['id'],)
            ).fetchone()
            due_count = conn.execute(
                'SELECT COUNT(*) c FROM review_schedule WHERE user_id = ? AND next_review_at <= ?',
                (user['id'], int(time.time() * 1000))
            ).fetchone()['c']
            recent_rows = conn.execute(
                """
                SELECT correct, time_spent_ms, created_at
                FROM answers
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 30
                """,
                (user['id'],)
            ).fetchall()
            group_rows = conn.execute(
                """
                SELECT papers.group_name,
                       papers.category,
                       COUNT(DISTINCT questions.id) question_count,
                       COUNT(answers.id) answer_count,
                       COALESCE(SUM(answers.correct), 0) correct_count,
                       AVG(answers.time_spent_ms) avg_time
                FROM papers
                JOIN questions ON questions.paper_id = papers.id
                LEFT JOIN answers ON answers.question_id = questions.id AND answers.user_id = papers.user_id
                WHERE papers.user_id = ?
                GROUP BY papers.group_name, papers.category
                ORDER BY answer_count DESC, question_count DESC
                """,
                (user['id'],)
            ).fetchall()
            type_rows = conn.execute(
                """
                SELECT questions.type,
                       COUNT(answers.id) answer_count,
                       COALESCE(SUM(answers.correct), 0) correct_count,
                       AVG(answers.time_spent_ms) avg_time
                FROM answers
                JOIN questions ON questions.id = answers.question_id
                WHERE answers.user_id = ?
                GROUP BY questions.type
                ORDER BY answer_count DESC
                """,
                (user['id'],)
            ).fetchall()
            wrong_reason_rows = conn.execute(
                """
                SELECT reason, COUNT(*) count, COALESCE(SUM(wrong_count), 0) total_wrong
                FROM wrongbook
                WHERE user_id = ? AND mastered = 0
                GROUP BY reason
                ORDER BY count DESC, total_wrong DESC
                LIMIT 8
                """,
                (user['id'],)
            ).fetchall()
            mastery_rows = conn.execute(
                """
                SELECT level, COUNT(*) count
                FROM review_schedule
                WHERE user_id = ?
                GROUP BY level
                ORDER BY level ASC
                """,
                (user['id'],)
            ).fetchall()
            slow_rows = conn.execute(
                """
                SELECT questions.id,
                       questions.question,
                       papers.group_name,
                       COUNT(answers.id) answer_count,
                       COALESCE(SUM(answers.correct), 0) correct_count,
                       AVG(answers.time_spent_ms) avg_time
                FROM answers
                JOIN questions ON questions.id = answers.question_id
                JOIN papers ON papers.id = questions.paper_id
                WHERE answers.user_id = ?
                GROUP BY questions.id
                HAVING answer_count > 0
                ORDER BY avg_time DESC
                LIMIT 5
                """,
                (user['id'],)
            ).fetchall()
        accuracy = round(correct_count / answer_count * 100) if answer_count else 0
        avg_time_ms = round(avg_time_row['avg_time'] or 0)
        recent_answers = [dict(row) for row in reversed(recent_rows)]
        recent_accuracy = round(sum(row['correct'] for row in recent_rows) / len(recent_rows) * 100) if recent_rows else 0
        group_stats = [
            {
                'group_name': row['group_name'],
                'category': row['category'],
                'questions': row['question_count'],
                'answers': row['answer_count'],
                'accuracy': round(row['correct_count'] / row['answer_count'] * 100) if row['answer_count'] else 0,
                'avg_time_ms': round(row['avg_time'] or 0)
            }
            for row in group_rows
        ]
        answered_groups = [item for item in group_stats if item['answers']]
        weakest_groups = sorted(answered_groups, key=lambda item: (item['accuracy'], -item['answers']))[:5]
        type_stats = [
            {
                'type': row['type'],
                'answers': row['answer_count'],
                'accuracy': round(row['correct_count'] / row['answer_count'] * 100) if row['answer_count'] else 0,
                'avg_time_ms': round(row['avg_time'] or 0)
            }
            for row in type_rows
        ]
        wrong_reason_stats = [
            {'reason': row['reason'], 'count': row['count'], 'total_wrong': row['total_wrong']}
            for row in wrong_reason_rows
        ]
        mastery_stats = [{'level': row['level'], 'count': row['count']} for row in mastery_rows]
        slow_questions = [
            {
                'id': row['id'],
                'question': row['question'],
                'group_name': row['group_name'],
                'answers': row['answer_count'],
                'accuracy': round(row['correct_count'] / row['answer_count'] * 100) if row['answer_count'] else 0,
                'avg_time_ms': round(row['avg_time'] or 0)
            }
            for row in slow_rows
        ]
        recommendations = build_learning_recommendations({
            'answers': answer_count,
            'accuracy': accuracy,
            'recent_accuracy': recent_accuracy,
            'wrong': wrong_count,
            'due': due_count,
            'avg_time_ms': avg_time_ms,
            'weakest_groups': weakest_groups,
            'wrong_reason_stats': wrong_reason_stats,
            'slow_questions': slow_questions
        })
        return {
            'papers': paper_count,
            'questions': question_count,
            'answers': answer_count,
            'accuracy': accuracy,
            'recent_accuracy': recent_accuracy,
            'avg_time_ms': avg_time_ms,
            'wrong': wrong_count,
            'due': due_count,
            'favorites': favorite_count,
            'recent_answers': recent_answers,
            'group_stats': group_stats,
            'weakest_groups': weakest_groups,
            'type_stats': type_stats,
            'wrong_reason_stats': wrong_reason_stats,
            'mastery_stats': mastery_stats,
            'slow_questions': slow_questions,
            'recommendations': recommendations
        }

    def _try_parse_json(self, text):
        try:
            data = json.loads(text)
        except Exception:
            return []
        items = data.get('questions') if isinstance(data, dict) else data
        return normalize_questions(items) if isinstance(items, list) else []

    def _parse_block(self, block, question_start, option_re, answer_re, analysis_re):
        clean_block = re.sub(question_start, '', block, count=1).strip()
        title_prefix = re.match(r'^(题目|问题)[:：]?[ \t]+(.+)$', clean_block, re.S)
        if title_prefix:
            clean_block = title_prefix.group(2).strip()
        answer_match = answer_re.search(clean_block)
        if not answer_match:
            return None
        analysis_match = analysis_re.search(clean_block)
        answer = normalize_answer(answer_match.group(1))
        analysis = clean_text(analysis_match.group(1)) if analysis_match else ''

        options = []
        for option_match in option_re.finditer(clean_block):
            options.append(clean_text(option_match.group(2)))

        question_part = answer_re.sub('', clean_block)
        question_part = analysis_re.sub('', question_part)
        question_part = option_re.sub('', question_part)
        question = clean_text(question_part)
        if not question:
            return None

        qtype = infer_type(options, answer)
        return {
            'id': new_id('q'),
            'question': question,
            'options': options,
            'answer': answer,
            'analysis': analysis,
            'type': qtype,
            'tags': [],
            'score': 1
        }

    def _seed_initial_question_bank(self, conn, user_id):
        if not os.path.exists(INITIAL_BANK_PATH):
            return
        existing = conn.execute(
            'SELECT id FROM papers WHERE user_id = ? AND source = ? LIMIT 1',
            (user_id, 'initial_seed')
        ).fetchone()
        if existing:
            return
        with open(INITIAL_BANK_PATH, 'r', encoding='utf-8') as source:
            questions = self.parse_questions(source.read())
        if not questions:
            return
        self._insert_paper(
            conn,
            new_id('paper'),
            user_id,
            INITIAL_BANK_TITLE,
            INITIAL_BANK_CATEGORY,
            INITIAL_BANK_GROUP,
            'initial_seed',
            questions
        )

    def _seed_missing_initial_question_banks(self, conn):
        users = conn.execute('SELECT id FROM users').fetchall()
        for user in users:
            self._seed_initial_question_bank(conn, user['id'])

    def _insert_paper(self, conn, paper_id, user_id, title, category, group_name, source, questions):
        conn.execute(
            """
            INSERT INTO papers(id, user_id, title, category, group_name, source, question_count, created_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (paper_id, user_id, title, category, group_name, source, len(questions), utc_now())
        )
        for question in questions:
            conn.execute(
                """
                INSERT INTO questions(id, paper_id, type, question, options_json, answer, analysis, tags_json, score)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    question['id'], paper_id, question['type'], question['question'],
                    json.dumps(question['options'], ensure_ascii=False), question['answer'],
                    question.get('analysis', ''), json.dumps(question.get('tags', []), ensure_ascii=False),
                    float(question.get('score', 1))
                )
            )

    def _upsert_wrong(self, conn, user_id, question_id, user_answer):
        existing = conn.execute(
            'SELECT * FROM wrongbook WHERE user_id = ? AND question_id = ?',
            (user_id, question_id)
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE wrongbook
                SET user_answer = ?, wrong_count = wrong_count + 1, mastered = 0, updated_at = ?
                WHERE user_id = ? AND question_id = ?
                """,
                (user_answer, utc_now(), user_id, question_id)
            )
        else:
            conn.execute(
                """
                INSERT INTO wrongbook(id, user_id, question_id, user_answer, updated_at)
                VALUES(?, ?, ?, ?, ?)
                """,
                (new_id('wrong'), user_id, question_id, user_answer, utc_now())
            )

    def _upsert_review(self, conn, user_id, question_id, correct, time_spent_ms):
        existing = conn.execute(
            'SELECT * FROM review_schedule WHERE user_id = ? AND question_id = ?',
            (user_id, question_id)
        ).fetchone()
        level = existing['level'] if existing else 0
        correct_count = existing['correct_count'] if existing else 0
        wrong_count = existing['wrong_count'] if existing else 0
        if correct:
            correct_count += 1
            level = min(7, level + (2 if time_spent_ms and time_spent_ms < 8000 else 1))
        else:
            wrong_count += 1
            level = max(0, level - 1)
        intervals = [5, 30, 720, 1440, 2880, 5760, 10080, 21600]
        next_review_at = int(time.time() * 1000) + intervals[level] * 60 * 1000
        conn.execute(
            """
            INSERT INTO review_schedule(user_id, question_id, level, next_review_at, correct_count, wrong_count, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, question_id) DO UPDATE SET
              level = excluded.level,
              next_review_at = excluded.next_review_at,
              correct_count = excluded.correct_count,
              wrong_count = excluded.wrong_count,
              updated_at = excluded.updated_at
            """,
            (user_id, question_id, level, next_review_at, correct_count, wrong_count, utc_now())
        )

    def _require_owned_question(self, conn, user_id, question_id):
        row = conn.execute(
            """
            SELECT questions.id
            FROM questions
            JOIN papers ON papers.id = questions.paper_id
            WHERE questions.id = ? AND papers.user_id = ?
            """,
            (question_id, user_id)
        ).fetchone()
        if not row:
            raise AppError('题目不存在', 404)
        return row


def normalize_questions(items):
    questions = []
    for item in items or []:
        question = clean_text(item.get('question') or item.get('title') or item.get('content'))
        answer = normalize_answer(item.get('answer') or item.get('correctAnswer'))
        if not question or not answer:
            continue
        options = item.get('options') or item.get('choices') or []
        options = [clean_text(option) for option in options if clean_text(option)]
        questions.append({
            'id': str(item.get('id') or new_id('q')),
            'question': question,
            'options': options,
            'answer': answer,
            'analysis': clean_text(item.get('analysis') or item.get('explanation') or ''),
            'type': item.get('type') or infer_type(options, answer),
            'tags': item.get('tags') or [],
            'score': item.get('score') or 1
        })
    return questions


def build_learning_recommendations(stats):
    recommendations = []
    weakest = stats.get('weakest_groups') or []
    reasons = stats.get('wrong_reason_stats') or []
    slow_questions = stats.get('slow_questions') or []

    if not stats.get('answers'):
        recommendations.append('先完成一套 10-20 题的小测，系统会根据答题结果生成薄弱项。')
        return recommendations
    if stats.get('due'):
        recommendations.append(f"今天优先复习 {stats['due']} 道到期题，先稳住记忆曲线。")
    if stats.get('recent_accuracy', 0) < 70:
        recommendations.append(f"最近 30 题正确率 {stats['recent_accuracy']}%，建议切到练习模式逐题看解析。")
    if weakest:
        item = weakest[0]
        recommendations.append(f"薄弱分组是「{item['group_name']}」，正确率 {item['accuracy']}%，建议先组一套专项卷。")
    if reasons:
        recommendations.append(f"主要错因是「{reasons[0]['reason']}」，复盘时先写自己的记忆解析。")
    if stats.get('avg_time_ms', 0) > 3000 or slow_questions:
        recommendations.append('存在耗时偏高题目，建议用键盘刷题做二轮限时训练。')
    if not recommendations:
        recommendations.append('整体状态稳定，今天可以用收藏题和错题混合生成一套巩固卷。')
    return recommendations[:5]


def ensure_column(conn, table, column, definition):
    columns = [row['name'] for row in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    if column not in columns:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')


def infer_type(options, answer):
    if not options:
        return 'blank'
    joined = ''.join(options)
    if len(options) == 2 and any(token in joined for token in ('正确', '错误', '对', '错')):
        return 'judge'
    if len(answer) > 1 and re.fullmatch(r'[A-H]+', answer):
        return 'multi'
    return 'single'


def normalize_answer(answer):
    return clean_text(answer).replace(' ', '').upper()


def clean_text(value):
    return re.sub(r'\s+', ' ', str(value or '').strip())


def normalize_email(value):
    return clean_text(value).lower()


def is_qq_email(value):
    return bool(re.fullmatch(r'[A-Za-z0-9._%+\-]{3,64}@qq\.com', normalize_email(value)))


def new_id(prefix):
    return f'{prefix}_{secrets.token_hex(8)}'


def utc_now():
    return datetime.now(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def hash_password(password, salt):
    return hashlib.sha256((salt + password).encode('utf-8')).hexdigest()


def public_user(row):
    data = {'id': row['id'], 'username': row['username'], 'nickname': row['nickname'], 'created_at': row['created_at']}
    if 'email' in row.keys():
        data['email'] = row['email'] or ''
        data['email_verified'] = bool(row['email_verified_at'])
    return data


def ai_account_from_row(row):
    free = int(row['free_credits'])
    paid = int(row['paid_credits'])
    used = int(row['total_used'])
    return {
        'free_credits': free,
        'paid_credits': paid,
        'remaining': free + paid,
        'total_used': used,
        'rate': AI_CREDITS_PER_YUAN,
        'updated_at': row['updated_at']
    }


def parse_amount_cents(value):
    try:
        amount = Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise AppError('充值金额格式不正确')
    if amount <= 0:
        raise AppError('充值金额必须大于 0')
    return int(amount * 100)


def cents_to_yuan(cents):
    return float((Decimal(int(cents)) / Decimal(100)).quantize(Decimal('0.01')))


def payment_order_from_row(row):
    return {
        'id': row['id'],
        'provider': row['provider'],
        'amount_yuan': cents_to_yuan(row['amount_cents']),
        'credits': int(row['credits']),
        'status': row['status'],
        'payment_url': row['payment_url'],
        'created_at': row['created_at'],
        'paid_at': row['paid_at']
    }


def qq_smtp_configured():
    return bool(os.environ.get('QQ_SMTP_USER') and os.environ.get('QQ_SMTP_AUTH_CODE'))


def send_qq_email_code(email, code, purpose='register'):
    smtp_user = os.environ.get('QQ_SMTP_USER')
    smtp_code = os.environ.get('QQ_SMTP_AUTH_CODE')
    if not smtp_user or not smtp_code:
        return False
    message = EmailMessage()
    subject_type = '重置密码' if purpose == 'reset_password' else '注册'
    message['Subject'] = f'题练云 v5 {subject_type}验证码'
    message['From'] = os.environ.get('QQ_SMTP_FROM') or smtp_user
    message['To'] = email
    message.set_content(f'你的题练云 v5 {subject_type}验证码是：{code}\n\n10 分钟内有效，如非本人操作请忽略。')
    try:
        with smtplib.SMTP_SSL(os.environ.get('QQ_SMTP_HOST', 'smtp.qq.com'), int(os.environ.get('QQ_SMTP_PORT', '465')), timeout=20) as smtp:
            smtp.login(smtp_user, smtp_code)
            smtp.send_message(message)
        return True
    except Exception as error:
        raise AppError(f'QQ 邮箱验证码发送失败：{error}', 502)


def render_captcha_svg(code):
    lines = []
    dots = []
    for index in range(7):
        x1 = secrets.randbelow(180)
        y1 = secrets.randbelow(64)
        x2 = secrets.randbelow(180)
        y2 = secrets.randbelow(64)
        color = ['#2563eb', '#0f766e', '#f97316', '#64748b'][index % 4]
        lines.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.5" opacity="0.28"/>')
    for _ in range(24):
        dots.append(
            f'<circle cx="{secrets.randbelow(180)}" cy="{secrets.randbelow(64)}" r="{1 + secrets.randbelow(2)}" fill="#0f172a" opacity="0.12"/>'
        )
    letters = []
    for index, char in enumerate(code):
        x = 28 + index * 34 + secrets.randbelow(8)
        y = 42 + secrets.randbelow(10)
        rotate = secrets.randbelow(23) - 11
        letters.append(
            f'<text x="{x}" y="{y}" transform="rotate({rotate} {x} {y})" '
            f'font-family="Verdana, sans-serif" font-size="30" font-weight="900" fill="#0f172a">{char}</text>'
        )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="64" viewBox="0 0 180 64" role="img" aria-label="图形识别码">'
        '<rect width="180" height="64" rx="16" fill="#eff6ff"/>'
        '<rect x="1" y="1" width="178" height="62" rx="15" fill="none" stroke="#bfdbfe"/>'
        + ''.join(lines)
        + ''.join(dots)
        + ''.join(letters)
        + '</svg>'
    )


def question_from_row(row):
    return {
        'id': row['id'],
        'type': row['type'],
        'question': row['question'],
        'options': json.loads(row['options_json']),
        'answer': row['answer'],
        'analysis': row['analysis'],
        'tags': json.loads(row['tags_json']) if 'tags_json' in row.keys() else [],
        'score': row['score'] if 'score' in row.keys() else 1
    }


def wrong_from_row(row):
    return {
        'id': row['id'],
        'question_id': row['question_id'],
        'question': row['question'],
        'options': json.loads(row['options_json']),
        'answer': row['answer'],
        'analysis': row['analysis'],
        'type': row['type'],
        'user_answer': row['user_answer'],
        'reason': row['reason'],
        'note': row['note'],
        'mastered': bool(row['mastered']),
        'wrong_count': row['wrong_count'],
        'updated_at': row['updated_at']
    }


def review_from_row(row):
    return {
        'question_id': row['question_id'],
        'question': row['question'],
        'options': json.loads(row['options_json']),
        'answer': row['answer'],
        'analysis': row['analysis'],
        'type': row['type'],
        'level': row['level'],
        'next_review_at': row['next_review_at'],
        'correct_count': row['correct_count'],
        'wrong_count': row['wrong_count']
    }


def favorite_from_row(row):
    return {
        'question_id': row['id'],
        'question': row['question'],
        'options': json.loads(row['options_json']),
        'answer': row['answer'],
        'analysis': row['analysis'],
        'type': row['type'],
        'paper_title': row['paper_title'],
        'created_at': row['favorite_created_at']
    }


def extract_json(content):
    content = content.strip()
    fenced = re.search(r'```(?:json)?\s*(.*?)```', content, re.S | re.I)
    if fenced:
        return fenced.group(1).strip()
    array = re.search(r'(\[.*\])', content, re.S)
    return array.group(1) if array else content


def call_deepseek(api_key, messages, model='deepseek-chat', temperature=0.35, max_tokens=1600):
    request = urllib.request.Request(
        'https://api.deepseek.com/v1/chat/completions',
        data=json.dumps({
            'model': model,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': max_tokens
        }).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data.get('choices', [{}])[0].get('message', {}).get('content', '')
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', errors='ignore')
        raise AppError(f'DeepSeek 调用失败：{detail}', error.code)
