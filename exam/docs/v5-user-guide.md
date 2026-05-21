# v5 使用说明与测试报告

生成日期：2026-05-21

## 入口

- 根目录入口：`http://127.0.0.1:8002/index.html`，提供登录/注册页，成功后进入 v5。
- v5 页面入口：`http://127.0.0.1:8002/v5/index.html`

## 启动

```powershell
python server.py
```

如果系统没有全局 `python`，可以用 Codex 内置 Python：

```powershell
& 'C:\Users\池鱼\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' server.py
```

启动后会自动创建 SQLite 数据库：

```text
data/exam_app.sqlite3
```

## DeepSeek API

不要把 API Key 写到前端文件。正确方式是在启动服务前设置环境变量：

```powershell
$env:DEEPSEEK_API_KEY='你的新 DeepSeek Key'
python server.py
```

未设置时，AI 接口会返回 503，前端会显示“AI 暂不可用”，普通刷题、导入、错题、数据库功能仍可使用。

## 已实现功能

- 注册、登录、Token 鉴权。
- SQLite 数据库自动建表。
- 试卷创建、试卷列表、试卷详情。
- 批量导入题目。
- 自定义正则导入格式。
- AI 自动识别题目，未配置 Key 时自动降级为规则解析。
- 练习模式、考试模式、速刷模式。
- 键盘刷题：`1-4` / `A-D` 选项，`Enter` 提交，方向键切题，`E` 解析，`H` AI 解析。
- 答题提交后自动判分。
- 答错自动进入错题本。
- 错题原因、错题笔记、掌握标记。
- 间隔复习队列。
- 学习数据统计。
- DeepSeek AI 解析代理。

## 默认导入格式

```text
1.题目 DNS 的作用是？
A.域名解析
B.图片压缩
C.加密通信
D.浏览器插件管理
答案:A
解析:DNS 将域名解析为 IP 地址。
```

解析可以没有；题目开头支持 `1.题目`、`1. 题目`、`1、题目`。

## 自定义正则字段

| 字段 | 默认值 |
| --- | --- |
| 题目开始正则 | `(?m)^\s*\d+[\.、]\s*` |
| 选项正则 | `(?m)^([A-D])[\.、\)]\s*(.+)$` |
| 答案正则 | `答案[:：]\s*([A-D]+)` |
| 解析正则 | `解析[:：]\s*(.*)` |

## 测试覆盖

已通过：

```powershell
python -m unittest tests.test_v5_backend
python -m unittest tests.test_v5_http_integration
node tests\v5-frontend-smoke.js
node --check v5\assets\js\v5-app.js
python -m py_compile exam_core.py server.py
```

覆盖的真实流程：

- 打开 v5 页面返回 200。
- 注册用户写入 SQLite。
- 登录返回 Token。
- `/api/me` 验证登录用户。
- 正则批量解析题目。
- AI 导入未配置 Key 时兜底解析。
- 保存试卷到数据库。
- 读取试卷列表和详情。
- 创建刷题会话。
- 提交错误答案。
- 自动生成错题本记录。
- 更新错题原因和笔记。
- 生成复习队列。
- 学习统计更新。
- DeepSeek 未配置时安全返回 503。
