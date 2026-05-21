const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`missing ${relativePath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function mustInclude(source, text, label) {
  if (!source.includes(text)) {
    throw new Error(`${label} missing ${text}`);
  }
}

const packageJson = JSON.parse(read('package.json'));
const netlifyToml = read('netlify.toml');
const apiFunction = read(path.join('netlify', 'functions', 'api.ts'));
const schema = read(path.join('supabase', 'schema.sql'));
const deployDoc = read(path.join('docs', 'netlify-supabase-deploy.md'));
const migrateScript = read(path.join('scripts', 'migrate_sqlite_to_supabase.py'));
const envExample = read('.env.example');
const initialBank = read(path.join('data', 'initial_question_bank.txt'));
const secretPattern = /sk-[A-Za-z0-9]{20,}|QQ_SMTP_AUTH_CODE\s*=\s*[a-z0-9]{12,}/i;

['build', 'test', 'test:frontend', 'migrate:supabase', 'migrate:supabase:dry'].forEach((scriptName) => {
  if (!packageJson.scripts?.[scriptName]) {
    throw new Error(`package.json missing ${scriptName} script`);
  }
});

['@supabase/supabase-js', 'nodemailer'].forEach((dependency) => {
  if (!packageJson.dependencies?.[dependency] && !packageJson.devDependencies?.[dependency]) {
    throw new Error(`package.json missing ${dependency}`);
  }
});

[
  'from = "/api/*"',
  'to = "/.netlify/functions/api/:splat"',
  'publish = "."',
  'functions = "netlify/functions"',
  'included_files = ["data/initial_question_bank.txt"]'
].forEach((text) => mustInclude(netlifyToml, text, 'netlify.toml'));

[
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'QQ_SMTP_USER',
  'QQ_SMTP_AUTH_CODE',
  'DEEPSEEK_API_KEY',
  "const CAPTCHA_CHARS = '0123456789'",
  'EMAIL_CODE_COOLDOWN_SECONDS',
  'length: 5',
  'createClient',
  'requireUser',
  'routeRequest',
  'parseQuestions',
  'seedInitialQuestionBank',
  'initial_question_bank.txt',
  '计算机网络基础初始题库',
  '/api/register',
  '/api/login',
  '/api/password/send-reset-code',
  '/api/password/reset',
  '/api/captcha',
  '/api/email/send-code',
  '/api/papers',
  '/api/wrongbook',
  '/api/favorites',
  '/api/deepseek',
  '/api/payments/ai-package'
].forEach((text) => mustInclude(apiFunction, text, 'netlify function'));

[
  'create table if not exists public.users',
  'create table if not exists public.auth_tokens',
  'create table if not exists public.papers',
  'create table if not exists public.questions',
  'create table if not exists public.sessions',
  'create table if not exists public.answers',
  'create table if not exists public.wrongbook',
  'create table if not exists public.review_schedule',
  'create table if not exists public.favorites',
  'create table if not exists public.captcha_challenges',
  'create table if not exists public.email_verifications',
  'create table if not exists public.ai_accounts',
  'create table if not exists public.payment_orders',
  'on delete cascade',
  'idx_questions_paper',
  'idx_users_email'
].forEach((text) => mustInclude(schema, text, 'supabase schema'));

if (secretPattern.test(apiFunction + schema + netlifyToml)) {
  throw new Error('deployment files must not contain secrets or private mailbox values');
}

[
  'DEEPSEEK_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'QQ_SMTP_USER',
  'QQ_SMTP_AUTH_CODE',
  '不要把 DeepSeek、Supabase、QQ 邮箱授权码写进代码'
].forEach((text) => mustInclude(deployDoc, text, 'deploy docs'));

if (secretPattern.test(deployDoc)) {
  throw new Error('deploy docs must not contain real secrets or private mailbox values');
}

[
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TABLE_PLAN',
  'captcha_challenges',
  'on_conflict',
  'resolution=merge-duplicates',
  '--dry-run'
].forEach((text) => mustInclude(migrateScript, text, 'migration script'));

if (secretPattern.test(migrateScript)) {
  throw new Error('migration script must not contain real secrets or private mailbox values');
}

[
  'SUPABASE_URL=',
  'SUPABASE_SERVICE_ROLE_KEY=',
  'DEEPSEEK_API_KEY=',
  'QQ_SMTP_USER=',
  'QQ_SMTP_AUTH_CODE='
].forEach((text) => mustInclude(envExample, text, '.env.example'));

if (secretPattern.test(envExample)) {
  throw new Error('.env.example must not contain real secrets or private mailbox values');
}

if ((initialBank.match(/参考答案/g) || []).length !== 60) {
  throw new Error('initial question bank must contain 60 reference answers');
}

console.log('netlify supabase smoke checks passed');
