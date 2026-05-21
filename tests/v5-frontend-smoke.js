const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rootHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const html = fs.readFileSync(path.join(root, 'v5', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'v5', 'assets', 'js', 'v5-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'v5', 'assets', 'css', 'v5-app.css'), 'utf8');

new Function(js);

function mustInclude(source, text, label) {
  if (!source.includes(text)) {
    throw new Error(`${label} missing ${text}`);
  }
}

function mustNotInclude(source, text, label) {
  if (source.includes(text)) {
    throw new Error(`${label} should not include ${text}`);
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) {
    throw new Error(`js missing function ${name}`);
  }
  const nextFunction = source.indexOf('\nfunction ', start + 1);
  const nextAsyncFunction = source.indexOf('\nasync function ', start + 1);
  const candidates = [nextFunction, nextAsyncFunction].filter((index) => index > start);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

[
  'v5/index.html',
  '题练云 v5',
  '/api/register',
  '/api/login',
  '/api/email/send-code',
  '/api/captcha',
  'sendEmailCode',
  'EMAIL_CODE_COOLDOWN_SECONDS',
  'startEmailCooldown',
  'renderEmailCooldown',
  'emailCode',
  '@qq.com',
  'exam_v5_token',
  'exam_v5_user',
  'submitAuth',
  'registerMode',
  'loginMode',
  'brandAvatar',
  'hydrateLandingAvatar',
  'sessionStorage',
  'exam_v5_landing_avatar',
  'assets/head%20portrait/1.jpg',
  'assets/backgrounds/main-page.jpg',
  'assets/characters/hero-character.png'
].forEach((text) => mustInclude(rootHtml, text, 'root html'));
mustNotInclude(rootHtml, 'id="enterApp"', 'root html');
mustNotInclude(rootHtml, '>进入 v5<', 'root html');

[
  '考试酷级题库管理',
  '注册',
  '登录',
  '图形识别码',
  '退出登录',
  'AI 自动识别',
  '智能识别题目',
  'appLogoAvatar',
  '未完成也可提交',
  '自定义键盘',
  '手机刷题快捷操作',
  '自定义新试卷',
  '不填自动生成',
  '试卷分组',
  '题库分组',
  '添加题库',
  '选择任务',
  'AI 对话建议',
  'AI 次数',
  '支付宝充值',
  '错题本',
  '题目收藏',
  '学习分析',
  '键盘刷题'
].forEach((text) => mustInclude(html, text, 'html'));

[
  '/api/register',
  '/api/login',
  '/api/captcha',
  '/api/import/parse',
  '/api/import/ai',
  '/api/papers',
  '/api/sessions',
  '/api/sessions/',
  '/api/answer',
  '/api/wrongbook',
  '/api/favorites',
  '/api/deepseek',
  '/api/ai/account',
  '/api/payments/ai-package',
  'HEAD_PORTRAIT_ASSETS',
  'hydrateAppLogoAvatar',
  'exam_v5_app_logo_avatar',
  '../assets/head%20portrait/1.jpg',
  'refreshAiAccount',
  'refreshAuthCaptcha',
  'logoutCurrentUser',
  'renderEmptyStats',
  'authCaptchaId',
  'authEmailCooldownUntil',
  'startAuthEmailCooldown',
  'renderAuthEmailCooldown',
  'EMAIL_CODE_COOLDOWN_SECONDS',
  'location.href = \'../index.html\'',
  'renderAiAccount',
  'createAiPaymentOrder',
  'completeAiPaymentOrder',
  'aiQuotaCard',
  'paymentAmount',
  'toggleFavoriteCurrent',
  'renderFavorites',
  'favoriteIds',
  'selectedPaperItems',
  'collectSelectedPaperItems',
  'clearGeneratedSources',
  'data-paper-pick',
  'WRONGBOOK_PAGE_SIZE',
  'paginatePaperItems',
  'renderPaperPagination',
  'changePaperPage',
  'toggleCurrentPageSelection',
  'data-page-move',
  'data-select-page',
  'keyboardSettings',
  'DEFAULT_KEYBOARD_SETTINGS',
  "A: ['j']",
  "B: ['k']",
  "C: ['l']",
  "D: ['i']",
  'handlePracticeKeydown',
  'clearQuestionFeedback',
  'handleOptionActivate',
  'finishOrAdvance',
  'scrollToPracticeStage',
  'isExamMode',
  'wrong-option',
  '保存原因/解析',
  '记忆解析',
  'data-wrong-save',
  'markWrongSaved',
  'generatePaperTitle',
  'groupPapers',
  'renderBankGroups',
  'openPaperEditor',
  'renderPaperEditor',
  'savePaperMeta',
  'saveEditableQuestion',
  'deletePaper',
  'deleteEditableQuestion',
  'closePaperEditor',
  'data-bank-edit-meta',
  'data-bank-edit-questions',
  'data-bank-delete-paper',
  'data-save-paper-meta',
  'data-save-edit-question',
  'data-delete-edit-question',
  'toggleImportStudio',
  'bindAiTemplates',
  'formatAiTemplate',
  'formatWrongbookForAi',
  'await aiAnalyzeWrongbook();',
  'autoResizeAiPrompt',
  'appendAiMessage',
  'renderAiOutput',
  'formatAiMarkdown',
  'formatAiTable',
  'formatInlineMarkdown',
  'saveKeyboardSettings',
  'renderShortcutCard',
  'formatShortcutGroup',
  'formatShortcutKey',
  'createWrongPaper',
  'updateWrongPaperCount',
  'submitPaper',
  'shouldJudgeImmediately',
  'renderImportPracticePreview',
  'renderImportPreviewNav',
  'setImportPreviewIndex',
  'importPreviewQuestions',
  'importPreviewIndex',
  'data-import-preview-index',
  'data-import-preview-step',
  'editAnalysisPanel',
  'renderAiAnalysisPanel',
  'editAiAnalysisPanel',
  'saveAiAnalysisAsQuestion',
  'saveQuestionAnalysis',
  '/api/questions/',
  'finishSession',
  'renderQuestion',
  'renderBigDataInsights',
  'renderTrendBars',
  'formatDuration',
  'bigDataInsights'
].forEach((text) => mustInclude(js, text, 'js'));

[
  'authCaptchaRow',
  'authCaptchaImage',
  'authCaptchaCode',
  'authRefreshCaptcha'
].forEach((text) => mustInclude(html, text, 'html'));

mustInclude(rootHtml, 'maxlength="5"', 'root html');
mustInclude(rootHtml, 'inputmode="numeric"', 'root html');
mustInclude(html, 'maxlength="5"', 'html');
mustInclude(html, 'inputmode="numeric"', 'html');

mustNotInclude(html, 'value="speed"', 'html');
mustNotInclude(js, "value === 'speed'", 'js');
mustNotInclude(extractFunction(js, 'savePaper'), "routeTo('practice')", 'savePaper');

const wrongPaperCountInput = html.match(/<input id="wrongPaperCount"[^>]*>/);
if (!wrongPaperCountInput) {
  throw new Error('html missing wrongPaperCount input');
}
if (!wrongPaperCountInput[0].includes('readonly') || !wrongPaperCountInput[0].includes('value="0"')) {
  throw new Error('wrongPaperCount must be a readonly selected-count display starting at 0');
}

const createWrongPaperSource = extractFunction(js, 'createWrongPaper');
mustInclude(createWrongPaperSource, '/api/papers', 'createWrongPaper');
mustInclude(createWrongPaperSource, "source: 'wrongbook_custom'", 'createWrongPaper');
mustInclude(createWrongPaperSource, 'await refreshPapers()', 'createWrongPaper');
mustInclude(createWrongPaperSource, 'await startPractice()', 'createWrongPaper');
mustNotInclude(createWrongPaperSource, "id: 'wrongbook_custom'", 'createWrongPaper');

mustInclude(html, 'wrongbookPager', 'html');
mustInclude(html, 'wrongbookPagerBottom', 'html');
mustInclude(html, 'favoritesView', 'html');
mustInclude(html, 'data-view-link="favorites"', 'html');
mustInclude(html, 'data-view-button="favorites"', 'html');
mustInclude(html, 'favoritePager', 'html');
mustInclude(html, 'favoritePagerBottom', 'html');
mustInclude(extractFunction(js, 'collectSelectedPaperItems'), 'appState.selectedPaperItems', 'collectSelectedPaperItems');
mustInclude(extractFunction(js, 'renderWrongbookList'), 'paginatePaperItems', 'renderWrongbookList');
mustInclude(extractFunction(js, 'renderFavorites'), 'paginatePaperItems', 'renderFavorites');
mustInclude(extractFunction(js, 'routeTo'), "view === 'favorites'", 'routeTo');

[
  'exam-layout',
  'logo-badge img',
  'question-workbench',
  'keyboard-settings',
  'mobile-practice-bar',
  'wrong-options',
  'favorite-list',
  'favoriteButton',
  'wrong-name-field',
  'wrong-count-field',
  'paper-page-toolbar',
  'page-summary',
  'wrong-actions',
  'paper-group',
  'bank-group-card',
  'bank-paper-item',
  'paper-edit-panel',
  'paper-meta-editor',
  'question-editor-card',
  'question-option-editor',
  'btn.danger',
  'captcha-row',
  'ai-layout',
  'ai-quota-card',
  'payment-box',
  'payment-order',
  'ai-chat',
  'import-preview-stage',
  'import-preview-nav',
  'import-preview-mini',
  'preview-answer-chip',
  'import-option-list',
  'overflow-wrap',
  'ai-message',
  'ai-bubble',
  'ai-table-wrap',
  'ai-table',
  'ai-list',
  'ai-divider',
  'ai-preset-grid',
  'ai-output-card',
  'analysis-editor',
  'analysis-hint',
  'ai-analysis-card',
  'analysis-block-title',
  'visual-strip',
  'stat-figure',
  'module-hero-art',
  'bank-visual-badge',
  'wrongbook-visual',
  'ai-mascot-card',
  'commercial-hero',
  'analytics-grid',
  'big-data-insights',
  'learning-insight-board',
  'trend-bars',
  'recommendation-list',
  '@media'
].forEach((text) => mustInclude(css, text, 'css'));

[
  'visual-strip',
  'stat-figure',
  'module-hero-art',
  'wrongbook-visual',
  'ai-mascot-card'
].forEach((text) => mustInclude(html, text, 'html'));

[
  'shortcutChoiceKeys',
  'shortcutSubmitKey',
  'shortcutNavigateKeys',
  'shortcutSupportKeys'
].forEach((text) => mustInclude(html, text, 'html'));

if (/sk-[A-Za-z0-9]{12,}/.test(html + js + css)) {
  throw new Error('frontend must not contain API secrets');
}

console.log('v5 frontend smoke checks passed');
