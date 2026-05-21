# 题练云 v5 优化报告

生成日期：2026-05-22

## 1. 优化目标

本轮优化围绕“重做一个真正可用的刷题网站”展开，目标是把旧版分散页面整理为一个 v5 单页刷题平台，对标考试酷、考研刷题类产品，重点提升题库导入、刷题效率、错题整理、移动端体验、AI 辅助和数据分析能力。

最终保留的系统范围为 v5：

- 根目录入口：`index.html`，提供登录/注册页并写入 v5 登录态。
- v5 页面入口：`v5/index.html`
- 前端样式：`v5/assets/css/v5-app.css`
- 前端逻辑：`v5/assets/js/v5-app.js`
- 后端服务：`server.py`
- 核心业务：`exam_core.py`
- 数据库：`data/exam_app.sqlite3`
- 视觉素材：`assets/characters/`、`assets/backgrounds/`
- 测试文件：`tests/test_v5_backend.py`、`tests/test_v5_http_integration.py`、`tests/v5-frontend-smoke.js`

## 2. 用户提出的主要优化

### 2.1 整体重塑

- 完全重新设计网站布局，不沿用旧系统页面。
- 对标考试酷、考研刷题等刷题网站。
- 功能尽量完整，支持注册、登录、数据库、导入、刷题、错题、收藏、分析、AI 辅助。
- 删除旧系统，只保留 v5 相关文件。

### 2.2 题库导入与管理

- 取消复杂正则表单，优先使用 AI 自动识别题目。
- 未配置 AI 时，使用规则兜底识别。
- 支持用户粘贴如下常见格式：

```text
1.题目
A.
B.
C.
D.
答案:
解析:可以没有
```

- AI 识别后可以预览具体题目样子，预览效果接近刷题页面。
- 保存到数据库后不自动跳转到刷题页。
- 题库页按试卷分组展示。
- 添加题库区域默认收起，点击按钮后再显示。
- 可以自定义试卷名称、分类、分组。
- 可以编辑题库中已有题目的题干、题型、选项、答案、分值和解析。

### 2.3 刷题体验

- 点击“开始刷题”后才显示题目，并自动跳到刷题区域。
- 练习模式选完即判。
- 考试模式隐藏答案和解析。
- 取消快速刷题模式。
- 所有模式连续点击已选择/已判断选项时可进入下一题。
- 到最后一题时无需强制下一题。
- 提交按钮用于提交整套试卷。
- 未完成也可以提交试卷。
- 支持键盘控制刷题。
- 支持用户自定义键盘格式。
- 保存键盘格式后，侧边栏“键盘刷题”提示同步更新。
- 默认键位已调整为更适合单手操作的格式：
  `A=j`、`B=k`、`C=l`、`D=i`、`提交=Enter`、`上一题=a`、`下一题=d`、`解析=s`、`AI=w`、`收藏=f`

### 2.4 解析与 AI 辅助

- 刷题时可以调用 DeepSeek API 显示解析。
- DeepSeek API Key 只保存在服务端环境变量 `DEEPSEEK_API_KEY`，前端不保存密钥。
- 点击 AI 解析后，原解析不消失。
- AI 解析单独展示，可以编辑后保存为本题解析。
- 双击原解析可以自定义解析，并自动保存。
- AI 助教页面采用对话框形式展示建议。
- AI 输出自动换行，适配手机阅读。
- AI 分析错题本时只整理题目内容，不塞入多余格式。

### 2.5 错题本与收藏

- 错题本显示完整题干和选项，让用户看题更直观。
- 错因/记忆解析保存后不刷新整个页面。
- 笔记区域调整为“记忆解析”，方便用户写自己的理解。
- 错题重练改为“自定义新试卷”。
- 用户可以从错题记录和收藏题目中勾选题目生成新试卷。
- 生成新试卷时可自动命名。
- 生成后可以选择清除来源，也可以保留来源。
- 支持题目收藏功能。
- 收藏题可参与错题/收藏混合组卷。

### 2.6 学习分析

- 学习分析不依赖 AI。
- 通过本地数据库统计生成学习分析。
- 增加学习健康分、近期答题趋势、薄弱分组、错因分布、题型表现、高耗时题目、行动建议。
- 统计收藏题数量、总题量、平均耗时、近 30 题正确率、复习队列等数据。

### 2.7 移动端和视觉

- 手机端隐藏侧边导航和今日建议卡。
- 登录后不显示“登录/注册”按钮。
- 全面优化手机端刷题显示，不再是一张长图式页面。
- 手机端增加底部操作按钮。
- 使用 `assets/backgrounds/` 中的图片作为背景。
- 使用 `assets/characters/` 中的角色素材和图标。
- 优化整体颜色、卡片层级和响应式布局。

## 3. 已实现功能概览

### 3.1 用户与数据库

- SQLite 自动建表。
- 用户注册、登录、Token 鉴权。
- 试卷、题目、答题记录、错题本、复习计划、收藏题全部入库。
- 所有用户数据按用户隔离。

### 3.2 题库系统

- `POST /api/import/parse`：规则兜底解析题目。
- `POST /api/import/ai`：DeepSeek AI 识别题目，未配置时自动兜底。
- `POST /api/papers`：保存试卷。
- `GET /api/papers`：读取试卷列表。
- `GET /api/papers/{id}`：读取试卷详情。
- `PATCH /api/papers/{id}`：编辑试卷名称、分类、分组。
- `PATCH /api/questions/{id}`：编辑题目内容。
- 导入结果支持做题式预览，可逐题切换查看。

### 3.3 刷题系统

- 支持练习模式和考试模式。
- 练习模式选项点击后立即判题。
- 考试模式隐藏正确答案和解析。
- 支持整卷提交，未完成也可提交。
- 支持键盘控制和自定义键位。
- 支持收藏当前题。
- 支持原解析、AI 解析、自定义解析三类解析工作流。

### 3.4 错题与复习

- 答错自动进入错题本。
- 错题记录包含题干、选项、用户答案、正确答案、错因、记忆解析、参考解析。
- 错因和记忆解析保存后只更新当前卡片。
- 可标记掌握。
- 可从错题和收藏中选择题目组成新试卷。
- 可选择生成后清除错题/收藏来源。
- 自动维护复习计划队列。

### 3.5 收藏题

- `favorites` 表保存收藏关系。
- `PATCH /api/questions/{id}/favorite` 添加或取消收藏。
- `GET /api/favorites` 获取收藏列表。
- 刷题页支持按钮收藏和快捷键收藏。
- 收藏题可用于自定义组卷。

### 3.6 学习分析

- `GET /api/stats` 返回学习分析数据。
- 分析项包括：
  - 试卷数
  - 题目数
  - 累计答题数
  - 总体正确率
  - 近 30 题正确率
  - 未掌握错题数
  - 待复习数
  - 收藏题数
  - 平均耗时
  - 薄弱分组
  - 错因分布
  - 题型表现
  - 高耗时题目
  - 本地行动建议

## 4. 关键接口变化

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/register` | 注册用户 |
| `POST` | `/api/login` | 登录并返回 Token |
| `GET` | `/api/me` | 获取当前用户 |
| `POST` | `/api/import/parse` | 规则解析题目 |
| `POST` | `/api/import/ai` | AI 识别题目 |
| `POST` | `/api/papers` | 创建试卷 |
| `GET` | `/api/papers` | 试卷列表 |
| `GET` | `/api/papers/{id}` | 试卷详情 |
| `PATCH` | `/api/papers/{id}` | 编辑试卷信息 |
| `PATCH` | `/api/questions/{id}` | 编辑题目内容 |
| `PATCH` | `/api/questions/{id}/analysis` | 保存题目解析 |
| `PATCH` | `/api/questions/{id}/favorite` | 收藏/取消收藏 |
| `POST` | `/api/sessions` | 开始刷题会话 |
| `POST` | `/api/answer` | 提交单题答案 |
| `POST` | `/api/sessions/{id}/finish` | 提交整套试卷 |
| `GET` | `/api/wrongbook` | 错题本 |
| `PATCH` | `/api/wrongbook/{id}` | 保存错因/记忆解析/掌握状态 |
| `DELETE` | `/api/wrongbook/{id}` | 删除错题来源 |
| `GET` | `/api/favorites` | 收藏题列表 |
| `GET` | `/api/review/due` | 复习队列 |
| `GET` | `/api/stats` | 本地学习分析 |
| `POST` | `/api/deepseek` | DeepSeek 代理 |

## 5. 文件清理结果

按用户要求，旧系统已删除，仅保留 v5 相关文件。

已删除范围包括：

- 旧版 `src/`
- 旧版 `pages/`
- 旧版 `v3/`
- 旧版 `v4/`
- 旧脚本和旧入口文件
- 旧测试临时文件
- 旧文档
- 缓存文件

当前保留的核心文件：

```text
exam_core.py
server.py
index.html
v5/index.html
v5/assets/js/v5-app.js
v5/assets/css/v5-app.css
data/exam_app.sqlite3
tests/test_v5_backend.py
tests/test_v5_http_integration.py
tests/v5-frontend-smoke.js
docs/v5-user-guide.md
docs/v5-optimization-report.md
assets/characters/
assets/backgrounds/
```

## 6. 测试与验证

本轮优化持续使用以下命令验证：

```powershell
node tests\v5-frontend-smoke.js
node --check v5\assets\js\v5-app.js
& 'C:\Users\池鱼\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest tests.test_v5_backend tests.test_v5_http_integration
& 'C:\Users\池鱼\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m py_compile exam_core.py server.py
```

覆盖的关键流程：

- v5 页面可访问。
- 素材图片可访问。
- 用户注册、登录、鉴权。
- 题目解析和 AI 兜底解析。
- 保存试卷到数据库后停留在题库页。
- 试卷信息编辑。
- 题目内容编辑。
- 开始刷题、答题、提交整卷。
- 练习模式选完即判。
- 错题自动入库。
- 错题原因和记忆解析保存。
- 错题删除来源。
- 题目收藏和取消收藏。
- 错题/收藏自定义组卷。
- 复习队列生成。
- 本地学习分析统计。
- DeepSeek 未配置时返回安全错误。
- 前端不包含硬编码 API Key。

## 7. 安全说明

- DeepSeek API Key 不写入前端文件。
- 前端只调用后端 `/api/deepseek` 代理。
- 后端从环境变量 `DEEPSEEK_API_KEY` 读取密钥。
- 题库、题目、错题、收藏等接口均通过 Token 判断当前用户。
- 由于密钥曾在对话中出现过，建议实际使用前更换 DeepSeek Key。

## 8. 后续可继续优化方向

- 给题目编辑器增加“新增题目”和“删除题目”。
- 增加试卷导出功能，例如 JSON、Markdown、Excel。
- 增加批量编辑题目分组、标签和难度。
- 给移动端题库编辑器增加更紧凑的抽屉式编辑。
- 增加正式 E2E 浏览器测试，覆盖导入、刷题、错题、收藏、编辑全链路。
- 增加数据库备份和恢复入口。
