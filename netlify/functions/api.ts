import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import path from 'node:path';

const FREE_AI_CREDITS = 20;
const AI_CREDITS_PER_YUAN = 40;
const EMAIL_CODE_TTL_SECONDS = 10 * 60;
const EMAIL_CODE_COOLDOWN_SECONDS = 60;
const CAPTCHA_TTL_SECONDS = 5 * 60;
const CAPTCHA_CHARS = '0123456789';
const INITIAL_BANK_TITLE = '计算机网络基础初始题库';
const INITIAL_BANK_CATEGORY = '计算机网络';
const INITIAL_BANK_GROUP = '系统初始题库';

class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

let cachedClient: any = null;

function db(): any {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new AppError('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.', 503);
    }
    cachedClient = createClient(url, key, {
      global: { headers: { 'User-Agent': 'exam-netlify-function/1.0' } },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    }) as any;
  }
  return cachedClient;
}

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {});
  }
  try {
    const result = await routeRequest(event);
    return jsonResponse(result.status || 200, result.body ?? result);
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    return jsonResponse(status, { error: error?.message || 'Server error' });
  }
};

export async function routeRequest(event: any) {
  const method = event.httpMethod || 'GET';
  const path = normalizePath(event.path || '');
  const body = parseBody(event.body);
  const query = event.queryStringParameters || {};
  const token = readToken(event.headers || {});

  if (method === 'GET' && path === '/api/captcha') {
    return createCaptcha(process.env.EXAM_DEV_CAPTCHA === '1' && query.dev === '1');
  }
  if (method === 'GET' && path === '/api/me') return requireUser(token);
  if (method === 'GET' && path === '/api/ai/account') return getAiAccount(token);
  if (method === 'GET' && path === '/api/payments') return { orders: await listPaymentOrders(token) };
  if (method === 'GET' && path === '/api/stats') return stats(token);
  if (method === 'GET' && path === '/api/papers') return { papers: await listPapers(token) };
  if (method === 'GET' && path.startsWith('/api/papers/')) return getPaper(token, lastPart(path));
  if (method === 'GET' && path === '/api/wrongbook') return { wrongbook: await listWrongbook(token) };
  if (method === 'GET' && path === '/api/favorites') return { favorites: await listFavorites(token) };
  if (method === 'GET' && path === '/api/review/due') return { reviews: await listDueReviews(token, query.includeFuture === '1') };

  if (method === 'POST' && path === '/api/email/send-code') {
    return createEmailVerification(body.email, {
      captchaId: body.captchaId || body.captcha_id || '',
      captchaCode: body.captchaCode || body.captcha_code || '',
      purpose: 'register',
      requireCaptcha: true,
      deliver: true
    });
  }
  if (method === 'POST' && path === '/api/password/send-reset-code') {
    return createPasswordResetVerification(body.email, {
      captchaId: body.captchaId || body.captcha_id || '',
      captchaCode: body.captchaCode || body.captcha_code || '',
      requireCaptcha: true,
      deliver: true
    });
  }
  if (method === 'POST' && path === '/api/password/reset') {
    return resetPasswordByEmail(body.email, body.emailCode || body.email_code || '', body.password || body.newPassword || body.new_password || '');
  }
  if (method === 'POST' && path === '/api/register') {
    return { status: 201, body: { user: await register(body) } };
  }
  if (method === 'POST' && path === '/api/login') return login(body.username, body.password);
  if (method === 'POST' && path === '/api/import/parse') return { questions: parseQuestions(body.text || '', body.rules || null) };
  if (method === 'POST' && path === '/api/import/ai') return importWithAi(token, body.text || '');
  if (method === 'POST' && path === '/api/papers') {
    const user = await requireUser(token);
    return { status: 201, body: await createPaper(user.id, body) };
  }
  if (method === 'POST' && path === '/api/sessions') {
    return { status: 201, body: await startSession(token, body.paperId, body.mode || 'practice') };
  }
  if (method === 'POST' && path.startsWith('/api/sessions/') && path.endsWith('/finish')) {
    return finishSession(token, path.split('/').at(-2) || '');
  }
  if (method === 'POST' && path === '/api/answer') {
    return submitAnswer(token, body.sessionId, body.questionId, body.answer, body.timeSpentMs || 0);
  }
  if (method === 'POST' && path === '/api/deepseek') return deepseekChat(token, body);
  if (method === 'POST' && path === '/api/payments/ai-package') return { status: 201, body: await createAiPaymentOrder(token, body) };
  if (method === 'POST' && path.startsWith('/api/payments/') && path.endsWith('/complete')) {
    return completePaymentOrder(token, path.split('/').at(-2) || '');
  }

  if (method === 'PATCH' && path.startsWith('/api/papers/')) return updatePaper(token, lastPart(path), body);
  if (method === 'PATCH' && path.startsWith('/api/questions/') && path.endsWith('/analysis')) {
    return updateQuestionAnalysis(token, path.split('/').at(-2) || '', body.analysis || '');
  }
  if (method === 'PATCH' && path.startsWith('/api/questions/') && path.endsWith('/favorite')) {
    return setQuestionFavorite(token, path.split('/').at(-2) || '', body.favorite !== false);
  }
  if (method === 'PATCH' && path.startsWith('/api/questions/')) return updateQuestion(token, lastPart(path), body);
  if (method === 'PATCH' && path.startsWith('/api/wrongbook/')) return updateWrongbook(token, lastPart(path), body);

  if (method === 'DELETE' && path.startsWith('/api/papers/')) return deletePaper(token, lastPart(path));
  if (method === 'DELETE' && path.startsWith('/api/questions/')) return deleteQuestion(token, lastPart(path));
  if (method === 'DELETE' && path.startsWith('/api/wrongbook/')) return deleteWrongbook(token, lastPart(path));

  throw new AppError('Not found', 404);
}

function normalizePath(path: string) {
  let value = path.replace(/\/+$/, '');
  const marker = '/.netlify/functions/api';
  if (value.includes(marker)) {
    value = '/api' + value.slice(value.indexOf(marker) + marker.length);
  }
  if (!value.startsWith('/api')) value = `/api${value.startsWith('/') ? value : `/${value}`}`;
  return value || '/api';
}

function lastPart(path: string) {
  return path.split('/').filter(Boolean).at(-1) || '';
}

function parseBody(raw: string | null | undefined) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('Invalid JSON body');
  }
}

function readToken(headers: Record<string, string>) {
  const value = headers.authorization || headers.Authorization || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function jsonResponse(status: number, body: unknown) {
  return {
    statusCode: status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: status === 204 ? '' : JSON.stringify(body)
  };
}

async function requireUser(token: string) {
  if (!token) throw new AppError('请先登录', 401);
  const tokenRow = await selectOne('auth_tokens', 'user_id', { token });
  if (!tokenRow) throw new AppError('登录已失效', 401);
  const user = await selectOne('users', '*', { id: tokenRow.user_id });
  if (!user) throw new AppError('登录已失效', 401);
  return publicUser(user);
}

async function register(payload: any) {
  const username = cleanText(payload.username);
  const password = String(payload.password || '');
  const nickname = cleanText(payload.nickname) || username;
  const email = normalizeEmail(payload.email);
  const emailCode = cleanText(payload.emailCode || payload.email_code);
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]{3,32}$/.test(username)) {
    throw new AppError('用户名需为 3-32 位中文、字母、数字、下划线或短横线');
  }
  if (password.length < 8) throw new AppError('密码至少 8 位');
  if (!isQqEmail(email)) throw new AppError('注册需要通过 QQ 邮箱验证');
  if (!emailCode) throw new AppError('请填写 QQ 邮箱验证码');
  await verifyEmailCode(email, emailCode, 'register');

  const salt = randomHex(16);
  const user = {
    id: newId('user'),
    username,
    email,
    email_verified_at: utcNow(),
    nickname,
    password_hash: hashPassword(password, salt),
    salt,
    created_at: utcNow()
  };
  const { error } = await db().from('users').insert(user);
  if (error) throw new AppError('用户名或 QQ 邮箱已存在', 409);
  await ensureAiAccount(user.id);
  await seedInitialQuestionBank(user.id);
  return publicUser(user);
}

async function login(username: string, password: string) {
  const user = await selectOne('users', '*', { username: cleanText(username) });
  if (!user || user.password_hash !== hashPassword(String(password || ''), user.salt)) {
    throw new AppError('用户名或密码错误', 401);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await checked(db().from('auth_tokens').insert({ token, user_id: user.id, created_at: utcNow() }));
  await ensureAiAccount(user.id);
  return { token, user: publicUser(user) };
}

async function createCaptcha(includeDevCode = false) {
  const code = Array.from({ length: 5 }, () => CAPTCHA_CHARS[crypto.randomInt(CAPTCHA_CHARS.length)]).join('');
  const salt = randomHex(8);
  const svg = renderCaptchaSvg(code);
  const captcha = {
    id: newId('captcha'),
    purpose: 'email',
    code_hash: hashPassword(code, salt),
    salt,
    expires_at: nowSeconds() + CAPTCHA_TTL_SECONDS,
    attempts: 0,
    created_at: utcNow()
  };
  await checked(db().from('captcha_challenges').insert(captcha));
  const result: any = {
    id: captcha.id,
    captcha_svg: svg,
    captcha_image: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    expires_in: CAPTCHA_TTL_SECONDS
  };
  if (includeDevCode) result.dev_code = code;
  return result;
}

async function createEmailVerification(emailValue: string, options: any = {}) {
  const email = normalizeEmail(emailValue);
  if (!isQqEmail(email)) throw new AppError('请使用 QQ 邮箱接收验证码');
  const purpose = cleanText(options.purpose) || 'register';
  const recent = await db()
    .from('email_verifications')
    .select('id')
    .eq('email', email)
    .eq('purpose', purpose)
    .is('used_at', null)
    .gt('expires_at', nowSeconds() + EMAIL_CODE_TTL_SECONDS - EMAIL_CODE_COOLDOWN_SECONDS)
    .order('created_at', { ascending: false })
    .limit(1);
  if (recent.error) throw recent.error;
  if (recent.data?.length) throw new AppError('验证码已发送，请 60 秒后再试', 429);
  if (options.requireCaptcha) await verifyCaptcha(options.captchaId, options.captchaCode);
  const code = String(crypto.randomInt(1000000)).padStart(6, '0');
  const salt = randomHex(8);
  await checked(db().from('email_verifications').insert({
    id: newId('mail'),
    email,
    purpose,
    code_hash: hashPassword(code, salt),
    salt,
    expires_at: nowSeconds() + EMAIL_CODE_TTL_SECONDS,
    created_at: utcNow()
  }));
  const delivered = options.deliver && await sendQqEmailCode(email, code, purpose);
  const result: any = {
    sent: delivered,
    email,
    expires_in: EMAIL_CODE_TTL_SECONDS,
    message: delivered ? '验证码已发送到 QQ 邮箱' : '本地开发模式：SMTP 未配置，已返回 dev_code'
  };
  if (!delivered) result.dev_code = code;
  return result;
}

async function createPasswordResetVerification(emailValue: string, options: any = {}) {
  const email = normalizeEmail(emailValue);
  if (!isQqEmail(email)) throw new AppError('请使用注册 QQ 邮箱接收验证码');
  const user = await selectOne('users', 'id', { email });
  if (!user) throw new AppError('这个 QQ 邮箱还没有注册账号', 404);
  return createEmailVerification(email, { ...options, purpose: 'reset_password' });
}

async function resetPasswordByEmail(emailValue: string, emailCode: string, newPassword: string) {
  const email = normalizeEmail(emailValue);
  if (!isQqEmail(email)) throw new AppError('请使用注册 QQ 邮箱重置密码');
  if (String(newPassword || '').length < 8) throw new AppError('新密码至少 8 位');
  const user = await selectOne('users', 'id', { email });
  if (!user) throw new AppError('这个 QQ 邮箱还没有注册账号', 404);
  await verifyEmailCode(email, emailCode, 'reset_password');
  const salt = randomHex(16);
  await checked(db().from('users').update({ password_hash: hashPassword(newPassword, salt), salt }).eq('id', user.id));
  await checked(db().from('auth_tokens').delete().eq('user_id', user.id));
  return { reset: true, email };
}

async function verifyCaptcha(captchaId: string, captchaCode: string) {
  const id = cleanText(captchaId);
  const code = cleanText(captchaCode).toUpperCase().replace(/\s+/g, '');
  if (!id || !code) throw new AppError('请先完成图形识别码');
  const row = await selectOne('captcha_challenges', '*', { id, purpose: 'email' });
  if (!row || row.used_at || Number(row.expires_at) < nowSeconds()) {
    throw new AppError('图形识别码不存在或已过期，请刷新后重试');
  }
  if (Number(row.attempts || 0) >= 5) throw new AppError('图形识别码尝试次数过多，请刷新后重试');
  if (row.code_hash !== hashPassword(code, row.salt)) {
    await checked(db().from('captcha_challenges').update({ attempts: Number(row.attempts || 0) + 1 }).eq('id', id));
    throw new AppError('图形识别码错误，请重新识别');
  }
  await checked(db().from('captcha_challenges').update({ used_at: utcNow() }).eq('id', id));
}

async function verifyEmailCode(email: string, code: string, purpose = 'register') {
  const { data, error } = await db()
    .from('email_verifications')
    .select('*')
    .eq('email', email)
    .eq('purpose', purpose)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row || Number(row.expires_at) < nowSeconds()) throw new AppError('邮箱验证码不存在或已过期');
  if (row.code_hash !== hashPassword(stripCodeSpaces(code), row.salt)) throw new AppError('邮箱验证码错误');
  await checked(db().from('email_verifications').update({ used_at: utcNow() }).eq('id', row.id));
}

async function listPapers(token: string) {
  const user = await requireUser(token);
  const { data, error } = await db().from('papers').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getPaper(token: string, paperId: string) {
  const user = await requireUser(token);
  const paper = await selectOne('papers', '*', { id: paperId, user_id: user.id });
  if (!paper) throw new AppError('试卷不存在', 404);
  const { data, error } = await db().from('questions').select('*').eq('paper_id', paperId).order('position', { ascending: true });
  if (error) throw error;
  return { ...paper, questions: (data || []).map(questionFromRow) };
}

async function createPaper(userId: string, payload: any) {
  const questions = normalizeQuestions(payload.questions || []);
  if (!questions.length) throw new AppError('试卷至少需要 1 道题');
  const paper = {
    id: cleanText(payload.id) || newId('paper'),
    user_id: userId,
    title: cleanText(payload.title) || '未命名试卷',
    category: cleanText(payload.category) || '综合',
    group_name: cleanText(payload.group_name || payload.groupName) || '默认分组',
    source: cleanText(payload.source) || 'manual',
    question_count: questions.length,
    created_at: utcNow()
  };
  await checked(db().from('papers').insert(paper));
  const rows = questions.map((question, index) => ({
    id: question.id,
    paper_id: paper.id,
    type: question.type,
    question: question.question,
    options_json: question.options,
    answer: question.answer,
    analysis: question.analysis || '',
    tags_json: question.tags || [],
    score: Number(question.score || 1),
    position: index
  }));
  const { error } = await db().from('questions').insert(rows);
  if (error) {
    await db().from('papers').delete().eq('id', paper.id);
    throw error;
  }
  return { id: paper.id, title: paper.title, category: paper.category, group_name: paper.group_name, question_count: questions.length, questions };
}

async function seedInitialQuestionBank(userId: string) {
  const text = readInitialQuestionBankText();
  if (!text) return;
  const questions = parseQuestions(text);
  if (!questions.length) return;
  await createPaper(userId, {
    title: INITIAL_BANK_TITLE,
    category: INITIAL_BANK_CATEGORY,
    group_name: INITIAL_BANK_GROUP,
    source: 'initial_seed',
    questions
  });
}

function readInitialQuestionBankText() {
  const candidates = [
    path.join(process.cwd(), 'data', 'initial_question_bank.txt'),
    path.join(__dirname, '..', '..', 'data', 'initial_question_bank.txt')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return '';
}

async function updatePaper(token: string, paperId: string, payload: any) {
  const user = await requireUser(token);
  const update: any = {};
  if ('title' in payload) update.title = cleanText(payload.title) || '未命名试卷';
  if ('category' in payload) update.category = cleanText(payload.category) || '综合';
  if ('group_name' in payload || 'groupName' in payload) update.group_name = cleanText(payload.group_name || payload.groupName) || '默认分组';
  if (!Object.keys(update).length) return { updated: false, paper_id: paperId };
  const result = await db().from('papers').update(update).eq('id', paperId).eq('user_id', user.id).select('id').maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new AppError('试卷不存在', 404);
  return { updated: true, paper: await getPaper(token, paperId) };
}

async function updateQuestion(token: string, questionId: string, payload: any) {
  const owned = await getOwnedQuestion(token, questionId);
  const current = questionFromRow(owned);
  let options = payload.options ?? current.options;
  if (typeof options === 'string') options = options.split(/\n+/);
  options = (options || []).map((item: string) => cleanText(item)).filter(Boolean);
  const update = {
    question: cleanText(payload.question ?? current.question),
    type: cleanText(payload.type ?? current.type) || inferType(options, normalizeAnswer(payload.answer ?? current.answer)),
    answer: normalizeAnswer(payload.answer ?? current.answer),
    analysis: cleanText(payload.analysis ?? current.analysis),
    options_json: options,
    tags_json: Array.isArray(payload.tags) ? payload.tags : current.tags,
    score: Number(payload.score ?? current.score ?? 1) || 1
  };
  if (!update.question) throw new AppError('题干不能为空');
  if (!update.answer) throw new AppError('答案不能为空');
  const { data, error } = await db().from('questions').update(update).eq('id', questionId).select('*').maybeSingle();
  if (error) throw error;
  return { updated: true, question: questionFromRow(data) };
}

async function deletePaper(token: string, paperId: string) {
  const user = await requireUser(token);
  const { data, error } = await db().from('papers').delete().eq('id', paperId).eq('user_id', user.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('试卷不存在', 404);
  return { deleted: true, id: paperId };
}

async function deleteQuestion(token: string, questionId: string) {
  const row = await getOwnedQuestion(token, questionId);
  await checked(db().from('questions').delete().eq('id', questionId));
  const count = await countRows('questions', { paper_id: row.paper_id });
  await checked(db().from('papers').update({ question_count: count }).eq('id', row.paper_id));
  return { deleted: true, id: questionId, paper_id: row.paper_id, question_count: count };
}

async function startSession(token: string, paperId: string, mode: string) {
  const user = await requireUser(token);
  await getPaper(token, paperId);
  const session = { id: newId('session'), user_id: user.id, paper_id: paperId, mode: mode || 'practice', started_at: utcNow() };
  await checked(db().from('sessions').insert(session));
  return { id: session.id, paper_id: paperId, mode: session.mode };
}

async function submitAnswer(token: string, sessionId: string, questionId: string, answer: string, timeSpentMs = 0) {
  const user = await requireUser(token);
  const session = await selectOne('sessions', '*', { id: sessionId, user_id: user.id });
  if (!session) throw new AppError('刷题会话不存在', 404);
  const row = await selectOne('questions', '*', { id: questionId });
  if (!row) throw new AppError('题目不存在', 404);
  const question = questionFromRow(row);
  const correct = normalizeAnswer(answer) === normalizeAnswer(question.answer);
  await checked(db().from('answers').insert({
    id: newId('answer'),
    session_id: sessionId,
    user_id: user.id,
    question_id: questionId,
    user_answer: String(answer),
    correct,
    time_spent_ms: Number(timeSpentMs || 0),
    created_at: utcNow()
  }));
  await upsertReview(user.id, questionId, correct, Number(timeSpentMs || 0));
  if (!correct) await upsertWrong(user.id, questionId, String(answer));
  return { correct, answer: question.answer, analysis: question.analysis || '', question };
}

async function finishSession(token: string, sessionId: string) {
  const user = await requireUser(token);
  const session = await selectOne('sessions', '*', { id: sessionId, user_id: user.id });
  if (!session) throw new AppError('刷题会话不存在', 404);
  const total = await countRows('questions', { paper_id: session.paper_id });
  const answers = await selectRows('answers', '*', { session_id: sessionId, user_id: user.id });
  const answered = new Set(answers.map((item: any) => item.question_id)).size;
  const correct = new Set(answers.filter((item: any) => item.correct).map((item: any) => item.question_id)).size;
  const finishedAt = utcNow();
  await checked(db().from('sessions').update({ finished_at: finishedAt }).eq('id', sessionId).eq('user_id', user.id));
  return { id: sessionId, total, answered, unanswered: Math.max(total - answered, 0), correct, accuracy: answered ? Math.round(correct / answered * 100) : 0, finished_at: finishedAt };
}

async function listWrongbook(token: string) {
  const user = await requireUser(token);
  const rows = await selectRows('wrongbook', '*', { user_id: user.id }, { order: ['updated_at', false] });
  const questions = await questionsByIds(rows.map((row: any) => row.question_id));
  return rows.map((row: any) => wrongFromRow(row, questions.get(row.question_id))).filter(Boolean);
}

async function updateWrongbook(token: string, wrongId: string, payload: any) {
  const user = await requireUser(token);
  const update: any = {};
  if ('reason' in payload) update.reason = cleanText(payload.reason);
  if ('note' in payload) update.note = cleanText(payload.note);
  if ('mastered' in payload) update.mastered = Boolean(payload.mastered);
  if (!Object.keys(update).length) return { updated: false };
  update.updated_at = utcNow();
  await checked(db().from('wrongbook').update(update).eq('id', wrongId).eq('user_id', user.id));
  return { updated: true };
}

async function deleteWrongbook(token: string, wrongId: string) {
  const user = await requireUser(token);
  const { data, error } = await db().from('wrongbook').delete().eq('id', wrongId).eq('user_id', user.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('错题记录不存在', 404);
  return { deleted: true, id: wrongId };
}

async function updateQuestionAnalysis(token: string, questionId: string, analysisValue: string) {
  await getOwnedQuestion(token, questionId);
  const analysis = cleanText(analysisValue);
  if (analysis.length > 5000) throw new AppError('解析最多 5000 字');
  await checked(db().from('questions').update({ analysis }).eq('id', questionId));
  return { updated: true, question_id: questionId, analysis };
}

async function setQuestionFavorite(token: string, questionId: string, favorite = true) {
  const user = await requireUser(token);
  await getOwnedQuestion(token, questionId);
  if (favorite) {
    await checked(db().from('favorites').upsert({ user_id: user.id, question_id: questionId, created_at: utcNow() }));
  } else {
    await checked(db().from('favorites').delete().eq('user_id', user.id).eq('question_id', questionId));
  }
  return { updated: true, question_id: questionId, favorite: Boolean(favorite) };
}

async function listFavorites(token: string) {
  const user = await requireUser(token);
  const rows = await selectRows('favorites', '*', { user_id: user.id }, { order: ['created_at', false] });
  const questions = await questionsByIds(rows.map((row: any) => row.question_id));
  const paperIds = Array.from(new Set(Array.from(questions.values()).map((question: any) => question.paper_id))) as string[];
  const papers = new Map<string, any>((await rowsByIds('papers', paperIds)).map((paper: any) => [paper.id, paper]));
  return rows.map((row: any) => favoriteFromRow(row, questions.get(row.question_id), papers)).filter(Boolean);
}

async function listDueReviews(token: string, includeFuture = false) {
  const user = await requireUser(token);
  const cutoff = includeFuture ? 9999999999999 : Date.now();
  const { data, error } = await db()
    .from('review_schedule')
    .select('*')
    .eq('user_id', user.id)
    .lte('next_review_at', cutoff)
    .order('next_review_at', { ascending: true });
  if (error) throw error;
  const questions = await questionsByIds((data || []).map((row: any) => row.question_id));
  return (data || []).map((row: any) => reviewFromRow(row, questions.get(row.question_id))).filter(Boolean);
}

async function stats(token: string) {
  const user = await requireUser(token);
  const papers = await selectRows('papers', '*', { user_id: user.id });
  const questions = papers.length ? await selectRowsIn('questions', '*', 'paper_id', papers.map((paper: any) => paper.id)) : [];
  const answers = await selectRows('answers', '*', { user_id: user.id });
  const wrongs = await selectRows('wrongbook', '*', { user_id: user.id });
  const favorites = await selectRows('favorites', '*', { user_id: user.id });
  const reviews = await selectRows('review_schedule', '*', { user_id: user.id });
  const correctCount = answers.filter((item: any) => item.correct).length;
  const accuracy = answers.length ? Math.round(correctCount / answers.length * 100) : 0;
  const recent = answers.slice(-30);
  const recentAccuracy = recent.length ? Math.round(recent.filter((item: any) => item.correct).length / recent.length * 100) : 0;
  const avgTimeMs = answers.length ? Math.round(answers.reduce((sum: number, item: any) => sum + Number(item.time_spent_ms || 0), 0) / answers.length) : 0;
  const due = reviews.filter((item: any) => Number(item.next_review_at) <= Date.now()).length;
  const groupStats = buildGroupStats(papers, questions, answers);
  const weakestGroups = groupStats.filter((item: any) => item.answers).sort((a: any, b: any) => a.accuracy - b.accuracy || b.answers - a.answers).slice(0, 5);
  const wrongReasonStats = buildReasonStats(wrongs);
  const slowQuestions = buildSlowQuestions(questions, answers, papers);
  const summary = {
    papers: papers.length,
    questions: questions.length,
    answers: answers.length,
    accuracy,
    recent_accuracy: recentAccuracy,
    avg_time_ms: avgTimeMs,
    wrong: wrongs.filter((item: any) => !item.mastered).length,
    due,
    favorites: favorites.length,
    recent_answers: recent,
    group_stats: groupStats,
    weakest_groups: weakestGroups,
    type_stats: buildTypeStats(questions, answers),
    wrong_reason_stats: wrongReasonStats,
    mastery_stats: buildMasteryStats(reviews),
    slow_questions: slowQuestions
  };
  return { ...summary, recommendations: buildLearningRecommendations(summary) };
}

async function getAiAccount(token: string) {
  const user = await requireUser(token);
  await ensureAiAccount(user.id);
  const row = await selectOne('ai_accounts', '*', { user_id: user.id });
  return aiAccountFromRow(row);
}

async function ensureAiAccount(userId: string) {
  await checked(db().from('ai_accounts').upsert({
    user_id: userId,
    free_credits: FREE_AI_CREDITS,
    paid_credits: 0,
    total_used: 0,
    updated_at: utcNow()
  }, { onConflict: 'user_id', ignoreDuplicates: true }));
  const account = await selectOne('ai_accounts', '*', { user_id: userId });
  const targetFreeCredits = Math.max(0, FREE_AI_CREDITS - Number(account?.total_used || 0));
  if (account && Number(account.free_credits || 0) < targetFreeCredits) {
    await checked(db().from('ai_accounts').update({ free_credits: targetFreeCredits, updated_at: utcNow() }).eq('user_id', userId));
  }
}

async function ensureAiCredit(token: string, amount = 1) {
  const account = await getAiAccount(token);
  if (account.remaining < amount) throw new AppError('AI 次数不足，当前充值功能暂未开放，请稍后再试', 402);
  return account;
}

async function consumeAiCredit(token: string, amount = 1) {
  const user = await requireUser(token);
  await ensureAiAccount(user.id);
  const row = await selectOne('ai_accounts', '*', { user_id: user.id });
  let free = Number(row.free_credits);
  let paid = Number(row.paid_credits);
  let remaining = amount;
  const fromFree = Math.min(free, remaining);
  free -= fromFree;
  remaining -= fromFree;
  paid -= remaining;
  if (paid < 0) throw new AppError('AI 次数不足，当前充值功能暂未开放，请稍后再试', 402);
  await checked(db().from('ai_accounts').update({
    free_credits: free,
    paid_credits: paid,
    total_used: Number(row.total_used || 0) + amount,
    updated_at: utcNow()
  }).eq('user_id', user.id));
  return getAiAccount(token);
}

async function createAiPaymentOrder(token: string, payload: any) {
  throw new AppError('AI 充值功能暂未开放，当前每个用户免费体验 20 次', 503);
  const user = await requireUser(token);
  const amountCents = parseAmountCents(payload.amount_yuan ?? payload.amount ?? 1);
  const credits = Math.max(1, Math.round((amountCents / 100) * AI_CREDITS_PER_YUAN));
  const id = newId('pay');
  const row = {
    id,
    user_id: user.id,
    provider: cleanText(payload.provider) || 'alipay',
    amount_cents: amountCents,
    credits,
    status: 'pending',
    payment_url: `alipay://platformapi/startapp?appId=20000067&amount=${(amountCents / 100).toFixed(2)}&order=${id}`,
    metadata_json: { note: '题练云 AI 次数充值模拟订单' },
    created_at: utcNow()
  };
  await checked(db().from('payment_orders').insert(row));
  return paymentOrderFromRow(row);
}

async function completePaymentOrder(token: string, orderId: string) {
  throw new AppError('AI 充值功能暂未开放，当前每个用户免费体验 20 次', 503);
  const user = await requireUser(token);
  const order = await selectOne('payment_orders', '*', { id: orderId, user_id: user.id });
  if (!order) throw new AppError('支付订单不存在', 404);
  if (order.status !== 'paid') {
    await ensureAiAccount(user.id);
    await checked(db().from('payment_orders').update({ status: 'paid', paid_at: utcNow() }).eq('id', orderId));
    const account = await selectOne('ai_accounts', '*', { user_id: user.id });
    await checked(db().from('ai_accounts').update({
      paid_credits: Number(account.paid_credits || 0) + Number(order.credits || 0),
      updated_at: utcNow()
    }).eq('user_id', user.id));
  }
  const refreshed = await selectOne('payment_orders', '*', { id: orderId });
  return paymentOrderFromRow(refreshed);
}

async function listPaymentOrders(token: string) {
  const user = await requireUser(token);
  const rows = await selectRows('payment_orders', '*', { user_id: user.id }, { order: ['created_at', false] });
  return rows.map(paymentOrderFromRow);
}

async function importWithAi(token: string, text: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey) await ensureAiCredit(token);
  const result = await aiParseQuestions(text, apiKey);
  if (apiKey && result.mode === 'ai') {
    return { ...result, ai_account: await consumeAiCredit(token) };
  }
  return result;
}

async function deepseekChat(token: string, body: any) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AppError('DeepSeek API is not configured', 503);
  }
  if (!Array.isArray(body.messages) || !body.messages.length) throw new AppError('messages must be a non-empty list');
  await ensureAiCredit(token);
  const content = await callDeepseek(apiKey, body.messages, body.model || 'deepseek-chat', body.temperature ?? 0.35, Math.min(Number(body.max_tokens || 1200), 2000));
  return { content, ai_account: await consumeAiCredit(token) };
}

async function aiParseQuestions(text: string, apiKey?: string) {
  if (!apiKey) return { mode: 'fallback', questions: parseQuestions(text) };
  const prompt = `请把下面的试题文本解析成 JSON 数组。每题字段必须包含 question, options, answer, analysis, type。无法判断解析时 analysis 用空字符串，type 为 single/multi/judge/blank。只返回 JSON。\n\n${text}`;
  try {
    const content = await callDeepseek(apiKey, [
      { role: 'system', content: '你是严谨的试题结构化解析器，只输出 JSON。' },
      { role: 'user', content: prompt }
    ]);
    const questions = tryParseJson(extractJson(content));
    if (questions.length) return { mode: 'ai', questions };
  } catch {
    // AI 识别失败时沿用规则兜底，保证导入不中断。
  }
  return { mode: 'fallback', questions: parseQuestions(text) };
}

function parseQuestions(textValue: string, rules: any = null) {
  const text = String(textValue || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return [];
  const fromJson = tryParseJson(text);
  if (fromJson.length) return fromJson;
  const questionStart = rules?.questionStart || String.raw`(?m)^\s*\d+[\.\、]\s*`;
  const startRe = new RegExp(questionStart.replace('(?m)', ''), 'gm');
  const optionRe = new RegExp(rules?.option || String.raw`^([A-Ha-h])[\.\、\)]\s*(.+)$`, 'gim');
  const answerRe = new RegExp(rules?.answer || String.raw`(?:参考)?答案[:：]\s*([A-Ha-h]+|正确|错误|对|错)`, 'i');
  const analysisRe = new RegExp(rules?.analysis || String.raw`解析[:：]\s*(.*)`, 'is');
  const starts = Array.from(text.matchAll(startRe));
  const blocks = starts.length
    ? starts.map((match, index) => text.slice(match.index || 0, starts[index + 1]?.index ?? text.length).trim()).filter(Boolean)
    : [text];
  return blocks.map((block) => parseBlock(block, startRe, optionRe, answerRe, analysisRe)).filter(Boolean);
}

function parseBlock(block: string, questionStart: RegExp, optionRe: RegExp, answerRe: RegExp, analysisRe: RegExp) {
  let cleanBlock = block.replace(questionStart, '').trim();
  cleanBlock = cleanBlock.replace(/^(题目|问题)[:：]?[ \t]+(.+)$/s, '$2').trim();
  const answerMatch = cleanBlock.match(answerRe);
  if (!answerMatch) return null;
  const analysisMatch = cleanBlock.match(analysisRe);
  const answer = normalizeAnswer(answerMatch[1]);
  const analysis = cleanText(analysisMatch?.[1] || '');
  optionRe.lastIndex = 0;
  const options = Array.from(cleanBlock.matchAll(optionRe)).map((match) => cleanText(match[2]));
  const question = cleanText(cleanBlock.replace(answerRe, '').replace(analysisRe, '').replace(optionRe, ''));
  if (!question) return null;
  return { id: newId('q'), question, options, answer, analysis, type: inferType(options, answer), tags: [], score: 1 };
}

async function upsertWrong(userId: string, questionId: string, userAnswer: string) {
  const existing = await selectOne('wrongbook', '*', { user_id: userId, question_id: questionId });
  if (existing) {
    await checked(db().from('wrongbook').update({
      user_answer: userAnswer,
      wrong_count: Number(existing.wrong_count || 0) + 1,
      mastered: false,
      updated_at: utcNow()
    }).eq('user_id', userId).eq('question_id', questionId));
  } else {
    await checked(db().from('wrongbook').insert({ id: newId('wrong'), user_id: userId, question_id: questionId, user_answer: userAnswer, updated_at: utcNow() }));
  }
}

async function upsertReview(userId: string, questionId: string, correct: boolean, timeSpentMs: number) {
  const existing = await selectOne('review_schedule', '*', { user_id: userId, question_id: questionId });
  let level = Number(existing?.level || 0);
  let correctCount = Number(existing?.correct_count || 0);
  let wrongCount = Number(existing?.wrong_count || 0);
  if (correct) {
    correctCount += 1;
    level = Math.min(7, level + (timeSpentMs && timeSpentMs < 8000 ? 2 : 1));
  } else {
    wrongCount += 1;
    level = Math.max(0, level - 1);
  }
  const intervals = [5, 30, 720, 1440, 2880, 5760, 10080, 21600];
  await checked(db().from('review_schedule').upsert({
    user_id: userId,
    question_id: questionId,
    level,
    next_review_at: Date.now() + intervals[level] * 60 * 1000,
    correct_count: correctCount,
    wrong_count: wrongCount,
    updated_at: utcNow()
  }, { onConflict: 'user_id,question_id' }));
}

async function getOwnedQuestion(token: string, questionId: string) {
  const user = await requireUser(token);
  const question = await selectOne('questions', '*', { id: questionId });
  if (!question) throw new AppError('题目不存在', 404);
  const paper = await selectOne('papers', 'id,user_id', { id: question.paper_id, user_id: user.id });
  if (!paper) throw new AppError('题目不存在', 404);
  return question;
}

async function selectOne(table: string, columns: string, eq: Record<string, any>) {
  let query: any = db().from(table).select(columns);
  Object.entries(eq).forEach(([key, value]) => { query = query.eq(key, value); });
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function selectRows(table: string, columns: string, eq: Record<string, any>, options: any = {}) {
  let query: any = db().from(table).select(columns);
  Object.entries(eq).forEach(([key, value]) => { query = query.eq(key, value); });
  if (options.order) query = query.order(options.order[0], { ascending: options.order[1] });
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function selectRowsIn(table: string, columns: string, column: string, values: string[]) {
  if (!values.length) return [];
  const { data, error } = await db().from(table).select(columns).in(column, values);
  if (error) throw error;
  return data || [];
}

async function rowsByIds(table: string, ids: string[]) {
  return selectRowsIn(table, '*', 'id', ids);
}

async function countRows(table: string, eq: Record<string, any>) {
  let query: any = db().from(table).select('*', { count: 'exact', head: true });
  Object.entries(eq).forEach(([key, value]) => { query = query.eq(key, value); });
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function checked(promise: PromiseLike<any>) {
  const result = await promise;
  if (result.error) throw result.error;
  return result.data;
}

async function questionsByIds(ids: string[]) {
  const rows = await rowsByIds('questions', Array.from(new Set(ids.filter(Boolean))));
  return new Map(rows.map((row: any) => [row.id, row]));
}

function normalizeQuestions(items: any[]) {
  return (items || []).map((item) => {
    const question = cleanText(item.question || item.title || item.content);
    const answer = normalizeAnswer(item.answer || item.correctAnswer);
    if (!question || !answer) return null;
    const options = (item.options || item.choices || []).map((option: string) => cleanText(option)).filter(Boolean);
    return {
      id: String(item.id || newId('q')),
      question,
      options,
      answer,
      analysis: cleanText(item.analysis || item.explanation || ''),
      type: item.type || inferType(options, answer),
      tags: item.tags || [],
      score: item.score || 1
    };
  }).filter(Boolean);
}

function questionFromRow(row: any) {
  return {
    id: row.id,
    type: row.type,
    question: row.question,
    options: Array.isArray(row.options_json) ? row.options_json : [],
    answer: row.answer,
    analysis: row.analysis || '',
    tags: Array.isArray(row.tags_json) ? row.tags_json : [],
    score: row.score ?? 1
  };
}

function wrongFromRow(row: any, question: any) {
  if (!question) return null;
  return {
    id: row.id,
    question_id: row.question_id,
    question: question.question,
    options: question.options_json || [],
    answer: question.answer,
    analysis: question.analysis || '',
    type: question.type,
    user_answer: row.user_answer,
    reason: row.reason,
    note: row.note,
    mastered: Boolean(row.mastered),
    wrong_count: row.wrong_count,
    updated_at: row.updated_at
  };
}

function reviewFromRow(row: any, question: any) {
  if (!question) return null;
  return {
    question_id: row.question_id,
    question: question.question,
    options: question.options_json || [],
    answer: question.answer,
    analysis: question.analysis || '',
    type: question.type,
    level: row.level,
    next_review_at: row.next_review_at,
    correct_count: row.correct_count,
    wrong_count: row.wrong_count
  };
}

function favoriteFromRow(row: any, question: any, papers: Map<string, any>) {
  if (!question) return null;
  return {
    question_id: question.id,
    question: question.question,
    options: question.options_json || [],
    answer: question.answer,
    analysis: question.analysis || '',
    type: question.type,
    paper_title: papers.get(question.paper_id)?.title || '',
    created_at: row.created_at
  };
}

function publicUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    created_at: row.created_at,
    email: row.email || '',
    email_verified: Boolean(row.email_verified_at)
  };
}

function aiAccountFromRow(row: any) {
  const free = Number(row.free_credits || 0);
  const paid = Number(row.paid_credits || 0);
  return { free_credits: free, paid_credits: paid, remaining: free + paid, total_used: Number(row.total_used || 0), rate: AI_CREDITS_PER_YUAN, updated_at: row.updated_at };
}

function paymentOrderFromRow(row: any) {
  return {
    id: row.id,
    provider: row.provider,
    amount_yuan: Number((Number(row.amount_cents || 0) / 100).toFixed(2)),
    credits: Number(row.credits || 0),
    status: row.status,
    payment_url: row.payment_url,
    created_at: row.created_at,
    paid_at: row.paid_at
  };
}

function buildGroupStats(papers: any[], questions: any[], answers: any[]) {
  return papers.map((paper) => {
    const paperQuestions = questions.filter((question) => question.paper_id === paper.id);
    const ids = new Set(paperQuestions.map((question) => question.id));
    const paperAnswers = answers.filter((answer) => ids.has(answer.question_id));
    const correct = paperAnswers.filter((answer) => answer.correct).length;
    return {
      group_name: paper.group_name,
      category: paper.category,
      questions: paperQuestions.length,
      answers: paperAnswers.length,
      accuracy: paperAnswers.length ? Math.round(correct / paperAnswers.length * 100) : 0,
      avg_time_ms: paperAnswers.length ? Math.round(paperAnswers.reduce((sum, item) => sum + Number(item.time_spent_ms || 0), 0) / paperAnswers.length) : 0
    };
  });
}

function buildTypeStats(questions: any[], answers: any[]) {
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const grouped = new Map<string, any[]>();
  answers.forEach((answer) => {
    const type = questionMap.get(answer.question_id)?.type || 'single';
    grouped.set(type, [...(grouped.get(type) || []), answer]);
  });
  return Array.from(grouped.entries()).map(([type, list]) => ({
    type,
    answers: list.length,
    accuracy: list.length ? Math.round(list.filter((item) => item.correct).length / list.length * 100) : 0,
    avg_time_ms: list.length ? Math.round(list.reduce((sum, item) => sum + Number(item.time_spent_ms || 0), 0) / list.length) : 0
  }));
}

function buildReasonStats(wrongs: any[]) {
  const grouped = new Map<string, any>();
  wrongs.filter((item) => !item.mastered).forEach((item) => {
    const current = grouped.get(item.reason) || { reason: item.reason, count: 0, total_wrong: 0 };
    current.count += 1;
    current.total_wrong += Number(item.wrong_count || 0);
    grouped.set(item.reason, current);
  });
  return Array.from(grouped.values()).sort((a, b) => b.count - a.count || b.total_wrong - a.total_wrong).slice(0, 8);
}

function buildMasteryStats(reviews: any[]) {
  const grouped = new Map<number, number>();
  reviews.forEach((item) => grouped.set(Number(item.level || 0), (grouped.get(Number(item.level || 0)) || 0) + 1));
  return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level, count }));
}

function buildSlowQuestions(questions: any[], answers: any[], papers: any[]) {
  const paperMap = new Map(papers.map((paper) => [paper.id, paper]));
  return questions.map((question) => {
    const list = answers.filter((answer) => answer.question_id === question.id);
    const correct = list.filter((item) => item.correct).length;
    return {
      id: question.id,
      question: question.question,
      group_name: paperMap.get(question.paper_id)?.group_name || '',
      answers: list.length,
      accuracy: list.length ? Math.round(correct / list.length * 100) : 0,
      avg_time_ms: list.length ? Math.round(list.reduce((sum, item) => sum + Number(item.time_spent_ms || 0), 0) / list.length) : 0
    };
  }).filter((item) => item.answers).sort((a, b) => b.avg_time_ms - a.avg_time_ms).slice(0, 5);
}

function buildLearningRecommendations(statsValue: any) {
  const recommendations = [];
  if (!statsValue.answers) return ['先完成一套 10-20 题的小测，系统会根据答题结果生成薄弱项。'];
  if (statsValue.due) recommendations.push(`今天优先复习 ${statsValue.due} 道到期题，先稳住记忆曲线。`);
  if ((statsValue.recent_accuracy || 0) < 70) recommendations.push(`最近 30 题正确率 ${statsValue.recent_accuracy}%，建议切到练习模式逐题看解析。`);
  if (statsValue.weakest_groups?.length) {
    const item = statsValue.weakest_groups[0];
    recommendations.push(`薄弱分组是「${item.group_name}」，正确率 ${item.accuracy}%，建议先组一套专项卷。`);
  }
  if (statsValue.wrong_reason_stats?.length) recommendations.push(`主要错因是「${statsValue.wrong_reason_stats[0].reason}」，复盘时先写自己的记忆解析。`);
  if ((statsValue.avg_time_ms || 0) > 3000 || statsValue.slow_questions?.length) recommendations.push('存在耗时偏高题目，建议用键盘刷题做二轮限时训练。');
  return recommendations.length ? recommendations.slice(0, 5) : ['整体状态稳定，今天可以用收藏题和错题混合生成一套巩固卷。'];
}

async function sendQqEmailCode(email: string, code: string, purpose = 'register') {
  const user = process.env.QQ_SMTP_USER;
  const pass = process.env.QQ_SMTP_AUTH_CODE;
  if (!user || !pass) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.QQ_SMTP_HOST || 'smtp.qq.com',
    port: Number(process.env.QQ_SMTP_PORT || 465),
    secure: true,
    auth: { user, pass }
  });
  try {
    await transporter.sendMail({
      from: process.env.QQ_SMTP_FROM || user,
      to: email,
      subject: '题练云 v5 注册验证码',
      text: `你的题练云 v5 注册验证码是：${code}\n\n10 分钟内有效，如非本人操作请忽略。`
    });
    return true;
  } catch (error: any) {
    throw new AppError(`QQ 邮箱验证码发送失败：${error.message || error}`, 502);
  }
}

async function callDeepseek(apiKey: string, messages: any[], model = 'deepseek-chat', temperature = 0.35, maxTokens = 1600) {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(`DeepSeek 调用失败：${JSON.stringify(data)}`, response.status);
  return data?.choices?.[0]?.message?.content || '';
}

function tryParseJson(text: string) {
  try {
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : data.questions;
    return Array.isArray(items) ? normalizeQuestions(items) : [];
  } catch {
    return [];
  }
}

function extractJson(content: string) {
  const text = String(content || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const array = text.match(/(\[[\s\S]*\])/);
  return array ? array[1] : text;
}

function renderCaptchaSvg(code: string) {
  const lines = Array.from({ length: 7 }, (_, index) => {
    const color = ['#2563eb', '#0f766e', '#f97316', '#64748b'][index % 4];
    return `<line x1="${crypto.randomInt(180)}" y1="${crypto.randomInt(64)}" x2="${crypto.randomInt(180)}" y2="${crypto.randomInt(64)}" stroke="${color}" stroke-width="1.5" opacity="0.28"/>`;
  }).join('');
  const dots = Array.from({ length: 24 }, () => `<circle cx="${crypto.randomInt(180)}" cy="${crypto.randomInt(64)}" r="${1 + crypto.randomInt(2)}" fill="#0f172a" opacity="0.12"/>`).join('');
  const letters = Array.from(code).map((char, index) => {
    const x = 28 + index * 34 + crypto.randomInt(8);
    const y = 42 + crypto.randomInt(10);
    const rotate = crypto.randomInt(23) - 11;
    return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" font-family="Verdana, sans-serif" font-size="30" font-weight="900" fill="#0f172a">${char}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="64" viewBox="0 0 180 64" role="img" aria-label="图形识别码"><rect width="180" height="64" rx="16" fill="#eff6ff"/><rect x="1" y="1" width="178" height="62" rx="15" fill="none" stroke="#bfdbfe"/>${lines}${dots}${letters}</svg>`;
}

function inferType(options: string[], answer: string) {
  if (!options.length) return 'blank';
  const joined = options.join('');
  if (options.length === 2 && /正确|错误|对|错/.test(joined)) return 'judge';
  if (answer.length > 1 && /^[A-H]+$/.test(answer)) return 'multi';
  return 'single';
}

function normalizeAnswer(answer: unknown) {
  return cleanText(answer).replace(/\s+/g, '').toUpperCase();
}

function cleanText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function stripCodeSpaces(value: unknown) {
  return String(value || '').replace(/\s+/g, '');
}

function normalizeEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function isQqEmail(value: string) {
  return /^[A-Za-z0-9._%+\-]{3,64}@qq\.com$/.test(normalizeEmail(value));
}

function newId(prefix: string) {
  return `${prefix}_${randomHex(8)}`;
}

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString('hex');
}

function utcNow() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function hashPassword(password: string, salt: string) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function parseAmountCents(value: any) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new AppError('充值金额格式不正确');
  const cents = Math.round(amount * 100);
  if (cents <= 0) throw new AppError('充值金额必须大于 0');
  return cents;
}
