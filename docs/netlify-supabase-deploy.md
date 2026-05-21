# Netlify + Supabase 部署说明

## 1. 创建 Supabase 数据库

1. 注册或登录 Supabase。
2. 创建一个 Free 项目。
3. 打开 SQL Editor，执行 `supabase/schema.sql`。
4. 在 Project Settings -> API 中复制 `Project URL` 和 `service_role` key。

## 2. 配置 Netlify 环境变量

在 app.netlify.com 的站点设置里进入 Environment variables，添加：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
DEEPSEEK_API_KEY=你的 DeepSeek API Key
QQ_SMTP_USER=你的 QQ 邮箱
QQ_SMTP_AUTH_CODE=你的 QQ 邮箱授权码
QQ_SMTP_FROM=你的 QQ 邮箱或发件显示地址
```

注意：不要把 DeepSeek、Supabase、QQ 邮箱授权码写进代码或提交到仓库。

## 3. Netlify 部署设置

- Build command: `npm run build`
- Publish directory: `.`
- Functions directory: `netlify/functions`

`netlify.toml` 已把 `/api/*` 转发到 `/.netlify/functions/api/:splat`，前端可以继续使用原来的 `/api/...` 请求。

## 4. 本地验证

```powershell
npm install
npm run typecheck
npm run test
```

## 5. 迁移本地 SQLite 数据到 Supabase

先预检查本地数据量：

```powershell
npm run migrate:supabase:dry
```

确认 Supabase 已执行 `supabase/schema.sql` 后，再设置迁移环境变量并执行：

```powershell
$env:SUPABASE_URL='你的 Supabase Project URL'
$env:SUPABASE_SERVICE_ROLE_KEY='你的 Supabase service_role key'
npm run migrate:supabase
```

迁移脚本会按外键顺序 upsert：用户、试卷、题目、刷题记录、错题、收藏、AI 次数、支付订单等。重复执行会按主键合并，不会主动清空线上数据。

Python 本地后端仍可继续用于本机开发：

```powershell
python server.py
```
