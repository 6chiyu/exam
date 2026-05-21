-- Exam v5 Supabase schema.
-- Run this once in Supabase SQL Editor before deploying Netlify Functions.

create table if not exists public.users (
  id text primary key,
  username text not null unique,
  email text,
  email_verified_at timestamptz,
  nickname text not null,
  password_hash text not null,
  salt text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.auth_tokens (
  token text primary key,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.papers (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  title text not null,
  category text not null,
  group_name text not null default 'default',
  source text not null default 'manual',
  question_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id text primary key,
  paper_id text not null references public.papers(id) on delete cascade,
  type text not null,
  question text not null,
  options_json jsonb not null,
  answer text not null,
  analysis text not null default '',
  tags_json jsonb not null,
  score numeric not null default 1,
  position integer not null default 0
);

create table if not exists public.sessions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  paper_id text not null references public.papers(id) on delete cascade,
  mode text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.answers (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  user_answer text not null,
  correct boolean not null,
  time_spent_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wrongbook (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  user_answer text not null,
  reason text not null default 'unclassified',
  note text not null default '',
  mastered boolean not null default false,
  wrong_count integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(user_id, question_id)
);

create table if not exists public.review_schedule (
  user_id text not null references public.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  level integer not null default 0,
  next_review_at bigint not null,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(user_id, question_id)
);

create table if not exists public.favorites (
  user_id text not null references public.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, question_id)
);

create table if not exists public.captcha_challenges (
  id text primary key,
  purpose text not null,
  code_hash text not null,
  salt text not null,
  expires_at bigint not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.email_verifications (
  id text primary key,
  email text not null,
  purpose text not null,
  code_hash text not null,
  salt text not null,
  expires_at bigint not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_accounts (
  user_id text primary key references public.users(id) on delete cascade,
  free_credits integer not null default 5,
  paid_credits integer not null default 0,
  total_used integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_orders (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  provider text not null,
  amount_cents integer not null,
  credits integer not null,
  status text not null,
  payment_url text not null default '',
  metadata_json jsonb not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create unique index if not exists idx_users_email on public.users(email) where email is not null and email <> '';
create index if not exists idx_auth_tokens_user on public.auth_tokens(user_id);
create index if not exists idx_questions_paper on public.questions(paper_id, position);
create index if not exists idx_answers_user on public.answers(user_id);
create index if not exists idx_wrongbook_user on public.wrongbook(user_id);
create index if not exists idx_review_due on public.review_schedule(user_id, next_review_at);
create index if not exists idx_favorites_user on public.favorites(user_id, created_at);
create index if not exists idx_captcha_challenges on public.captcha_challenges(purpose, expires_at);
create index if not exists idx_email_verifications_email on public.email_verifications(email, purpose, expires_at);
create index if not exists idx_payment_orders_user on public.payment_orders(user_id, created_at);

alter table public.users enable row level security;
alter table public.auth_tokens enable row level security;
alter table public.papers enable row level security;
alter table public.questions enable row level security;
alter table public.sessions enable row level security;
alter table public.answers enable row level security;
alter table public.wrongbook enable row level security;
alter table public.review_schedule enable row level security;
alter table public.favorites enable row level security;
alter table public.captcha_challenges enable row level security;
alter table public.email_verifications enable row level security;
alter table public.ai_accounts enable row level security;
alter table public.payment_orders enable row level security;
