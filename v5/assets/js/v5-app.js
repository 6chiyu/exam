const DEFAULT_KEYBOARD_SETTINGS = {
  A: ['j'],
  B: ['k'],
  C: ['l'],
  D: ['i'],
  submit: ['Enter'],
  prev: ['a'],
  next: ['d'],
  analysis: ['s'],
  ai: ['w'],
  favorite: ['f']
};

const WRONGBOOK_PAGE_SIZE = 5;
const EMAIL_CODE_COOLDOWN_SECONDS = 60;

const HEAD_PORTRAIT_ASSETS = [
  '../assets/head%20portrait/1.jpg',
  '../assets/head%20portrait/2.jpg',
  '../assets/head%20portrait/3.jpg',
  '../assets/head%20portrait/4.jpg',
  '../assets/head%20portrait/5.jpg',
  '../assets/head%20portrait/6.jpg',
  '../assets/head%20portrait/7.jpg'
];

const appState = {
  token: localStorage.getItem('exam_v5_token') || '',
  user: JSON.parse(localStorage.getItem('exam_v5_user') || 'null'),
  papers: [],
  currentPaper: null,
  session: null,
  index: 0,
  answers: {},
  checked: {},
  keyboardSettings: readKeyboardSettings(),
  favoriteIds: new Set(),
  wrongbookItems: [],
  favoriteItems: [],
  selectedPaperItems: new Set(),
  wrongbookPage: 1,
  favoritePage: 1,
  parsedQuestions: [],
  importPreviewQuestions: [],
  importPreviewTitle: '',
  importPreviewIndex: 0,
  editingPaper: null,
  authCaptchaId: '',
  authEmailCooldownUntil: Number(localStorage.getItem('exam_v5_email_cooldown_until') || 0),
  authEmailCooldownTimer: null,
  aiAccount: null,
  paymentOrder: null,
  startedAt: 0,
  timer: null,
  selectedAnswer: ''
};

const characterAssets = [
  '../assets/characters/card-character-1.png',
  '../assets/characters/card-character-2.png',
  '../assets/characters/card-character-3.png',
  '../assets/characters/card-character-4.png',
  '../assets/characters/card-character-5.png'
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener('DOMContentLoaded', init);

function init() {
  hydrateAppLogoAvatar();
  bindNavigation();
  bindAuth();
  bindActions();
  bindAiTemplates();
  hydrateKeyboardSettings();
  renderShortcutCard();
  document.addEventListener('keydown', handlePracticeKeydown);
  updateUserLabel();
  renderAuthEmailCooldown();
  routeTo(location.hash.replace('#', '') || 'home');
  if (appState.token) {
    refreshAll();
  } else {
    renderGuestState();
  }
}

function bindNavigation() {
  $$('[data-view-link], [data-view-button]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      routeTo(element.dataset.viewLink || element.dataset.viewButton);
    });
  });
}

function hydrateAppLogoAvatar() {
  const avatar = $('#appLogoAvatar');
  if (!avatar) return;
  const storageKey = 'exam_v5_app_logo_avatar';
  let selected = '';
  try {
    selected = sessionStorage.getItem(storageKey) || '';
  } catch (error) {
    selected = '';
  }
  if (!HEAD_PORTRAIT_ASSETS.includes(selected)) {
    selected = HEAD_PORTRAIT_ASSETS[Math.floor(Math.random() * HEAD_PORTRAIT_ASSETS.length)];
    try {
      sessionStorage.setItem(storageKey, selected);
    } catch (error) {
      // 存储不可用时仍显示本次随机头像，不影响使用。
    }
  }
  avatar.src = selected;
  avatar.onerror = () => {
    avatar.remove();
    $('.logo-badge').textContent = '题';
  };
}

function bindAuth() {
  $$('[data-open-auth]').forEach((button) => {
    button.addEventListener('click', () => openAuth(button.dataset.openAuth));
  });
  $('#authSubmit').addEventListener('click', submitAuth);
  $('#authSendCode')?.addEventListener('click', sendAuthEmailCode);
  $('#authRefreshCaptcha')?.addEventListener('click', () => refreshAuthCaptcha());
  $('#resetAuthMode')?.addEventListener('click', () => openAuth('reset'));
  $('#logoutButton')?.addEventListener('click', logoutCurrentUser);
}

function bindActions() {
  const actions = {
    quickPractice,
    refreshPapers,
    loadImportExample,
    toggleImportStudio,
    aiParseImport,
    savePaper,
    startPractice,
    startWrongPractice,
    createWrongPaper,
    finishSession,
    submitPaper,
    prevQuestion,
    nextQuestion,
    submitAnswer,
    showAnalysis,
    aiExplainCurrent,
    toggleFavoriteCurrent,
    saveKeyboardSettings,
    loadWrongbook,
    loadFavorites,
    askAi,
    aiAnalyzeWrongbook,
    refreshAiAccount,
    createAiPaymentOrder,
    completeAiPaymentOrder
  };

  $$('[data-action]').forEach((button) => {
    button.addEventListener('click', () => actions[button.dataset.action]?.());
  });
}

function routeTo(view) {
  $$('.app-view').forEach((node) => node.classList.remove('active'));
  $(`#${view}View`)?.classList.add('active');
  $$('[data-view-link], [data-view-button]').forEach((node) => {
    const target = node.dataset.viewLink || node.dataset.viewButton;
    node.classList.toggle('active', target === view);
  });
  history.replaceState(null, '', `#${view}`);
  if (view === 'practice' && !appState.session) {
    setPracticeVisible(false);
  }
  if (view === 'bank') {
    renderBankGroups();
  }
  if (view === 'wrongbook') {
    loadWrongbook();
  }
  if (view === 'favorites') {
    loadFavorites();
  }
  if (view === 'analytics') renderAnalytics();
  if (view === 'ai') refreshAiAccount();
}

function getDisplayNickname(user) {
  return user?.nickname || user?.username || '用户';
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (appState.token) headers.Authorization = `Bearer ${appState.token}`;
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `请求失败：${response.status}`);
  }
  return data;
}

function openAuth(mode) {
  $('#authDialog').dataset.mode = mode;
  $('#authTitle').textContent = mode === 'reset' ? '重置密码' : (mode === 'register' ? '注册' : '登录');
  $('#authSubmit').textContent = mode === 'reset' ? '重置密码' : (mode === 'register' ? '注册并开始' : '登录');
  $('#authUsernameRow')?.classList.toggle('hidden', mode === 'reset');
  $('#nicknameRow').classList.toggle('hidden', mode !== 'register');
  $('#authEmailRow')?.classList.toggle('hidden', mode === 'login');
  $('#authCaptchaRow')?.classList.toggle('hidden', mode === 'login');
  $('#authEmailCodeRow')?.classList.toggle('hidden', mode === 'login');
  $('#authHint').textContent = mode === 'reset'
    ? '输入注册 QQ 邮箱，获取验证码后设置新密码。'
    : (mode === 'register'
      ? '注册需要先识别图形码，再发送 QQ 邮箱验证码。每个用户免费体验 20 次 AI。'
      : '没有账号？点击右上角注册。');
  $('#authDialog').showModal();
  if (mode !== 'login') refreshAuthCaptcha();
}

async function submitAuth() {
  const mode = $('#authDialog').dataset.mode || 'login';
  const payload = {
    username: $('#authUsername').value.trim(),
    password: $('#authPassword').value,
    nickname: $('#authNickname').value.trim(),
    email: $('#authEmail')?.value.trim() || '',
    emailCode: $('#authEmailCode')?.value.trim() || ''
  };
  try {
    if (mode === 'reset') {
      await submitPasswordReset(payload);
      return;
    }
    if (mode === 'register') {
      await api('/api/register', { method: 'POST', body: payload });
      toast('注册成功，正在登录。');
    }
    const login = await api('/api/login', { method: 'POST', body: payload });
    appState.token = login.token;
    appState.user = login.user;
    localStorage.setItem('exam_v5_token', appState.token);
    localStorage.setItem('exam_v5_user', JSON.stringify(appState.user));
    $('#authDialog').close();
    updateUserLabel();
    await refreshAll();
    await refreshAiAccount();
    toast(`欢迎回来，${getDisplayNickname(appState.user)}`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function submitPasswordReset(payload) {
  await api('/api/password/reset', {
    method: 'POST',
    body: { email: payload.email, emailCode: payload.emailCode, password: payload.password }
  });
  toast('密码已重置，请使用新密码登录。');
  $('#authPassword').value = '';
  $('#authEmailCode').value = '';
  openAuth('login');
}

async function sendAuthEmailCode() {
  const email = $('#authEmail')?.value.trim() || '';
  const captchaCode = $('#authCaptchaCode')?.value.trim() || '';
  if (getAuthEmailCooldownRemaining() > 0) {
    toast(`验证码已发送，请 ${getAuthEmailCooldownRemaining()} 秒后再试。`, true);
    return;
  }
  if (!/^[A-Za-z0-9._%+\-]{3,64}@qq\.com$/i.test(email)) {
    toast('请填写 QQ 邮箱，例如 123456@qq.com。', true);
    return;
  }
  if (!appState.authCaptchaId || !captchaCode) {
    toast('请先识别图形验证码，再发送邮箱验证码。', true);
    return;
  }
  const button = $('#authSendCode');
  try {
    if (button) button.disabled = true;
    const mode = $('#authDialog').dataset.mode || 'login';
    const result = await api(mode === 'reset' ? '/api/password/send-reset-code' : '/api/email/send-code', {
      method: 'POST',
      body: { email, captchaId: appState.authCaptchaId, captchaCode }
    });
    if (result.dev_code && $('#authEmailCode')) $('#authEmailCode').value = result.dev_code;
    toast(result.dev_code ? `本地开发验证码：${result.dev_code}` : '验证码已发送，请查看 QQ 邮箱。');
    startAuthEmailCooldown(EMAIL_CODE_COOLDOWN_SECONDS);
    await refreshAuthCaptcha();
  } catch (error) {
    toast(error.message, true);
  } finally {
    renderAuthEmailCooldown();
  }
}

function getAuthEmailCooldownRemaining() {
  return Math.max(0, Math.ceil((Number(appState.authEmailCooldownUntil || 0) - Date.now()) / 1000));
}

function startAuthEmailCooldown(seconds = EMAIL_CODE_COOLDOWN_SECONDS) {
  appState.authEmailCooldownUntil = Date.now() + seconds * 1000;
  localStorage.setItem('exam_v5_email_cooldown_until', String(appState.authEmailCooldownUntil));
  renderAuthEmailCooldown();
}

function renderAuthEmailCooldown() {
  const button = $('#authSendCode');
  if (!button) return;
  if (appState.authEmailCooldownTimer) {
    clearTimeout(appState.authEmailCooldownTimer);
    appState.authEmailCooldownTimer = null;
  }
  const remaining = getAuthEmailCooldownRemaining();
  if (remaining > 0) {
    button.disabled = true;
    button.textContent = `${remaining}s 后重发`;
    appState.authEmailCooldownTimer = setTimeout(renderAuthEmailCooldown, 1000);
    return;
  }
  button.disabled = false;
  button.textContent = '发送验证码';
  localStorage.removeItem('exam_v5_email_cooldown_until');
}

async function refreshAuthCaptcha() {
  const image = $('#authCaptchaImage');
  const input = $('#authCaptchaCode');
  if (!image) return;
  try {
    const result = await api('/api/captcha');
    appState.authCaptchaId = result.id || '';
    image.src = result.captcha_image || '';
    image.alt = '点击换一张图形识别码';
    if (input) input.value = '';
  } catch (error) {
    appState.authCaptchaId = '';
    toast(error.message, true);
  }
}

function updateUserLabel() {
  $('#currentUserLabel').textContent = appState.user ? getDisplayNickname(appState.user) : '未登录';
  $$('[data-open-auth]').forEach((button) => {
    button.classList.toggle('hidden', Boolean(appState.user));
  });
  $('#logoutButton')?.classList.toggle('hidden', !appState.user);
}

function logoutCurrentUser() {
  if (!confirm('确定退出当前账号吗？本机保存的登录状态会被清除。')) return;
  appState.token = '';
  appState.user = null;
  appState.papers = [];
  appState.currentPaper = null;
  appState.session = null;
  appState.answers = {};
  appState.checked = {};
  appState.favoriteIds = new Set();
  appState.wrongbookItems = [];
  appState.favoriteItems = [];
  appState.selectedPaperItems = new Set();
  appState.editingPaper = null;
  appState.aiAccount = null;
  localStorage.removeItem('exam_v5_token');
  localStorage.removeItem('exam_v5_user');
  closePaperEditor();
  setPracticeVisible(false);
  location.href = '../index.html';
  toast('已退出登录。');
}

function renderEmptyStats() {
  $('#statPapers').textContent = '0';
  $('#statAnswers').textContent = '0';
  $('#statAccuracy').textContent = '0%';
  $('#statWrong').textContent = '0';
  $('#statDue').textContent = '0';
  $('#todayAdvice').textContent = '先登录，然后导入一套试卷。';
}

async function refreshAll() {
  await Promise.all([refreshPapers(), refreshStats(), loadWrongbook(false), loadFavorites(false)]);
  renderLearningPath();
  renderAnalytics();
}

async function refreshStats() {
  if (!appState.token) return;
  const stats = await api('/api/stats');
  $('#statPapers').textContent = stats.papers;
  $('#statAnswers').textContent = stats.answers;
  $('#statAccuracy').textContent = `${stats.accuracy}%`;
  $('#statWrong').textContent = stats.wrong;
  $('#statDue').textContent = stats.due;
  $('#todayAdvice').textContent = stats.due
    ? `有 ${stats.due} 道题该复习，先稳住记忆曲线。`
    : stats.wrong
      ? `有 ${stats.wrong} 道错题待整理，先做错因归类。`
      : '状态不错，可以开始一轮新题速刷。';
}

async function refreshPapers() {
  if (!appState.token) return;
  const result = await api('/api/papers');
  appState.papers = result.papers || [];
  renderPaperCards();
  renderPaperSelect();
}

function renderGuestState() {
  $('#paperCards').innerHTML = '<div class="paper-card">请先注册或登录，系统会把题库保存到 SQLite 数据库。</div>';
  $('#learningPath').innerHTML = '<div class="path-card">登录后显示学习路线。</div>';
}

function renderPaperCards() {
  const container = $('#paperCards');
  if (!appState.papers.length) {
    container.innerHTML = '<div class="paper-card">还没有试卷。进入题库管理，粘贴题目后保存。</div>';
    return;
  }
  const groups = groupPapers(appState.papers);
  container.innerHTML = Object.entries(groups).map(([groupName, papers]) => `
    <section class="paper-group">
      <div class="paper-group-title">
        <strong>${escapeHtml(groupName)}</strong>
        <span>${papers.length} 套试卷</span>
      </div>
      ${papers.map((paper) => `
        <article class="paper-card">
          <strong>${escapeHtml(paper.title)}</strong>
          <div class="meta-line">
            <span>${escapeHtml(paper.category)}</span>
            <span>${paper.question_count} 题</span>
            <span>${new Date(paper.created_at).toLocaleString()}</span>
          </div>
          <div class="button-row compact">
            <button class="btn primary" data-paper-id="${paper.id}">开始刷题</button>
            <button class="btn ghost" data-paper-preview="${paper.id}">查看题目</button>
          </div>
        </article>
      `).join('')}
    </section>
  `).join('');
  $$('[data-paper-id]').forEach((button) => {
    button.addEventListener('click', () => {
      $('#paperSelect').value = button.dataset.paperId;
      routeTo('practice');
      startPractice();
    });
  });
  $$('[data-paper-preview]').forEach((button) => {
    button.addEventListener('click', async () => {
      const paper = await api(`/api/papers/${button.dataset.paperPreview}`);
      openImportPreview(`试卷预览：${paper.title}`, paper.questions);
      $('#importStudio')?.classList.remove('hidden');
      routeTo('bank');
      $('#importStudio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderBankGroups() {
  const container = $('#bankGroupList');
  if (!container) return;
  if (!appState.papers.length) {
    container.innerHTML = '<div class="paper-card">还没有题库。点击“添加题库”导入第一套试卷。</div>';
    return;
  }
  const groups = groupPapers(appState.papers);
  container.innerHTML = Object.entries(groups).map(([groupName, papers], index) => `
    <section class="bank-group-card">
      <img class="bank-visual-badge" src="${characterAssets[index % characterAssets.length]}" alt="">
      <div class="bank-group-head">
        <strong>${escapeHtml(groupName)}</strong>
        <span>${papers.length} 套 · ${papers.reduce((sum, paper) => sum + Number(paper.question_count || 0), 0)} 题</span>
      </div>
      <div class="bank-paper-list">
        ${papers.map((paper) => `
          <article class="bank-paper-item">
            <button class="bank-paper-main" type="button" data-bank-start="${paper.id}">
              <span>${escapeHtml(paper.title)}</span>
              <small>${escapeHtml(paper.category)} · ${paper.question_count}题</small>
            </button>
            <div class="bank-paper-actions">
              <button class="btn small ghost" type="button" data-bank-edit-meta="${paper.id}">编辑信息</button>
              <button class="btn small ghost" type="button" data-bank-edit-questions="${paper.id}">编辑题目</button>
              <button class="btn small danger" type="button" data-bank-delete-paper="${paper.id}">删除试卷</button>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');
  $$('[data-bank-start]').forEach((button) => {
    button.addEventListener('click', () => {
      $('#paperSelect').value = button.dataset.bankStart;
      routeTo('practice');
      startPractice();
    });
  });
  $$('[data-bank-edit-meta], [data-bank-edit-questions]').forEach((button) => {
    button.addEventListener('click', () => {
      openPaperEditor(button.dataset.bankEditMeta || button.dataset.bankEditQuestions);
    });
  });
  $$('[data-bank-delete-paper]').forEach((button) => {
    button.addEventListener('click', () => deletePaper(button.dataset.bankDeletePaper));
  });
}

async function deletePaper(paperId) {
  if (!appState.token) return openAuth('login');
  if (!paperId) return;
  const paper = appState.papers.find((item) => item.id === paperId);
  const title = paper?.title ? `《${paper.title}》` : '这套试卷';
  if (!confirm(`确定删除${title}吗？删除后题目、错题、收藏和答题记录会一起清除。`)) return;
  try {
    await api(`/api/papers/${paperId}`, { method: 'DELETE' });
    if (appState.editingPaper?.id === paperId) closePaperEditor();
    if (appState.currentPaper?.id === paperId) {
      appState.currentPaper = null;
      appState.session = null;
    }
    await Promise.all([refreshPapers(), refreshStats(), loadWrongbook(false), loadFavorites(false)]);
    renderBankGroups();
    toast('试卷已删除。');
  } catch (error) {
    toast(error.message, true);
  }
}

async function openPaperEditor(paperId) {
  if (!appState.token) return openAuth('login');
  try {
    const paper = await api(`/api/papers/${paperId}`);
    appState.editingPaper = paper;
    renderPaperEditor(paper);
    $('#paperEditPanel')?.classList.remove('hidden');
    $('#paperEditPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    toast(error.message, true);
  }
}

function closePaperEditor() {
  appState.editingPaper = null;
  const panel = $('#paperEditPanel');
  if (panel) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }
}

function renderPaperEditor(paper) {
  const panel = $('#paperEditPanel');
  if (!panel || !paper) return;
  panel.innerHTML = `
    <div class="panel-title">
      <div>
        <h2>编辑题库内容</h2>
        <p>可修改试卷名称、分类、分组，也可以逐题调整题干、选项、答案和解析。</p>
      </div>
      <button class="btn ghost" type="button" data-close-paper-editor>关闭</button>
    </div>
    <section class="paper-meta-editor">
      <label>试卷名<input id="editPaperTitle" value="${escapeHtml(paper.title || '')}"></label>
      <label>分类<input id="editPaperCategory" value="${escapeHtml(paper.category || '')}"></label>
      <label>分组<input id="editPaperGroup" value="${escapeHtml(paper.group_name || '默认分组')}"></label>
      <button class="btn primary" type="button" data-save-paper-meta>保存试卷信息</button>
    </section>
    <div class="question-editor-list">
      ${(paper.questions || []).length
        ? paper.questions.map((question, index) => renderQuestionEditor(question, index)).join('')
        : '<div class="paper-card">这套试卷暂无题目，可以删除试卷或重新导入题目。</div>'}
    </div>
  `;
  panel.querySelector('[data-close-paper-editor]')?.addEventListener('click', closePaperEditor);
  panel.querySelector('[data-save-paper-meta]')?.addEventListener('click', savePaperMeta);
  panel.querySelectorAll('[data-save-edit-question]').forEach((button) => {
    button.addEventListener('click', () => saveEditableQuestion(button.closest('.question-editor-card')));
  });
  panel.querySelectorAll('[data-delete-edit-question]').forEach((button) => {
    button.addEventListener('click', () => deleteEditableQuestion(button.closest('.question-editor-card')));
  });
}

function renderQuestionEditor(question, index) {
  return `
    <article class="question-editor-card" data-question-id="${escapeHtml(question.id)}">
      <div class="question-editor-head">
        <strong>第 ${index + 1} 题</strong>
        <span>${typeLabel(question.type)}</span>
      </div>
      <label>题干<textarea data-edit-field="question" rows="3">${escapeHtml(question.question || '')}</textarea></label>
      <div class="form-row compact-editor-row">
        <label>题型
          <select data-edit-field="type">
            ${['single', 'multi', 'judge', 'blank'].map((type) => `<option value="${type}" ${question.type === type ? 'selected' : ''}>${typeLabel(type)}</option>`).join('')}
          </select>
        </label>
        <label>答案<input data-edit-field="answer" value="${escapeHtml(question.answer || '')}"></label>
        <label>分值<input data-edit-field="score" type="number" min="0" step="0.5" value="${escapeHtml(question.score || 1)}"></label>
      </div>
      <label>选项<textarea class="question-option-editor" data-edit-field="options" rows="5" placeholder="每行一个选项，不需要写 A. B.">${escapeHtml((question.options || []).join('\n'))}</textarea></label>
      <label>解析<textarea data-edit-field="analysis" rows="4">${escapeHtml(question.analysis || '')}</textarea></label>
      <div class="button-row compact">
        <button class="btn success" type="button" data-save-edit-question>保存这道题</button>
        <button class="btn danger" type="button" data-delete-edit-question>删除题目</button>
      </div>
    </article>
  `;
}

async function savePaperMeta() {
  if (!appState.editingPaper) return;
  try {
    const result = await api(`/api/papers/${appState.editingPaper.id}`, {
      method: 'PATCH',
      body: {
        title: $('#editPaperTitle').value.trim(),
        category: $('#editPaperCategory').value.trim(),
        group_name: $('#editPaperGroup').value.trim()
      }
    });
    appState.editingPaper = result.paper;
    await refreshPapers();
    renderBankGroups();
    renderPaperEditor(result.paper);
    toast('试卷信息已保存。');
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveEditableQuestion(card) {
  if (!card || !appState.editingPaper) return;
  const questionId = card.dataset.questionId;
  const read = (field) => card.querySelector(`[data-edit-field="${field}"]`);
  const options = (read('options')?.value || '')
    .split(/\n+/)
    .map((item) => item.trim().replace(/^[A-H][\.、]\s*/, ''))
    .filter(Boolean);
  try {
    const result = await api(`/api/questions/${questionId}`, {
      method: 'PATCH',
      body: {
        question: read('question')?.value.trim(),
        type: read('type')?.value,
        answer: read('answer')?.value.trim(),
        score: read('score')?.value,
        options,
        analysis: read('analysis')?.value.trim()
      }
    });
    const index = appState.editingPaper.questions.findIndex((item) => item.id === questionId);
    if (index >= 0) appState.editingPaper.questions[index] = result.question;
    card.querySelector('.question-editor-head span').textContent = typeLabel(result.question.type);
    toast('题目已保存。');
  } catch (error) {
    toast(error.message, true);
  }
}

async function deleteEditableQuestion(card) {
  if (!card || !appState.editingPaper) return;
  const questionId = card.dataset.questionId;
  const title = card.querySelector('[data-edit-field="question"]')?.value.trim() || '这道题';
  if (!confirm(`确定删除“${title.slice(0, 28)}”吗？关联错题、收藏和答题记录会一起清除。`)) return;
  try {
    const result = await api(`/api/questions/${questionId}`, { method: 'DELETE' });
    appState.editingPaper.questions = appState.editingPaper.questions.filter((item) => item.id !== questionId);
    appState.editingPaper.question_count = result.question_count ?? appState.editingPaper.questions.length;
    await Promise.all([refreshPapers(), refreshStats(), loadWrongbook(false), loadFavorites(false)]);
    const latest = await api(`/api/papers/${appState.editingPaper.id}`);
    appState.editingPaper = latest;
    renderBankGroups();
    renderPaperEditor(latest);
    toast('题目已删除。');
  } catch (error) {
    toast(error.message, true);
  }
}

function toggleImportStudio() {
  const studio = $('#importStudio');
  studio.classList.toggle('hidden');
  if (!studio.classList.contains('hidden')) {
    setTimeout(() => studio.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}

function renderPaperSelect() {
  const groups = groupPapers(appState.papers);
  $('#paperSelect').innerHTML = Object.entries(groups).map(([groupName, papers]) => `
    <optgroup label="${escapeHtml(groupName)}">
      ${papers.map((paper) => `<option value="${paper.id}">${escapeHtml(paper.title)}（${paper.question_count}题）</option>`).join('')}
    </optgroup>
  `).join('');
}

function renderLearningPath() {
  $('#learningPath').innerHTML = [
    ['1. 导入试卷', '先把 PDF/Word 复制出的题目文本粘贴进导入区，自定义正则或 AI 识别。'],
    ['2. 首轮速刷', '用键盘完成一轮筛题，把不会的题自动沉淀到错题本。'],
    ['3. 错因整理', '给错题打上概念不清、审题失误、记忆混淆等原因。'],
    ['4. 间隔复习', '系统按答题结果安排复习，错题短间隔，熟题长间隔。']
  ].map(([title, text]) => `<div class="path-card"><strong>${title}</strong><p>${text}</p></div>`).join('');
}

function groupPapers(papers) {
  return papers.reduce((groups, paper) => {
    const groupName = paper.group_name || paper.groupName || '默认分组';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(paper);
    return groups;
  }, {});
}

function loadImportExample() {
  $('#paperTitle').value = '计算机网络高频练习';
  $('#paperCategory').value = '计算机';
  $('#paperGroup').value = '网络基础';
  $('#importText').value = `1.题目 Internet 与 WWW 的关系是？
A. WWW 是 Internet 上的一个应用服务
B. Internet 与 WWW 没有关系
C. WWW 是一种硬件协议
D. 二者完全相同
答案:A
解析:WWW 是运行在 Internet 上的信息服务之一。

2.题目 DNS 的主要作用是？
A. 加密通信
B. 域名与 IP 地址转换
C. 压缩图片
D. 管理浏览器插件
答案:B
解析:DNS 将易记域名解析为 IP 地址。`;
  toast('已填入示例格式。');
}

async function parseImport() {
  try {
    const result = await api('/api/import/parse', {
      method: 'POST',
      body: { text: $('#importText').value }
    });
    appState.parsedQuestions = result.questions || [];
    openImportPreview('标准格式兜底解析', appState.parsedQuestions);
  } catch (error) {
    toast(error.message, true);
  }
}

async function aiParseImport() {
  try {
    const result = await api('/api/import/ai', {
      method: 'POST',
      body: { text: $('#importText').value }
    });
    if (result.ai_account) renderAiAccount(result.ai_account);
    appState.parsedQuestions = result.questions || [];
    openImportPreview(result.mode === 'ai' ? 'AI 自动识别' : 'AI 未配置，已用规则兜底', appState.parsedQuestions);
  } catch (error) {
    toast(error.message, true);
  }
}

function openImportPreview(title, questions) {
  appState.importPreviewTitle = title;
  appState.importPreviewQuestions = Array.isArray(questions) ? questions : [];
  appState.importPreviewIndex = 0;
  renderImportResult();
}

function setImportPreviewIndex(index, shouldScroll = false) {
  const total = appState.importPreviewQuestions.length;
  if (!total) return;
  appState.importPreviewIndex = Math.max(0, Math.min(total - 1, index));
  renderImportResult();
  if (shouldScroll) {
    $('#importPreviewStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderImportResult() {
  const title = appState.importPreviewTitle || '题目预览';
  const questions = appState.importPreviewQuestions || [];
  const container = $('#importResult');
  if (!questions.length) {
    container.innerHTML = `<div class="import-result-empty">${escapeHtml(title)}：没有识别到题目，请检查格式或原文内容。</div>`;
    return;
  }
  appState.importPreviewIndex = Math.max(0, Math.min(appState.importPreviewIndex, questions.length - 1));
  const current = questions[appState.importPreviewIndex];
  const analysisCount = questions.filter((item) => String(item.analysis || '').trim()).length;
  const optionfulCount = questions.filter((item) => Array.isArray(item.options) && item.options.length).length;
  container.innerHTML = `
    <div class="import-result-head">
      <div>
        <strong>${escapeHtml(title)}：识别到 ${questions.length} 道题</strong>
        <div class="meta-line">
          <span>${analysisCount} 题带解析</span>
          <span>${optionfulCount} 题带选项</span>
          <span>当前预览第 ${appState.importPreviewIndex + 1} 题</span>
        </div>
      </div>
      <div class="button-row compact">
        <button class="btn ghost" type="button" data-import-preview-step="-1" ${appState.importPreviewIndex === 0 ? 'disabled' : ''}>上一题</button>
        <button class="btn ghost" type="button" data-import-preview-step="1" ${appState.importPreviewIndex >= questions.length - 1 ? 'disabled' : ''}>下一题</button>
      </div>
    </div>
    ${renderImportPracticePreview(current, appState.importPreviewIndex, questions.length)}
    ${renderImportPreviewNav(questions)}
  `;
  $$('[data-import-preview-step]').forEach((button) => {
    button.addEventListener('click', () => {
      setImportPreviewIndex(appState.importPreviewIndex + Number(button.dataset.importPreviewStep || 0), true);
    });
  });
  $$('[data-import-preview-index]').forEach((button) => {
    button.addEventListener('click', () => {
      setImportPreviewIndex(Number(button.dataset.importPreviewIndex || 0), true);
    });
  });
}

function renderImportPracticePreview(question, index, total) {
  if (!question) return '';
  const answerSet = new Set(String(question.answer || '').split('').filter(Boolean));
  const optionList = Array.isArray(question.options) ? question.options : [];
  const optionMarkup = question.type === 'blank'
    ? `<div class="blank-answer import-preview-blank">${escapeHtml(question.answer || '未识别答案')}</div>`
    : optionList.map((option, optionIndex) => {
      const letter = String.fromCharCode(65 + optionIndex);
      const classes = ['option-button', 'preview-option'];
      if (answerSet.has(letter)) classes.push('correct');
      return `
        <div class="${classes.join(' ')}">
          <span class="option-key">${letter}</span>
          <span>${escapeHtml(option)}</span>
        </div>
      `;
    }).join('') || '<div class="import-preview-empty">这道题没有识别出选项，请重点检查原文格式。</div>';
  return `
    <article id="importPreviewStage" class="import-preview-stage">
      <div class="question-meta">
        <span>第 ${index + 1} / ${total} 题</span>
        <span>${typeLabel(question.type)}</span>
        <span>${optionList.length || 0} 个选项</span>
      </div>
      <h3 class="import-preview-title">${escapeHtml(question.question || '未识别题干')}</h3>
      <div class="option-list import-option-list">${optionMarkup}</div>
      <div class="preview-answer-row">
        <span class="preview-answer-chip">参考答案：${escapeHtml(question.answer || '未识别')}</span>
        <span class="preview-answer-chip subtle">${String(question.analysis || '').trim() ? '带解析' : '暂无解析'}</span>
      </div>
      <div class="analysis-panel import-analysis-panel">
        <strong class="analysis-block-title">参考解析</strong>
        <div class="analysis-content">${escapeHtml(question.analysis || '暂无解析，保存后也可以在刷题页补充自己的解析。')}</div>
      </div>
    </article>
  `;
}

function renderImportPreviewNav(questions) {
  return `
    <div class="import-preview-nav">
      ${questions.map((question, index) => `
        <button
          class="import-preview-mini ${index === appState.importPreviewIndex ? 'active' : ''}"
          type="button"
          data-import-preview-index="${index}"
        >
          <strong>${index + 1}. ${escapeHtml(question.question || '未识别题干')}</strong>
          <span>${typeLabel(question.type)} · 答案 ${escapeHtml(question.answer || '未识别')}</span>
        </button>
      `).join('')}
    </div>
  `;
}

async function savePaper() {
  if (!appState.token) return openAuth('login');
  if (!appState.parsedQuestions.length) {
    await aiParseImport();
  }
  if (!appState.parsedQuestions.length) return;
  try {
    await api('/api/papers', {
      method: 'POST',
      body: {
        title: $('#paperTitle').value.trim() || generatePaperTitle('智能导入卷', appState.parsedQuestions.length),
        category: $('#paperCategory').value.trim() || '综合',
        group_name: $('#paperGroup').value.trim() || '默认分组',
        source: $('#paperSource').value,
        questions: appState.parsedQuestions
      }
    });
    toast('试卷已保存到数据库。');
    appState.parsedQuestions = [];
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  }
}

async function quickPractice() {
  routeTo('practice');
  if (!appState.papers.length) {
    toast('先导入试卷，再开始刷题。', true);
    routeTo('bank');
    return;
  }
  await startPractice();
}

async function startPractice() {
  if (!appState.token) return openAuth('login');
  const paperId = $('#paperSelect').value || appState.papers[0]?.id;
  if (!paperId) return toast('请先添加试卷。', true);
  try {
    appState.currentPaper = await api(`/api/papers/${paperId}`);
    appState.session = await api('/api/sessions', {
      method: 'POST',
      body: { paperId, mode: $('#practiceMode').value }
    });
    appState.index = 0;
    appState.answers = {};
    appState.checked = {};
    appState.startedAt = Date.now();
    startTimer();
    setPracticeVisible(true);
    renderQuestion();
    scrollToPracticeStage();
  } catch (error) {
    toast(error.message, true);
  }
}

async function startWrongPractice() {
  const result = await api('/api/wrongbook');
  const items = result.wrongbook || [];
  if (!items.length) return toast('错题本为空。', true);
  appState.currentPaper = {
    id: 'wrongbook',
    title: '错题重练',
    questions: items.map((item) => ({
      id: item.question_id,
      question: item.question,
      options: item.options,
      answer: item.answer,
      analysis: item.analysis,
      type: item.type
    }))
  };
  appState.session = { id: 'wrongbook_local', mode: 'practice' };
  appState.index = 0;
  appState.answers = {};
  appState.checked = {};
  setPracticeVisible(true);
  renderQuestion();
  routeTo('practice');
  scrollToPracticeStage();
}

async function createWrongPaper() {
  if (!appState.token) return openAuth('login');
  if (!appState.wrongbookItems.length) {
    const wrongResult = await api('/api/wrongbook');
    appState.wrongbookItems = wrongResult.wrongbook || [];
  }
  if (!appState.favoriteItems.length) {
    const favoriteResult = await api('/api/favorites');
    appState.favoriteItems = favoriteResult.favorites || [];
  }
  const selectedItems = collectSelectedPaperItems();
  updateWrongPaperCount();
  if (!selectedItems.length) return toast('请先在错题记录或收藏题目里勾选要组卷的题。', true);
  const title = readActivePaperTitle() || generatePaperTitle('错题自定义卷', selectedItems.length);

  try {
    const savedPaper = await api('/api/papers', {
      method: 'POST',
      body: {
        title,
        category: '错题收藏组卷',
        group_name: '错题自定义卷',
        source: 'wrongbook_custom',
        questions: selectedItems.map((item) => ({
          question: item.question,
          options: item.options || [],
          answer: item.answer,
          analysis: item.analysis || '',
          type: item.type || 'single',
          tags: ['错题组卷'],
          score: 1
        }))
      }
    });
    if (shouldClearGeneratedSources()) {
      await clearGeneratedSources(selectedItems);
    }
    await refreshPapers();
    $('#paperSelect').value = savedPaper.id;
    appState.session = null;
    routeTo('practice');
    await startPractice();
    toast(`已保存到题库“${title}”，共 ${selectedItems.length} 题。`);
  } catch (error) {
    toast(error.message, true);
  }
}

function collectSelectedPaperItems() {
  syncSelectedPaperItemsFromDom();
  const selectedKeys = Array.from(appState.selectedPaperItems);
  const wrongByKey = new Map(appState.wrongbookItems.map((item) => [`wrong:${item.id}`, {
    source: 'wrong',
    sourceId: item.id,
    question_id: item.question_id,
    question: item.question,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    type: item.type,
    wrong_count: item.wrong_count
  }]));
  const favoriteByKey = new Map(appState.favoriteItems.map((item) => [`favorite:${item.question_id}`, {
    source: 'favorite',
    sourceId: item.question_id,
    question_id: item.question_id,
    question: item.question,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    type: item.type,
    wrong_count: 0
  }]));
  const sourceMaps = new Map([...wrongByKey, ...favoriteByKey]);
  const selected = selectedKeys
    .map((key) => sourceMaps.get(key))
    .filter(Boolean);
  const unique = new Map();
  selected.forEach((item) => {
    const sourceInfo = { source: item.source, sourceId: item.sourceId };
    if (unique.has(item.question_id)) {
      unique.get(item.question_id).sources.push(sourceInfo);
      return;
    }
    unique.set(item.question_id, { ...item, sources: [sourceInfo] });
  });
  return Array.from(unique.values());
}

function syncSelectedPaperItemsFromDom() {
  $$('[data-paper-pick]').forEach((input) => {
    if (input.checked) {
      appState.selectedPaperItems.add(input.dataset.paperPick);
    } else {
      appState.selectedPaperItems.delete(input.dataset.paperPick);
    }
  });
}

function updateWrongPaperCount() {
  const count = collectSelectedPaperItems().length;
  $$('[data-paper-count]').forEach((countInput) => {
    countInput.value = String(count);
  });
  return count;
}

function activeView() {
  return $('.app-view.active');
}

function readActivePaperTitle() {
  const activeTitle = activeView()?.querySelector('[data-paper-title]')?.value.trim();
  return activeTitle || $('[data-paper-title]')?.value.trim() || '';
}

function shouldClearGeneratedSources() {
  const activeClear = activeView()?.querySelector('[data-paper-clear]');
  return Boolean(activeClear?.checked || $$('[data-paper-clear]').some((input) => input.checked));
}

function bindPaperPickCount() {
  $$('[data-paper-pick]').forEach((input) => {
    if (input.dataset.paperPickBound) return;
    input.dataset.paperPickBound = '1';
    input.addEventListener('change', handlePaperPickChange);
  });
  updateWrongPaperCount();
}

function handlePaperPickChange(event) {
  const input = event.currentTarget;
  if (input.checked) {
    appState.selectedPaperItems.add(input.dataset.paperPick);
  } else {
    appState.selectedPaperItems.delete(input.dataset.paperPick);
  }
  updateWrongPaperCount();
  renderPaperPagination('wrong');
  renderPaperPagination('favorite');
}

function paperPickKey(source, item) {
  return source === 'wrong' ? `wrong:${item.id}` : `favorite:${item.question_id}`;
}

function paperListBySource(source) {
  return source === 'wrong' ? appState.wrongbookItems : appState.favoriteItems;
}

function paperPageStateKey(source) {
  return source === 'wrong' ? 'wrongbookPage' : 'favoritePage';
}

function paginatePaperItems(items, page, size = WRONGBOOK_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    page: safePage,
    totalPages,
    start,
    items: items.slice(start, start + size)
  };
}

function currentPaperPage(source) {
  const pageKey = paperPageStateKey(source);
  const pagination = paginatePaperItems(paperListBySource(source), appState[pageKey]);
  appState[pageKey] = pagination.page;
  return pagination;
}

function renderPaperPagination(source) {
  const containers = source === 'wrong'
    ? [$('#wrongbookPager'), $('#wrongbookPagerBottom')]
    : [$('#favoritePager'), $('#favoritePagerBottom')];
  const liveContainers = containers.filter(Boolean);
  if (!liveContainers.length) return;
  const list = paperListBySource(source);
  if (!list.length) {
    liveContainers.forEach((container) => { container.innerHTML = ''; });
    return;
  }
  const pagination = currentPaperPage(source);
  const pageKeys = pagination.items.map((item) => paperPickKey(source, item));
  const selectedOnPage = pageKeys.filter((key) => appState.selectedPaperItems.has(key)).length;
  const allSelected = pageKeys.length > 0 && selectedOnPage === pageKeys.length;
  const label = source === 'wrong' ? '错题' : '收藏';
  const selectedTotal = collectSelectedPaperItems().length;

  container.innerHTML = `
    <div class="page-summary">
      <strong>${label}分页</strong>
      <span>第 ${pagination.page} / ${pagination.totalPages} 页 · 本页 ${pagination.items.length} 题 · 已选 ${selectedTotal} 题</span>
    </div>
    <div class="button-row compact">
      <button class="btn small ghost" data-page-move="${source}:prev" ${pagination.page <= 1 ? 'disabled' : ''}>上一页</button>
      <button class="btn small primary" data-select-page="${source}" data-select-page-checked="${allSelected ? 'false' : 'true'}">${allSelected ? '取消本页' : '本页全选'}</button>
      <button class="btn small ghost" data-page-move="${source}:next" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>下一页</button>
    </div>
  `;

  liveContainers.forEach((container) => {
    container.innerHTML = toolbarHtml;
    container.querySelectorAll('[data-page-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const [pageSource, direction] = button.dataset.pageMove.split(':');
        changePaperPage(pageSource, direction === 'next' ? 1 : -1);
      });
    });
    container.querySelectorAll('[data-select-page]').forEach((button) => {
      button.addEventListener('click', () => {
        toggleCurrentPageSelection(button.dataset.selectPage, button.dataset.selectPageChecked === 'true');
      });
    });
  });
}

function changePaperPage(source, delta) {
  syncSelectedPaperItemsFromDom();
  const pageKey = paperPageStateKey(source);
  const list = paperListBySource(source);
  const nextPage = paginatePaperItems(list, appState[pageKey] + delta).page;
  appState[pageKey] = nextPage;
  if (source === 'wrong') {
    renderWrongbookList(appState.wrongbookItems);
  } else {
    renderFavorites(appState.favoriteItems);
  }
  const container = source === 'wrong' ? $('#wrongbookPager') : $('#favoritePager');
  setTimeout(() => container?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function toggleCurrentPageSelection(source, checked) {
  const pagination = currentPaperPage(source);
  pagination.items.forEach((item) => {
    const key = paperPickKey(source, item);
    if (checked) {
      appState.selectedPaperItems.add(key);
    } else {
      appState.selectedPaperItems.delete(key);
    }
  });
  if (source === 'wrong') {
    renderWrongbookList(appState.wrongbookItems);
  } else {
    renderFavorites(appState.favoriteItems);
  }
  renderPaperPagination(source === 'wrong' ? 'favorite' : 'wrong');
  updateWrongPaperCount();
}

async function clearGeneratedSources(items) {
  const sources = items.flatMap((item) => item.sources || [{ source: item.source, sourceId: item.sourceId }]);
  const wrongIds = sources.filter((item) => item.source === 'wrong').map((item) => item.sourceId);
  const favoriteIds = sources.filter((item) => item.source === 'favorite').map((item) => item.sourceId);
  await Promise.all([
    ...wrongIds.map((id) => api(`/api/wrongbook/${id}`, { method: 'DELETE' })),
    ...favoriteIds.map((id) => api(`/api/questions/${id}/favorite`, { method: 'PATCH', body: { favorite: false } }))
  ]);
  appState.wrongbookItems = appState.wrongbookItems.filter((item) => !wrongIds.includes(item.id));
  appState.favoriteItems = appState.favoriteItems.filter((item) => !favoriteIds.includes(item.question_id));
  sources.forEach((item) => appState.selectedPaperItems.delete(`${item.source}:${item.sourceId}`));
  appState.favoriteIds = new Set(appState.favoriteItems.map((item) => item.question_id));
  renderWrongbookList(appState.wrongbookItems);
  renderFavorites(appState.favoriteItems);
  updateWrongPaperCount();
}

function generatePaperTitle(prefix, count) {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join('');
  return `${prefix}_${date}_${time}_${count || 0}题`;
}

async function finishSession() {
  if (!appState.session) {
    toast('还没有开始刷题。', true);
    return;
  }

  const localTotal = appState.currentPaper?.questions?.length || 0;
  const localAnswered = Object.keys(appState.checked).length;
  if (appState.session.id === 'wrongbook_local') {
    toast(`本次错题练习已提交：完成 ${localAnswered}/${localTotal}。`);
    await refreshStats();
    return;
  }

  try {
    const result = await api(`/api/sessions/${appState.session.id}/finish`, {
      method: 'POST',
      body: {}
    });
    clearInterval(appState.timer);
    toast(`已提交：完成 ${result.answered}/${result.total}，正确率 ${result.accuracy}%。`);
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderQuestion() {
  const question = currentQuestion();
  if (!question) return;
  setPracticeVisible(true);
  appState.selectedAnswer = appState.answers[question.id] || '';
  $('#questionIndex').textContent = `第 ${appState.index + 1} / ${appState.currentPaper.questions.length} 题`;
  $('#questionType').textContent = typeLabel(question.type);
  $('#questionTitle').textContent = question.question;
  $('#blankAnswer').classList.toggle('hidden', question.type !== 'blank');
  $('#blankAnswer').value = question.type === 'blank' ? appState.selectedAnswer : '';
  $('#blankAnswer').oninput = () => {
    appState.answers[question.id] = $('#blankAnswer').value.trim();
    clearQuestionFeedback(question.id);
    renderAnswerSheet();
    updatePracticeStats();
  };
  $('#analysisPanel').classList.add('hidden');
  $('#analysisPanel').ondblclick = editAnalysisPanel;
  $('#answerFeedback').classList.add('hidden');

  $('#optionList').innerHTML = question.type === 'blank' ? '' : question.options.map((option, index) => {
    const letter = String.fromCharCode(65 + index);
    const selected = appState.selectedAnswer.includes(letter);
    const checked = appState.checked[question.id];
    const classes = ['option-button'];
    if (selected) classes.push('selected');
    if (checked && question.answer.includes(letter)) classes.push('correct');
    if (checked && selected && !question.answer.includes(letter)) classes.push('wrong');
    return `<button class="${classes.join(' ')}" data-option="${letter}"><span class="option-key">${letter}</span><span>${escapeHtml(option)}</span></button>`;
  }).join('');
  $$('[data-option]').forEach((button) => button.addEventListener('click', () => handleOptionActivate(button.dataset.option)));
  if (appState.checked[question.id]) showFeedback(question, appState.checked[question.id]);
  updateFavoriteButtons();
  renderAnswerSheet();
  updatePracticeStats();
}

function setPracticeVisible(visible) {
  $('.practice-stage')?.classList.toggle('hidden', !visible);
  $('.mobile-practice-bar')?.classList.toggle('hidden', !visible);
}

function scrollToPracticeStage() {
  setTimeout(() => {
    $('#practiceStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function currentQuestion() {
  return appState.currentPaper?.questions?.[appState.index] || null;
}

function isQuestionFavorite(questionId) {
  return appState.favoriteIds.has(questionId);
}

async function toggleFavoriteCurrent() {
  if (!appState.token) return openAuth('login');
  const question = currentQuestion();
  if (!question) return toast('还没有可收藏的题目。', true);
  const favorite = !isQuestionFavorite(question.id);
  try {
    const result = await api(`/api/questions/${question.id}/favorite`, {
      method: 'PATCH',
      body: { favorite }
    });
    result.favorite ? appState.favoriteIds.add(question.id) : appState.favoriteIds.delete(question.id);
    updateFavoriteButtons();
    renderFavorites();
    toast(result.favorite ? '已收藏这道题。' : '已取消收藏。');
  } catch (error) {
    toast(error.message, true);
  }
}

function updateFavoriteButtons() {
  const question = currentQuestion();
  const favorite = question ? isQuestionFavorite(question.id) : false;
  [$('#favoriteButton'), $('#mobileFavoriteButton')].forEach((button) => {
    if (!button) return;
    button.classList.toggle('active', favorite);
    button.textContent = favorite ? '已收藏' : '收藏';
  });
}

function chooseOption(letter) {
  const question = currentQuestion();
  if (!question) return;
  const previousAnswer = appState.answers[question.id] || '';
  if (question.type === 'multi') {
    const set = new Set((appState.answers[question.id] || '').split('').filter(Boolean));
    set.has(letter) ? set.delete(letter) : set.add(letter);
    appState.answers[question.id] = Array.from(set).sort().join('');
  } else {
    appState.answers[question.id] = letter;
  }
  if (previousAnswer !== appState.answers[question.id]) {
    clearQuestionFeedback(question.id);
  }
  renderQuestion();
}

function handleOptionActivate(letter) {
  const question = currentQuestion();
  if (!question) return;
  const checked = appState.checked[question.id];
  if (checked) {
    finishOrAdvance();
    return;
  }
  const alreadySelected = (appState.answers[question.id] || '').includes(letter);
  chooseOption(letter);
  if (shouldJudgeImmediately(question)) {
    submitAnswer();
  } else if (alreadySelected) {
    submitAnswer({ autoAdvance: true });
  }
}

function shouldJudgeImmediately(question) {
  return question.type !== 'blank' && $('#practiceMode').value === 'practice';
}

function clearQuestionFeedback(questionId) {
  delete appState.checked[questionId];
  $('#answerFeedback')?.classList.add('hidden');
  $('#analysisPanel')?.classList.add('hidden');
  $('#analysisPanel').textContent = '';
}

async function submitAnswer(options = {}) {
  const question = currentQuestion();
  if (!question) return;
  if (question.type === 'blank') {
    appState.answers[question.id] = $('#blankAnswer').value.trim();
  }
  const answer = appState.answers[question.id];
  if (!answer) return toast('请先作答。', true);

  try {
    let result;
    if (appState.session.id === 'wrongbook_local') {
      result = {
        correct: normalizeAnswer(answer) === normalizeAnswer(question.answer),
        answer: question.answer,
        analysis: question.analysis,
        question
      };
    } else {
      result = await api('/api/answer', {
        method: 'POST',
        body: {
          sessionId: appState.session.id,
          questionId: question.id,
          answer,
          timeSpentMs: Date.now() - appState.startedAt
        }
      });
    }
    appState.checked[question.id] = result;
    showFeedback(question, result);
    renderQuestion();
    refreshStats();
    const shouldAdvance = options.autoAdvance;
    if (shouldAdvance) {
      setTimeout(finishOrAdvance, isExamMode() ? 120 : 420);
    }
  } catch (error) {
    toast(error.message, true);
  }
}

async function submitPaper() {
  try {
    const question = currentQuestion();
    if (question?.type === 'blank') {
      appState.answers[question.id] = $('#blankAnswer').value.trim();
    }
    await persistPendingAnswers();
    await finishSession();
  } catch (error) {
    toast(error.message, true);
  }
}

async function persistPendingAnswers() {
  if (!appState.session || appState.session.id === 'wrongbook_local' || !appState.currentPaper) return;
  const pending = appState.currentPaper.questions.filter((question) => (
    appState.answers[question.id] && !appState.checked[question.id]
  ));
  for (const question of pending) {
    const answer = appState.answers[question.id];
    const result = await api('/api/answer', {
      method: 'POST',
      body: {
        sessionId: appState.session.id,
        questionId: question.id,
        answer,
        timeSpentMs: Date.now() - appState.startedAt
      }
    });
    appState.checked[question.id] = result;
  }
}

function showFeedback(question, result) {
  $('#answerFeedback').className = `answer-feedback ${result.correct ? 'good' : 'bad'}`;
  $('#answerFeedback').textContent = isExamMode()
    ? '已记录答案，考试模式不显示正误。'
    : result.correct ? '回答正确，很稳。' : `回答错误，正确答案：${result.answer}`;
  if (!isExamMode()) {
    renderAnalysisPanel(result.analysis || question.analysis || '暂无解析，可以点击 AI 解析。');
  }
}

function isExamMode() {
  return $('#practiceMode').value === 'exam';
}

function finishOrAdvance() {
  if (!appState.currentPaper) return;
  if (appState.index >= appState.currentPaper.questions.length - 1) {
    finishSession();
    return;
  }
  nextQuestion();
}

function prevQuestion() {
  if (!appState.currentPaper) return;
  appState.index = Math.max(0, appState.index - 1);
  renderQuestion();
}

function nextQuestion() {
  if (!appState.currentPaper) return;
  appState.index = Math.min(appState.currentPaper.questions.length - 1, appState.index + 1);
  renderQuestion();
}

function showAnalysis() {
  const question = currentQuestion();
  if (!question) return;
  renderAnalysisPanel(question.analysis || '暂无解析，可以点击 AI 解析。');
}

async function aiExplainCurrent() {
  const question = currentQuestion();
  if (!question) return;
  const baseAnalysis = question.analysis || '暂无原解析，可以先看 AI 解析后再保存为本题解析。';
  renderAiAnalysisPanel(baseAnalysis, 'AI 正在生成解析...');
  try {
    const result = await api('/api/deepseek', {
      method: 'POST',
      body: {
        messages: [
          { role: 'system', content: '你是刷题解析老师，请给出简洁解析、错误选项原因、记忆技巧。' },
          { role: 'user', content: `题目：${question.question}\n选项：${question.options.map((o, i) => `${String.fromCharCode(65 + i)}.${o}`).join('\n')}\n答案：${question.answer}` }
        ]
      }
    });
    if (result.ai_account) renderAiAccount(result.ai_account);
    renderAiAnalysisPanel(baseAnalysis, result.content);
  } catch (error) {
    renderAiAnalysisPanel(baseAnalysis, `AI 暂不可用：${error.message}`);
  }
}

function renderAnalysisPanel(text) {
  const panel = $('#analysisPanel');
  panel.classList.remove('hidden', 'editing');
  panel.dataset.analysisText = text || '';
  panel.innerHTML = `
    <div class="analysis-content">${escapeHtml(text || '暂无解析，可以点击 AI 解析。')}</div>
    <small class="analysis-hint">双击这里可自定义解析，失焦自动保存，Ctrl+Enter 快速保存。</small>
  `;
  panel.ondblclick = editAnalysisPanel;
}

function renderAiAnalysisPanel(baseText, aiText) {
  const panel = $('#analysisPanel');
  panel.classList.remove('hidden', 'editing');
  panel.dataset.analysisText = baseText || '';
  panel.dataset.aiAnalysisText = aiText || '';
  panel.innerHTML = `
    <div class="analysis-block analysis-original">
      <strong class="analysis-block-title">原解析</strong>
      <div class="analysis-content">${escapeHtml(baseText || '暂无原解析。')}</div>
    </div>
    <div class="ai-analysis-card">
      <strong class="analysis-block-title">AI 解析</strong>
      <div class="analysis-content">${escapeHtml(aiText || '暂无 AI 解析。')}</div>
      <div class="button-row compact">
        <button class="btn ghost" type="button" data-edit-ai-analysis>编辑 AI 解析</button>
        <button class="btn primary" type="button" data-save-ai-analysis>保存为本题解析</button>
      </div>
    </div>
    <small class="analysis-hint">原解析不会被 AI 覆盖；可以编辑 AI 解析后保存到本题解析。</small>
  `;
  panel.ondblclick = null;
  panel.querySelector('.analysis-original')?.addEventListener('dblclick', editAnalysisPanel);
  panel.querySelector('[data-edit-ai-analysis]')?.addEventListener('click', editAiAnalysisPanel);
  panel.querySelector('[data-save-ai-analysis]')?.addEventListener('click', () => saveAiAnalysisAsQuestion(panel.dataset.aiAnalysisText || ''));
}

function editAiAnalysisPanel(event) {
  event?.stopPropagation();
  const panel = $('#analysisPanel');
  const baseText = panel.dataset.analysisText || '';
  const aiText = panel.dataset.aiAnalysisText || '';
  panel.classList.add('editing');
  panel.innerHTML = `
    <div class="analysis-block analysis-original">
      <strong class="analysis-block-title">原解析</strong>
      <div class="analysis-content">${escapeHtml(baseText || '暂无原解析。')}</div>
    </div>
    <div class="ai-analysis-card">
      <strong class="analysis-block-title">编辑 AI 解析</strong>
      <textarea class="analysis-editor" spellcheck="false" placeholder="整理 AI 解析后保存为本题解析。">${escapeHtml(aiText)}</textarea>
      <div class="button-row compact">
        <button class="btn primary" type="button" data-commit-ai-analysis>保存为本题解析</button>
        <button class="btn ghost" type="button" data-cancel-ai-analysis>取消</button>
      </div>
    </div>
    <small class="analysis-hint">Ctrl+Enter 保存，Esc 取消。</small>
  `;
  const editor = panel.querySelector('.analysis-editor');
  panel.querySelector('[data-commit-ai-analysis]')?.addEventListener('click', () => saveAiAnalysisAsQuestion(editor.value));
  panel.querySelector('[data-cancel-ai-analysis]')?.addEventListener('click', () => renderAiAnalysisPanel(baseText, aiText));
  editor.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key === 'Enter' && (keyEvent.ctrlKey || keyEvent.metaKey)) {
      keyEvent.preventDefault();
      saveAiAnalysisAsQuestion(editor.value);
    }
    if (keyEvent.key === 'Escape') {
      renderAiAnalysisPanel(baseText, aiText);
    }
  });
  editor.focus();
  editor.select();
}

function editAnalysisPanel() {
  const question = currentQuestion();
  const panel = $('#analysisPanel');
  if (!question || panel.classList.contains('hidden') || panel.classList.contains('editing')) return;
  const originalText = panel.dataset.analysisText || question.analysis || '';
  panel.classList.add('editing');
  panel.innerHTML = `
    <textarea class="analysis-editor" spellcheck="false" placeholder="写自己的解析：考点、正确答案、错误选项为什么错、下次怎么记。">${escapeHtml(originalText)}</textarea>
    <small class="analysis-hint">失焦自动保存，Ctrl+Enter 保存，Esc 取消。</small>
  `;
  const editor = panel.querySelector('.analysis-editor');
  let committed = false;
  const save = async () => {
    if (committed) return;
    committed = true;
    await saveQuestionAnalysis(question, editor.value);
  };
  editor.addEventListener('blur', save);
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      editor.blur();
    }
    if (event.key === 'Escape') {
      committed = true;
      renderAnalysisPanel(originalText);
    }
  });
  editor.focus();
  editor.select();
}

async function saveAiAnalysisAsQuestion(analysis) {
  const question = currentQuestion();
  if (!question) return;
  if (!String(analysis || '').trim()) {
    toast('AI 解析为空，不能保存。', true);
    return;
  }
  await saveQuestionAnalysis(question, analysis);
}

async function saveQuestionAnalysis(question, analysis) {
  try {
    const result = await api(`/api/questions/${question.id}/analysis`, {
      method: 'PATCH',
      body: { analysis }
    });
    question.analysis = result.analysis;
    const localQuestion = appState.currentPaper?.questions?.find((item) => item.id === question.id);
    if (localQuestion) localQuestion.analysis = result.analysis;
    if (appState.checked[question.id]) appState.checked[question.id].analysis = result.analysis;
    renderAnalysisPanel(result.analysis || '暂无解析，可以点击 AI 解析。');
    toast('这一题的自定义解析已保存。');
  } catch (error) {
    renderAnalysisPanel(question.analysis || analysis || '暂无解析，可以点击 AI 解析。');
    toast(error.message, true);
  }
}

function renderAnswerSheet() {
  if (!appState.currentPaper) return;
  $('#answerSheet').innerHTML = appState.currentPaper.questions.map((question, index) => {
    const checked = appState.checked[question.id];
    const classes = ['answer-dot'];
    if (index === appState.index) classes.push('current');
    if (appState.answers[question.id]) classes.push('answered');
    if (checked?.correct) classes.push('correct');
    if (checked && !checked.correct) classes.push('wrong');
    return `<button class="${classes.join(' ')}" data-jump="${index}">${index + 1}</button>`;
  }).join('');
  $$('[data-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      appState.index = Number(button.dataset.jump);
      renderQuestion();
    });
  });
}

function updatePracticeStats() {
  const total = appState.currentPaper?.questions?.length || 0;
  const checked = Object.values(appState.checked);
  const correct = checked.filter((item) => item.correct).length;
  $('#practiceProgress').textContent = `${checked.length} / ${total}`;
  $('#practiceAccuracy').textContent = `正确率 ${checked.length ? Math.round(correct / checked.length * 100) : 0}%`;
}

function readKeyboardSettings() {
  try {
    return { ...DEFAULT_KEYBOARD_SETTINGS, ...JSON.parse(localStorage.getItem('exam_v5_keyboard') || '{}') };
  } catch (error) {
    return DEFAULT_KEYBOARD_SETTINGS;
  }
}

function hydrateKeyboardSettings() {
  const mapping = {
    keyA: 'A',
    keyB: 'B',
    keyC: 'C',
    keyD: 'D',
    keySubmit: 'submit',
    keyPrev: 'prev',
    keyNext: 'next',
    keyAnalysis: 'analysis',
    keyAi: 'ai',
    keyFavorite: 'favorite'
  };
  Object.entries(mapping).forEach(([id, key]) => {
    const input = $(`#${id}`);
    if (input) input.value = appState.keyboardSettings[key].join(',');
  });
}

function formatShortcutKey(key) {
  const aliases = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Escape: 'Esc',
    ' ': 'Space'
  };
  if (!key) return '未设置';
  if (aliases[key]) return aliases[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function formatShortcutGroup(action) {
  const keys = appState.keyboardSettings[action] || [];
  if (!keys.length) return '未设置';
  return keys.map((key) => formatShortcutKey(key)).join(' / ');
}

function renderShortcutCard() {
  const choice = [formatShortcutGroup('A'), formatShortcutGroup('B'), formatShortcutGroup('C'), formatShortcutGroup('D')].join(' / ');
  const support = [
    `${formatShortcutGroup('analysis')} 解析`,
    `${formatShortcutGroup('ai')} AI 提示`,
    `${formatShortcutGroup('favorite')} 收藏`
  ].join(' · ');
  if ($('#shortcutChoiceKeys')) $('#shortcutChoiceKeys').textContent = `${choice} 选择`;
  if ($('#shortcutSubmitKey')) $('#shortcutSubmitKey').textContent = `${formatShortcutGroup('submit')} 提交试卷`;
  if ($('#shortcutNavigateKeys')) $('#shortcutNavigateKeys').textContent = `${formatShortcutGroup('prev')} / ${formatShortcutGroup('next')} 切题`;
  if ($('#shortcutSupportKeys')) $('#shortcutSupportKeys').textContent = support;
}

function saveKeyboardSettings() {
  const readKeys = (id) => $(`#${id}`).value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  appState.keyboardSettings = {
    A: readKeys('keyA'),
    B: readKeys('keyB'),
    C: readKeys('keyC'),
    D: readKeys('keyD'),
    submit: readKeys('keySubmit'),
    prev: readKeys('keyPrev'),
    next: readKeys('keyNext'),
    analysis: readKeys('keyAnalysis'),
    ai: readKeys('keyAi'),
    favorite: readKeys('keyFavorite')
  };
  localStorage.setItem('exam_v5_keyboard', JSON.stringify(appState.keyboardSettings));
  renderShortcutCard();
  toast('键盘控制格式已保存。');
}

function keyMatches(event, action) {
  const aliases = appState.keyboardSettings[action] || [];
  return aliases.some((alias) => {
    if (alias.length === 1) return event.key.toLowerCase() === alias.toLowerCase();
    return event.key === alias;
  });
}

function startTimer() {
  clearInterval(appState.timer);
  appState.timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - appState.startedAt) / 1000);
    $('#practiceTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, 500);
}

function handlePracticeKeydown(event) {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (keyMatches(event, 'A')) {
    handleOptionActivate('A');
    event.preventDefault();
  } else if (keyMatches(event, 'B')) {
    handleOptionActivate('B');
    event.preventDefault();
  } else if (keyMatches(event, 'C')) {
    handleOptionActivate('C');
    event.preventDefault();
  } else if (keyMatches(event, 'D')) {
    handleOptionActivate('D');
    event.preventDefault();
  } else if (keyMatches(event, 'submit')) {
    submitPaper();
    event.preventDefault();
  } else if (keyMatches(event, 'prev')) {
    prevQuestion();
    event.preventDefault();
  } else if (keyMatches(event, 'next')) {
    nextQuestion();
    event.preventDefault();
  } else if (keyMatches(event, 'analysis')) {
    showAnalysis();
    event.preventDefault();
  } else if (keyMatches(event, 'ai')) {
    aiExplainCurrent();
    event.preventDefault();
  } else if (keyMatches(event, 'favorite')) {
    toggleFavoriteCurrent();
    event.preventDefault();
  }
}

async function loadWrongbook(showMessage = true) {
  if (!appState.token) return;
  const result = await api('/api/wrongbook');
  const list = result.wrongbook || [];
  appState.wrongbookItems = list;
  renderWrongbookList(list);
  if (showMessage) toast('错题本已刷新。');
}

function renderWrongbookList(list) {
  const pagination = paginatePaperItems(list, appState.wrongbookPage);
  appState.wrongbookPage = pagination.page;
  const pageItems = pagination.items;
  $('#wrongbookList').innerHTML = list.length ? pageItems.map((item) => `
      <article class="wrong-card">
        <label class="paper-pick">
          <input type="checkbox" data-paper-pick="wrong:${item.id}" ${appState.selectedPaperItems.has(paperPickKey('wrong', item)) ? 'checked' : ''}>
          <span>加入自定义试卷</span>
        </label>
        <strong>${escapeHtml(item.question)}</strong>
        <div class="wrong-options">
          ${(item.options || []).map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            const classes = ['wrong-option'];
            if (String(item.answer).includes(letter)) classes.push('right');
            if (String(item.user_answer).includes(letter) && !String(item.answer).includes(letter)) classes.push('picked');
            return `<div class="${classes.join(' ')}"><span>${letter}</span><p>${escapeHtml(option)}</p></div>`;
          }).join('')}
        </div>
        <div class="meta-line"><span>错 ${item.wrong_count} 次</span><span>你的答案：${escapeHtml(item.user_answer)}</span><span>正确：${escapeHtml(item.answer)}</span></div>
      <div class="reason-row">
        ${['概念不清', '审题失误', '记忆混淆', '步骤错误', '待归因'].map((reason) => `<button class="${item.reason === reason ? 'active' : ''}" data-wrong-reason="${reason}" data-wrong-id="${item.id}">${reason}</button>`).join('')}
      </div>
      <div class="wrong-analysis-reference">
        <strong>参考解析</strong>
        <p>${escapeHtml(item.analysis || '暂无解析，可以根据正确答案写自己的记忆解析。')}</p>
      </div>
      <textarea data-wrong-note="${item.id}" placeholder="写自己的记忆解析：用一句话解释为什么选这个答案、错选项错在哪里、下次怎么记。">${escapeHtml(item.note)}</textarea>
      <div class="wrong-actions">
        <button class="btn success" data-wrong-save="${item.id}">保存原因/解析</button>
        <button class="btn ghost" data-wrong-master="${item.id}">${item.mastered ? '取消掌握' : '标记掌握'}</button>
      </div>
    </article>
  `).join('') : '<div class="wrong-card">暂无错题。刷一轮题，系统会自动收集。</div>';

  $$('[data-wrong-reason]').forEach((button) => {
    button.addEventListener('click', () => updateWrong(button.dataset.wrongId, { reason: button.dataset.wrongReason }));
  });
  $$('[data-wrong-note]').forEach((textarea) => {
    textarea.addEventListener('change', () => updateWrong(textarea.dataset.wrongNote, { note: textarea.value }));
  });
  $$('[data-wrong-save]').forEach((button) => {
    button.addEventListener('click', () => {
      const note = $(`[data-wrong-note="${button.dataset.wrongSave}"]`)?.value || '';
      updateWrong(button.dataset.wrongSave, { note });
    });
  });
  $$('[data-wrong-master]').forEach((button) => {
    button.addEventListener('click', () => updateWrong(button.dataset.wrongMaster, { mastered: true }));
  });
  bindPaperPickCount();
  renderPaperPagination('wrong');
}

async function loadFavorites(showMessage = false) {
  if (!appState.token) return;
  try {
    const result = await api('/api/favorites');
    const favorites = result.favorites || [];
    appState.favoriteIds = new Set(favorites.map((item) => item.question_id));
    renderFavorites(favorites);
    updateFavoriteButtons();
    if (showMessage) toast('收藏题目已刷新。');
  } catch (error) {
    toast(error.message, true);
  }
}

function renderFavorites(favorites = null) {
  const container = $('#favoriteList');
  if (!container) return;
  if (!favorites) {
    loadFavorites(false);
    return;
  }
  appState.favoriteItems = favorites;
  const pagination = paginatePaperItems(favorites, appState.favoritePage);
  appState.favoritePage = pagination.page;
  const pageItems = pagination.items;
  container.innerHTML = favorites.length ? pageItems.map((item) => `
    <article class="favorite-card">
      <div class="favorite-card-head">
        <label class="paper-pick">
          <input type="checkbox" data-paper-pick="favorite:${item.question_id}" ${appState.selectedPaperItems.has(paperPickKey('favorite', item)) ? 'checked' : ''}>
          <span>加入自定义试卷</span>
        </label>
        <button class="btn small ghost" data-favorite-remove="${item.question_id}">取消收藏</button>
      </div>
      <strong>${escapeHtml(item.question)}</strong>
      <div class="wrong-options">
        ${(item.options || []).map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          const classes = ['wrong-option'];
          if (String(item.answer).includes(letter)) classes.push('right');
          return `<div class="${classes.join(' ')}"><span>${letter}</span><p>${escapeHtml(option)}</p></div>`;
        }).join('')}
      </div>
      <div class="meta-line"><span>${escapeHtml(item.paper_title || '收藏题目')}</span><span>正确：${escapeHtml(item.answer)}</span></div>
      <div class="wrong-analysis-reference"><strong>解析</strong><p>${escapeHtml(item.analysis || '暂无解析。')}</p></div>
    </article>
  `).join('') : '<div class="favorite-card">暂无收藏题目。刷题时点击“收藏”即可加入这里。</div>';
  $$('[data-favorite-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/questions/${button.dataset.favoriteRemove}/favorite`, {
        method: 'PATCH',
        body: { favorite: false }
      });
      appState.favoriteIds.delete(button.dataset.favoriteRemove);
      await loadFavorites(false);
      updateFavoriteButtons();
      toast('已取消收藏。');
    });
  });
  bindPaperPickCount();
  renderPaperPagination('favorite');
}

async function updateWrong(id, payload) {
  try {
    await api(`/api/wrongbook/${id}`, { method: 'PATCH', body: payload });
    markWrongSaved(id, payload);
    await refreshStats();
    toast(payload.mastered ? '已标记掌握。' : '错因和记忆解析已保存。');
  } catch (error) {
    toast(error.message, true);
  }
}

function markWrongSaved(id, payload) {
  if (payload.reason) {
    $$(`[data-wrong-id="${id}"]`).forEach((button) => {
      button.classList.toggle('active', button.dataset.wrongReason === payload.reason);
    });
  }
  const saveButton = $(`[data-wrong-save="${id}"]`);
  if (saveButton && !payload.mastered) {
    const originalText = saveButton.dataset.originalText || saveButton.textContent;
    saveButton.dataset.originalText = originalText;
    saveButton.textContent = '已保存';
    saveButton.classList.add('saved');
    setTimeout(() => {
      saveButton.textContent = originalText;
      saveButton.classList.remove('saved');
    }, 1200);
  }
  const masterButton = $(`[data-wrong-master="${id}"]`);
  if (masterButton && payload.mastered) {
    masterButton.textContent = '已标记掌握';
    masterButton.disabled = true;
  }
}

async function renderAnalytics() {
  if (!appState.token) return;
  const stats = await api('/api/stats');
  $('#analysisCards').innerHTML = [
    ['题库规模', stats.papers, '套试卷'],
    ['题目总量', stats.questions || 0, '可训练题'],
    ['累计答题', stats.answers, '次作答'],
    ['总体正确率', `${stats.accuracy}%`, `近 30 题 ${stats.recent_accuracy || 0}%`],
    ['错题待掌握', stats.wrong, '未掌握'],
    ['收藏题', stats.favorites || 0, '可组卷']
  ].map(([name, value, hint], index) => `
    <article>
      <img class="stat-figure" src="${characterAssets[index % characterAssets.length]}" alt="">
      <span>${name}</span>
      <strong>${value}</strong>
      <small>${escapeHtml(hint)}</small>
    </article>
  `).join('');
  const reviews = await api('/api/review/due?includeFuture=1');
  renderBigDataInsights(stats, reviews.reviews || []);
  $('#reviewQueue').innerHTML = (reviews.reviews || []).slice(0, 10).map((item) => `
    <div class="review-card"><strong>${escapeHtml(item.question)}</strong><div class="meta-line"><span>记忆等级 ${item.level}</span><span>${new Date(item.next_review_at).toLocaleString()}</span></div></div>
  `).join('') || '<div class="review-card">暂无复习计划。</div>';
}

function renderBigDataInsights(stats, reviews = []) {
  const accuracy = Number(stats.accuracy || 0);
  const recentAccuracy = Number(stats.recent_accuracy || 0);
  const healthScore = Math.max(0, Math.min(100, Math.round(
    accuracy * 0.45 +
    recentAccuracy * 0.25 +
    Math.max(0, 100 - Number(stats.wrong || 0) * 8) * 0.2 +
    Math.max(0, 100 - Number(stats.due || 0) * 5) * 0.1
  )));
  const weakGroups = stats.weakest_groups || [];
  const reasonStats = stats.wrong_reason_stats || [];
  const slowQuestions = stats.slow_questions || [];
  const typeStats = stats.type_stats || [];
  const recommendations = stats.recommendations || [];

  $('#bigDataInsights').innerHTML = `
    <section class="learning-insight-board">
      <article class="insight-panel insight-score-card">
        <div class="insight-kicker">本地大数据诊断 · 不调用 AI</div>
        <div class="score-orbit" style="--score:${healthScore}%"><strong>${healthScore}</strong><span>学习健康分</span></div>
        <p>${escapeHtml(getHealthSummary(healthScore, stats))}</p>
      </article>
      <article class="insight-panel">
        <div class="insight-kicker">近期趋势</div>
        ${renderTrendBars(stats.recent_answers || [])}
        <div class="metric-row"><span>平均耗时</span><strong>${formatDuration(stats.avg_time_ms || 0)}</strong></div>
        <div class="metric-row"><span>复习队列</span><strong>${reviews.length || stats.due || 0} 道</strong></div>
      </article>
      <article class="insight-panel">
        <div class="insight-kicker">行动建议</div>
        <ol class="recommendation-list">
          ${(recommendations.length ? recommendations : ['先完成一套试卷，系统会自动分析薄弱项。']).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ol>
      </article>
    </section>
    <section class="learning-insight-board detail-board">
      <article class="insight-panel">
        <div class="insight-kicker">薄弱分组</div>
        ${renderInsightRows(weakGroups, '暂无薄弱分组，先刷一轮题。', (item) => ({
          title: `${item.group_name || '默认分组'} · ${item.category || '未分类'}`,
          value: `${item.accuracy}%`,
          sub: `${item.answers || 0} 次作答 / ${item.questions || 0} 题`,
          percent: item.accuracy || 0
        }))}
      </article>
      <article class="insight-panel">
        <div class="insight-kicker">错因分布</div>
        ${renderInsightRows(reasonStats, '暂无错因记录。', (item) => ({
          title: item.reason || '待归因',
          value: `${item.count || 0} 道`,
          sub: `累计错 ${item.total_wrong || item.count || 0} 次`,
          percent: Math.min(100, (item.count || 0) * 20)
        }))}
      </article>
      <article class="insight-panel">
        <div class="insight-kicker">题型表现</div>
        ${renderInsightRows(typeStats, '暂无题型数据。', (item) => ({
          title: typeLabel(item.type),
          value: `${item.accuracy}%`,
          sub: `${item.answers || 0} 次作答 · ${formatDuration(item.avg_time_ms || 0)}`,
          percent: item.accuracy || 0
        }))}
      </article>
      <article class="insight-panel wide">
        <div class="insight-kicker">高耗时题目</div>
        ${renderInsightRows(slowQuestions, '暂无耗时题数据。', (item) => ({
          title: item.question || '未命名题目',
          value: formatDuration(item.avg_time_ms || 0),
          sub: `${item.group_name || '默认分组'} · 正确率 ${item.accuracy || 0}%`,
          percent: Math.max(8, Math.min(100, (item.avg_time_ms || 0) / 80))
        }))}
      </article>
    </section>
  `;
}

function renderTrendBars(items) {
  if (!items.length) return '<div class="trend-empty">暂无近期答题趋势。</div>';
  return `
    <div class="trend-bars" aria-label="近期答题趋势">
      ${items.slice(-30).map((item) => `
        <span class="trend-bar ${item.correct ? 'correct' : 'wrong'}" style="height:${Math.max(18, Math.min(100, (item.time_spent_ms || 600) / 60))}%"></span>
      `).join('')}
    </div>
  `;
}

function renderInsightRows(items, emptyText, mapper) {
  if (!items.length) return `<div class="insight-empty">${escapeHtml(emptyText)}</div>`;
  return items.slice(0, 6).map((item) => {
    const row = mapper(item);
    return `
      <div class="insight-row">
        <div>
          <strong>${escapeHtml(row.title)}</strong>
          <span>${escapeHtml(row.sub || '')}</span>
        </div>
        <em>${escapeHtml(row.value)}</em>
        <i class="progress-track"><b style="width:${Math.max(4, Math.min(100, row.percent || 0))}%"></b></i>
      </div>
    `;
  }).join('');
}

function getHealthSummary(score, stats) {
  if (!stats.answers) return '还没有答题数据，先做一套小卷就能生成分析。';
  if (score >= 82) return '状态很稳，可以增加限时训练和混合卷保持手感。';
  if (score >= 65) return '基础可用，建议优先处理薄弱分组和到期复习。';
  return '当前需要收敛范围：先复习到期题，再用错题和收藏组一套专项卷。';
}

function formatDuration(ms) {
  const seconds = Math.round(Number(ms || 0) / 1000);
  if (!seconds) return '0 秒';
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function typeLabel(type) {
  return {
    single: '单选题',
    multi: '多选题',
    judge: '判断题',
    blank: '填空题'
  }[type] || '其他题型';
}

async function refreshAiAccount() {
  if (!appState.token) {
    renderAiAccount(null);
    return;
  }
  try {
    const account = await api('/api/ai/account');
    renderAiAccount(account);
  } catch (error) {
    renderAiAccount(null);
  }
}

function renderAiAccount(account) {
  appState.aiAccount = account;
  $('#aiQuotaCard')?.classList.toggle('guest', !account);
  const remaining = $('#aiRemaining');
  const detail = $('#aiQuotaDetail');
  if (!remaining || !detail) return;
  if (!account) {
    remaining.textContent = '登录后查看';
    detail.textContent = '每个用户免费体验 20 次 AI 功能。';
    return;
  }
  remaining.textContent = `${account.remaining} 次可用`;
  detail.textContent = `免费 ${account.free_credits} 次 · 充值暂未开放 · 已用 ${account.total_used} 次`;
}

async function createAiPaymentOrder() {
  toast('AI 充值功能暂未开放，当前每个用户免费体验 20 次。', true);
}

function renderPaymentOrder(order) {
  const box = $('#paymentOrderBox');
  if (!box) return;
  if (!order) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `
    <strong>支付宝充值订单：${escapeHtml(order.id)}</strong>
    <span>金额 ${order.amount_yuan} 元，可获得 ${order.credits} 次 AI，状态：${order.status === 'paid' ? '已到账' : '待支付'}。</span>
    <span>支付链接：${escapeHtml(order.payment_url)}</span>
    <button class="btn primary" type="button" data-complete-payment="${escapeHtml(order.id)}">${order.status === 'paid' ? '已完成' : '我已完成支付，确认到账'}</button>
  `;
  box.querySelector('[data-complete-payment]')?.addEventListener('click', (event) => {
    completeAiPaymentOrder(event.currentTarget.dataset.completePayment);
  });
}

async function completeAiPaymentOrder(orderId = '') {
  toast('AI 充值功能暂未开放，当前每个用户免费体验 20 次。', true);
}

async function askAi() {
  const prompt = $('#aiPrompt').value.trim();
  if (!prompt) return toast('先输入你想问 AI 的内容。', true);
  appendAiMessage('user', prompt);
  const loading = appendAiMessage('assistant', 'AI 正在思考...');
  try {
    const result = await api('/api/deepseek', {
      method: 'POST',
      body: {
        messages: [
          { role: 'system', content: '你是专业刷题规划师，输出具体、简洁、可执行。' },
          { role: 'user', content: prompt }
        ]
      }
    });
    if (result.ai_account) renderAiAccount(result.ai_account);
    renderAiOutput(result.content, loading);
  } catch (error) {
    renderAiOutput(`AI 暂不可用：${error.message}`, loading);
  }
}

async function aiAnalyzeWrongbook() {
  const result = await api('/api/wrongbook');
  const wrongItems = result.wrongbook || [];
  if (!wrongItems.length) return toast('错题本为空，先刷一轮题。', true);
  setAiPromptValue(`请分析这些错题，按知识点、错误原因、三天复习计划输出：\n\n${formatWrongbookForAi(wrongItems)}`);
  await askAi();
}

function formatWrongbookForAi(items) {
  return items.map((item, index) => {
    const options = (item.options || [])
      .map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`)
      .join('\n');
    return [
      `第 ${index + 1} 题：${item.question}`,
      options,
      `我的答案：${item.user_answer || '未记录'}`,
      `正确答案：${item.answer || '未知'}`,
      `错误原因：${item.reason || '待归因'}`,
      item.note ? `记忆解析：${item.note}` : '',
      item.analysis ? `参考解析：${item.analysis}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function bindAiTemplates() {
  $$('[data-ai-template]').forEach((button) => {
    button.addEventListener('click', async () => {
      const current = $('#aiPrompt').value.trim();
      const label = button.textContent.trim();
      if (label === '错题复盘' || label === '閿欓澶嶇洏') {
        await aiAnalyzeWrongbook();
        return;
      }
      const template = formatAiTemplate(button.dataset.aiTemplate, label);
      setAiPromptValue(current ? `${template}\n\n【我的内容】\n${current}` : template);
    });
  });
  $('#aiPrompt')?.addEventListener('input', () => autoResizeAiPrompt($('#aiPrompt')));
}

function formatAiTemplate(template, label = '') {
  const presets = {
    错题复盘: [
      '请根据我的错题进行复盘：',
      '1. 按知识点归类。',
      '2. 分析错误原因。',
      '3. 给出三天复习计划。',
      '',
      '【错题内容】'
    ],
    记忆口诀: [
      '请把下面题目生成适合快速记忆的内容：',
      '1. 一句记忆口诀。',
      '2. 一个联想画面。',
      '3. 易错提醒。',
      '4. 考前 10 秒复述版。',
      '',
      '【题目内容】'
    ],
    今日计划: [
      '请根据我的学习数据生成今天的刷题计划：',
      '1. 先练什么。',
      '2. 每轮做多少题。',
      '3. 错题如何复盘。',
      '4. 今日完成标准。',
      '',
      '【学习数据】'
    ],
    题目解析: [
      '请把下面题目解析成清晰格式：',
      '1. 核心考点。',
      '2. 正确答案。',
      '3. 每个错误选项为什么错。',
      '4. 记忆方法。',
      '',
      '【题目内容】'
    ]
  };
  return (presets[label] || [template]).join('\n');
}

function setAiPromptValue(value) {
  const prompt = $('#aiPrompt');
  prompt.value = value;
  autoResizeAiPrompt(prompt);
  prompt.focus();
}

function autoResizeAiPrompt(prompt) {
  if (!prompt) return;
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(Math.max(prompt.scrollHeight, 260), 520)}px`;
}

function appendAiMessage(role, content) {
  const message = document.createElement('article');
  message.className = `ai-message ${role}`;
  message.innerHTML = `
    <div class="ai-avatar">${role === 'user' ? '我' : 'AI'}</div>
    <div class="ai-bubble"></div>
  `;
  $('#aiOutput').appendChild(message);
  renderAiOutput(content, message.querySelector('.ai-bubble'));
  $('#aiOutput').scrollTop = $('#aiOutput').scrollHeight;
  return message.querySelector('.ai-bubble');
}

function renderAiOutput(content, target = $('#aiOutput')) {
  target.innerHTML = formatAiMarkdown(content || '暂无输出');
}

function formatAiMarkdown(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul class="ai-list">${list.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushList();
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      flushList();
      html.push('<hr class="ai-divider">');
      continue;
    }
    if (line.startsWith('|')) {
      flushList();
      const tableLines = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      html.push(formatAiTable(tableLines));
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/) || line.match(/^(第[一二三四五六七八九十\d]+天[:：].*)$/);
    if (heading) {
      flushList();
      const text = heading[2] || heading[1];
      const level = heading[1]?.startsWith('#') && heading[1].length >= 3 ? 'h3' : 'h2';
      html.push(`<${level}>${formatInlineMarkdown(text)}</${level}>`);
      continue;
    }
    const bullet = line.match(/^([*+\-]|[0-9]+[.、])\s*(.+)$/);
    if (bullet) {
      list.push(bullet[2]);
      continue;
    }
    flushList();
    html.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }
  flushList();
  return html.join('');
}

function formatAiTable(lines) {
  const rows = lines
    .map((line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length && !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
  if (!rows.length) return '';
  const [head, ...body] = rows;
  return `
    <div class="ai-table-wrap">
      <table class="ai-table">
        <thead><tr>${head.map((cell) => `<th>${formatInlineMarkdown(cell)}</th>`).join('')}</tr></thead>
        <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${formatInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

function formatInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function typeLabel(type) {
  return ({ single: '单选题', multi: '多选题', judge: '判断题', blank: '填空题' })[type] || '题目';
}

function normalizeAnswer(value) {
  return String(value || '').trim().replace(/\s/g, '').toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message, isError = false) {
  const toastEl = $('#toast');
  toastEl.textContent = message;
  toastEl.style.background = isError ? 'var(--red)' : '#111827';
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
