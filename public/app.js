// AOTO front end. The /api functions (Vercel) hold user accounts, each user's settings
// and Gemini API key; the key never reaches the browser.
// Notes are written to the Obsidian vault in one of two ways:
//   1) File System Access API (Chrome/Edge on desktop): the user picks the vault
//      folder once, and notes are read/written directly in that folder.
//   2) Obsidian URI (Safari/iPhone, Firefox, etc.): obsidian://new opens the
//      Obsidian app and creates/overwrites the note there.

const FS_SUPPORTED = typeof window.showDirectoryPicker === 'function';

// Application Global State
const state = {
  username: null,
  authMode: 'login',          // 'login' | 'signup'
  config: {
    hasApiKey: false,
    vaultName: '',              // Used for obsidian:// URIs
    saveSubfolder: 'Daily Notes',
    weeklySchedule: {},
    flexibleSchedule: ''
  },
  vaultHandle: null,          // FileSystemDirectoryHandle (FS mode only)
  vaultPermission: 'none',    // 'none' | 'granted' | 'prompt' | 'denied'
  targetDate: '',
  generatedMarkdown: '',
  existingMarkdown: '', // Holds loaded note content from Obsidian vault if it exists
  activeTab: 'visual' // 'visual' or 'raw'
};

// DOM Elements & Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // Character count event
  const rawMemo = document.getElementById('raw-memo');
  rawMemo.addEventListener('input', () => {
    document.getElementById('char-num').textContent = rawMemo.value.length;
  });

  // Direct Markdown editor live sync event
  const markdownOutput = document.getElementById('markdown-output');
  markdownOutput.addEventListener('input', () => {
    state.generatedMarkdown = markdownOutput.value;
    renderMarkdownVisual(markdownOutput.value);
  });
});

// App Initialization
async function initApp() {
  // Start Clock Widget
  startClock();

  // Show only the vault controls that this browser supports
  document.getElementById('vault-fs-group').classList.toggle('hidden', !FS_SUPPORTED);
  document.getElementById('vault-uri-group').classList.toggle('hidden', FS_SUPPORTED);

  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Default target date is "Tomorrow"
  setDateTarget('tomorrow', { skipCheck: true });

  // Show the login screen unless this browser already has a session
  let session = null;
  try {
    session = await apiFetch('/api/session', {}, { allowUnauthenticated: true });
  } catch (error) {
    session = null;
  }
  if (session && session.authenticated) {
    await onLoggedIn(session.username);
  } else {
    showLogin(session ? '' : '서버에 연결하지 못했습니다.');
  }
}

// ---------------------------------------------------------------------------
// Server API and login
// ---------------------------------------------------------------------------

// fetch wrapper: JSON in/out, shows the login screen on 401
async function apiFetch(url, options = {}, { allowUnauthenticated = false } = {}) {
  const opts = { credentials: 'same-origin', ...options };
  if (opts.body !== undefined) {
    opts.method = opts.method || 'POST';
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  let response;
  try {
    response = await fetch(url, opts);
  } catch (error) {
    throw new Error('서버에 연결하지 못했습니다.');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !allowUnauthenticated) {
    resetUserState();
    showLogin('로그인이 필요합니다.');
    throw new Error(data.error || '로그인이 필요합니다.');
  }
  if (!response.ok && !allowUnauthenticated) {
    throw new Error(data.error || `요청 실패 (${response.status})`);
  }
  return data;
}

function showLogin(message) {
  document.getElementById('login-overlay').classList.add('active');
  setAuthMode(state.authMode);
  document.getElementById('login-error').textContent = message || '';
  document.getElementById('login-password').value = '';
  setTimeout(() => document.getElementById('login-username').focus(), 50);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === 'signup';
  document.getElementById('auth-tab-login').classList.toggle('active', !signup);
  document.getElementById('auth-tab-signup').classList.toggle('active', signup);
  document.getElementById('signup-hint').classList.toggle('hidden', !signup);
  document.getElementById('login-title').textContent = signup ? 'AOTO 가입' : 'AOTO 로그인';
  document.getElementById('auth-submit-text').textContent = signup ? '가입하고 시작하기' : '로그인';
  document.getElementById('login-password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  document.getElementById('login-error').textContent = '';
}

async function submitLogin(event) {
  if (event) event.preventDefault();
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  if (!username || !password) {
    errorEl.textContent = '아이디와 비밀번호를 입력해주세요.';
    return;
  }
  const signup = state.authMode === 'signup';
  try {
    const data = await apiFetch(signup ? '/api/signup' : '/api/login', {
      body: { username, password }
    }, { allowUnauthenticated: true });
    if (!data.success) {
      errorEl.textContent = data.error || '실패했습니다.';
      return;
    }
    document.getElementById('login-overlay').classList.remove('active');
    await onLoggedIn(data.username);
    if (signup) {
      showToast('가입되었습니다. 설정에서 Gemini API 키를 먼저 등록해주세요.', 'success');
      openConfigModal();
    }
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

async function logout() {
  try {
    await apiFetch('/api/logout', { body: {} }, { allowUnauthenticated: true });
  } finally {
    resetUserState();
    showLogin('로그아웃되었습니다.');
  }
}

// Clear everything that belongs to the previous user
function resetUserState() {
  state.username = null;
  state.vaultHandle = null;
  state.vaultPermission = 'none';
  state.existingMarkdown = '';
  state.generatedMarkdown = '';
  state.config = { hasApiKey: false, vaultName: '', saveSubfolder: 'Daily Notes', weeklySchedule: {}, flexibleSchedule: '' };
  document.getElementById('current-user').textContent = '';
  document.getElementById('raw-memo').value = '';
  document.getElementById('char-num').textContent = '0';
  document.getElementById('markdown-output').value = '';
  document.getElementById('preview-visual-box').innerHTML = '';
  document.getElementById('output-state-result').classList.add('hidden');
  document.getElementById('preview-tabs').classList.add('hidden');
  document.getElementById('output-actions').classList.add('hidden');
  document.getElementById('output-state-empty').classList.remove('hidden');
  document.getElementById('existing-note-banner').classList.add('hidden');
  updateStatusPills();
}

async function onLoggedIn(username) {
  state.username = username;
  document.getElementById('current-user').textContent = username || '';
  // The vault folder is remembered per user in this browser
  if (FS_SUPPORTED) {
    state.vaultHandle = null;
    state.vaultPermission = 'none';
    await restoreVaultHandle();
  }
  await loadConfiguration();
  await checkExistingNote();
}

// Clock Widget running
function startClock() {
  const clockEl = document.getElementById('live-time');
  function updateTime() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const hoursStr = String(hours).padStart(2, '0');

    clockEl.textContent = `${hoursStr}:${minutes}:${seconds} ${ampm}`;
  }
  updateTime();
  setInterval(updateTime, 1000);
}

// Set Date Target
function setDateTarget(type, { skipCheck = false } = {}) {
  const today = new Date();
  const dateInput = document.getElementById('target-date');
  const btnToday = document.getElementById('btn-today');
  const btnTomorrow = document.getElementById('btn-tomorrow');

  btnToday.classList.remove('active');
  btnTomorrow.classList.remove('active');

  if (type === 'today') {
    state.targetDate = getFormattedDate(today);
    btnToday.classList.add('active');
    dateInput.value = state.targetDate;
  } else if (type === 'tomorrow') {
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    state.targetDate = getFormattedDate(tomorrow);
    btnTomorrow.classList.add('active');
    dateInput.value = state.targetDate;
  } else if (type === 'custom') {
    if (dateInput.value) {
      state.targetDate = dateInput.value;
    } else {
      state.targetDate = getFormattedDate(today);
      dateInput.value = state.targetDate;
    }
  }

  // Check if daily note exists in Vault for the selected date
  if (!skipCheck) checkExistingNote();
}

// Helper to format date YYYY-MM-DD
function getFormattedDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isValidDateString(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '');
}

// ---------------------------------------------------------------------------
// Configuration (stored on the server, shared by every logged-in device)
// ---------------------------------------------------------------------------

// Load configuration into state and the settings modal
async function loadConfiguration() {
  try {
    const config = await apiFetch('/api/config');
    applyConfig(config);
  } catch (error) {
    showToast('설정 로드 실패: ' + error.message, 'error');
  }
}

function applyConfig(config) {
  state.config = config;

  // The saved key is never sent back; the field stays empty unless the user types a new one
  const keyInput = document.getElementById('api-key-input');
  keyInput.value = '';
  keyInput.placeholder = config.hasApiKey
    ? '저장된 키 사용 중 (바꿀 때만 새 키 입력)'
    : 'AI Studio에서 발급받은 API 키 입력';
  document.getElementById('vault-name-input').value = config.vaultName || '';
  document.getElementById('subfolder-input').value = config.saveSubfolder || '';

  // Populate weekly schedules
  const weekly = config.weeklySchedule || {};
  document.getElementById('sched-monday').value = weekly.monday || '';
  document.getElementById('sched-tuesday').value = weekly.tuesday || '';
  document.getElementById('sched-wednesday').value = weekly.wednesday || '';
  document.getElementById('sched-thursday').value = weekly.thursday || '';
  document.getElementById('sched-friday').value = weekly.friday || '';
  document.getElementById('sched-saturday').value = weekly.saturday || '';
  document.getElementById('sched-sunday').value = weekly.sunday || '';

  // Populate flexible schedule
  document.getElementById('flexible-schedule-input').value = config.flexibleSchedule || '';

  updateStatusPills();
}

// Update the header status pills from current state
function updateStatusPills() {
  const apiPill = document.getElementById('status-api');
  if (state.config.hasApiKey) {
    apiPill.className = 'status-pill status-success';
    apiPill.querySelector('.status-text').textContent = 'API Key 연결됨';
  } else {
    apiPill.className = 'status-pill status-error';
    apiPill.querySelector('.status-text').textContent = 'API Key 미설정';
  }

  const vaultPill = document.getElementById('status-vault');
  let ok = false;
  let text = 'Vault 미설정';
  if (FS_SUPPORTED) {
    if (state.vaultHandle && state.vaultPermission === 'granted') {
      ok = true;
      text = `Vault: ${state.vaultHandle.name}`;
    } else if (state.vaultHandle) {
      text = 'Vault 권한 필요 (클릭)';
    }
  } else if (state.config.vaultName) {
    ok = true;
    text = `Obsidian 앱: ${state.config.vaultName}`;
  }
  vaultPill.className = ok ? 'status-pill status-success' : 'status-pill status-error';
  vaultPill.querySelector('.status-text').textContent = text;

  const folderLabel = document.getElementById('vault-folder-name');
  if (folderLabel) {
    folderLabel.textContent = state.vaultHandle ? state.vaultHandle.name : '선택된 폴더 없음';
  }
}

// Save Configuration
async function saveConfiguration() {
  const apiKey = document.getElementById('api-key-input').value.trim();
  const vaultName = document.getElementById('vault-name-input').value.trim();
  const subfolder = cleanPath(document.getElementById('subfolder-input').value);

  if (!FS_SUPPORTED && !vaultName) {
    showToast('Obsidian Vault 이름은 필수 입력사항입니다.', 'error');
    return;
  }

  // Retrieve weekly schedules from UI inputs
  const weeklySchedule = {
    monday: document.getElementById('sched-monday').value.trim(),
    tuesday: document.getElementById('sched-tuesday').value.trim(),
    wednesday: document.getElementById('sched-wednesday').value.trim(),
    thursday: document.getElementById('sched-thursday').value.trim(),
    friday: document.getElementById('sched-friday').value.trim(),
    saturday: document.getElementById('sched-saturday').value.trim(),
    sunday: document.getElementById('sched-sunday').value.trim()
  };

  const flexibleSchedule = document.getElementById('flexible-schedule-input').value.trim();

  try {
    const data = await apiFetch('/api/config', {
      body: {
        geminiApiKey: apiKey, // empty = keep the saved key
        vaultName: vaultName,
        saveSubfolder: subfolder,
        weeklySchedule: weeklySchedule,
        flexibleSchedule: flexibleSchedule
      }
    });
    applyConfig(data.config);
    showToast('설정이 저장되었습니다. 로그인한 모든 기기에 적용됩니다.', 'success');
    closeConfigModal();
    await checkExistingNote(); // Re-check with the new subfolder
  } catch (error) {
    showToast('설정 저장 중 오류: ' + error.message, 'error');
  }
}

// Strip surrounding quotes/slashes from a path typed by the user
function cleanPath(p) {
  if (!p) return '';
  let cleaned = p.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  return cleaned.trim().replace(/^[\\/]+|[\\/]+$/g, '');
}

// Split "Daily Notes/Work" into safe folder segments
function getSubfolderSegments() {
  return cleanPath(state.config.saveSubfolder || '')
    .split(/[\\/]+/)
    .map(s => s.trim())
    .filter(s => s && s !== '.' && s !== '..');
}

// Folder segments for a note: [subfolder..., 'YYYY-MM']
function getNoteFolderSegments(date) {
  const parts = date.split('-');
  return [...getSubfolderSegments(), `${parts[0]}-${parts[1]}`];
}

// Open Config Modal
function openConfigModal() {
  document.getElementById('config-modal').classList.add('active');
  switchModalTab('general'); // Reset to general settings tab when opened
}

// Open Config Modal directly to a specific Tab from main dashboard
function openModalToTab(tab) {
  document.getElementById('config-modal').classList.add('active');
  switchModalTab(tab);
}

// Close Config Modal
function closeConfigModal() {
  document.getElementById('config-modal').classList.remove('active');
}

// Switch Settings Modal Tabs
function switchModalTab(tab) {
  const tabButtons = document.querySelectorAll('#config-modal .modal-tab-btn');
  tabButtons.forEach(btn => btn.classList.remove('active'));

  const tabPanes = document.querySelectorAll('#config-modal .modal-tab-pane');
  tabPanes.forEach(pane => pane.classList.add('hidden'));

  if (tab === 'general') {
    document.querySelector('.modal-tab-btn[onclick="switchModalTab(\'general\')"]').classList.add('active');
    document.getElementById('modal-tab-general').classList.remove('hidden');
  } else if (tab === 'weekly') {
    document.querySelector('.modal-tab-btn[onclick="switchModalTab(\'weekly\')"]').classList.add('active');
    document.getElementById('modal-tab-weekly').classList.remove('hidden');
  } else if (tab === 'flexible') {
    document.querySelector('.modal-tab-btn[onclick="switchModalTab(\'flexible\')"]').classList.add('active');
    document.getElementById('modal-tab-flexible').classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
// Vault folder access (File System Access API, Chrome/Edge desktop)
// ---------------------------------------------------------------------------

// Minimal IndexedDB key-value store: directory handles cannot go in localStorage
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aoto', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction('handles', 'readonly').objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function vaultKey() {
  return `vault:${state.username || ''}`;
}

// Restore the previously picked vault folder (permission may need re-granting)
async function restoreVaultHandle() {
  try {
    const handle = await idbGet(vaultKey());
    if (handle) {
      state.vaultHandle = handle;
      state.vaultPermission = await handle.queryPermission({ mode: 'readwrite' });
    }
  } catch (error) {
    console.error('Vault 폴더 정보를 불러오지 못했습니다.', error);
  }
}

// Let the user pick the vault folder (must run inside a click handler)
async function pickVaultFolder() {
  if (!FS_SUPPORTED) return false;
  try {
    const handle = await window.showDirectoryPicker({ id: 'aoto-vault', mode: 'readwrite' });
    state.vaultHandle = handle;
    state.vaultPermission = await handle.queryPermission({ mode: 'readwrite' });
    await idbSet(vaultKey(), handle);
    updateStatusPills();
    showToast(`Vault 폴더가 연결되었습니다: ${handle.name}`, 'success');
    await checkExistingNote();
    return true;
  } catch (error) {
    if (error.name !== 'AbortError') {
      showToast('폴더 선택 실패: ' + error.message, 'error');
    }
    return false;
  }
}

// Make sure we have read/write permission on the vault (must run inside a click handler)
async function ensureVaultPermission() {
  if (!state.vaultHandle) {
    const picked = await pickVaultFolder();
    if (!picked) return false;
  }
  if (state.vaultPermission !== 'granted') {
    state.vaultPermission = await state.vaultHandle.requestPermission({ mode: 'readwrite' });
    updateStatusPills();
  }
  return state.vaultPermission === 'granted';
}

// Header vault pill: re-grant permission if needed, otherwise open settings
async function onVaultPillClick() {
  if (FS_SUPPORTED && state.vaultHandle && state.vaultPermission !== 'granted') {
    if (await ensureVaultPermission()) {
      showToast('Vault 폴더 접근이 허용되었습니다.', 'success');
      await checkExistingNote();
    }
    return;
  }
  openConfigModal();
}

async function getNoteDirectory(date, create) {
  let dir = state.vaultHandle;
  for (const segment of getNoteFolderSegments(date)) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

async function readNoteFromVault(date) {
  try {
    const dir = await getNoteDirectory(date, false);
    const fileHandle = await dir.getFileHandle(`${date}.md`);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (error) {
    if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') return null;
    throw error;
  }
}

async function writeNoteToVault(date, content) {
  const dir = await getNoteDirectory(date, true);
  const fileHandle = await dir.getFileHandle(`${date}.md`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return [...getNoteFolderSegments(date), `${date}.md`].join('/');
}

// Clear Raw Memo Textarea
function clearInput() {
  const rawMemo = document.getElementById('raw-memo');
  rawMemo.value = '';
  document.getElementById('char-num').textContent = '0';
  rawMemo.focus();
  showToast('입력란이 초기화되었습니다.', 'success');
}

// Load writing samples for testing
function loadSample() {
  const sampleText = `- 아침 9시 컴퓨터 아키텍처 수업 꼭 드랍할지 말지 교수님 면담 준비하기
- 오후 2시 연구실 가기 전에 과제 피드백 반영하기
- 연구실에서 이번 달 학회 논문 수정본 작성하고 학부생 멘토링 자료 만들기
- 오후 6시 연구실 전체 세미나 참석
- 저녁 8시 헬스장 가거나 조깅 30분
- 집 가는 길에 마트 들러서 햇반이랑 우유 사가기`;

  const rawMemo = document.getElementById('raw-memo');
  rawMemo.value = sampleText;
  document.getElementById('char-num').textContent = sampleText.length;
  rawMemo.focus();
  showToast('작성 예시 텍스트를 불러왔습니다.', 'success');
}

// Generate Schedule by calling Gemini API
async function generateTasks() {
  const rawText = document.getElementById('raw-memo').value.trim();

  if (!rawText) {
    showToast('AI 정리를 위해 무작위 할 일을 먼저 작성해주세요.', 'error');
    return;
  }

  if (!state.config.hasApiKey) {
    showToast('Gemini API Key 설정이 필요합니다.', 'error');
    openConfigModal();
    return;
  }

  // Switch UI states to Loading
  setLoadingState(true);

  try {
    const data = await apiFetch('/api/generate', {
      body: { rawText: rawText, date: state.targetDate, existingMarkdown: state.existingMarkdown }
    });
    const markdown = data.markdown;
    if (!markdown) throw new Error('마크다운 데이터를 정상적으로 로드하지 못했습니다.');
    state.generatedMarkdown = markdown;

    // Update UI Result State
    document.getElementById('output-state-empty').classList.add('hidden');
    document.getElementById('output-state-loading').classList.add('hidden');
    document.getElementById('output-state-result').classList.remove('hidden');

    document.getElementById('preview-tabs').classList.remove('hidden');
    document.getElementById('output-actions').classList.remove('hidden');

    // Populate text editor
    document.getElementById('markdown-output').value = markdown;

    // Render beautiful preview
    renderMarkdownVisual(markdown);
    switchPreviewTab('visual');

    showToast('AI가 일정을 깔끔하게 구조화했습니다!', 'success');

  } catch (error) {
    showToast(error.message, 'error');
    setLoadingState(false);

    // Go back to empty/ready view
    document.getElementById('output-state-empty').classList.remove('hidden');
    document.getElementById('output-state-result').classList.add('hidden');
    document.getElementById('preview-tabs').classList.add('hidden');
    document.getElementById('output-actions').classList.add('hidden');
  } finally {
    setLoadingState(false);
  }
}

// Switch UI loading states
function setLoadingState(isLoading) {
  const btnContent = document.querySelector('#btn-generate .btn-content');
  const btnLoader = document.querySelector('#btn-generate .btn-loader');
  const btnGenerate = document.getElementById('btn-generate');
  const emptyState = document.getElementById('output-state-empty');
  const loadingState = document.getElementById('output-state-loading');
  const resultState = document.getElementById('output-state-result');

  if (isLoading) {
    btnContent.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    btnGenerate.disabled = true;

    emptyState.classList.add('hidden');
    loadingState.classList.remove('hidden');
    resultState.classList.add('hidden');
  } else {
    btnContent.classList.remove('hidden');
    btnLoader.classList.add('hidden');
    btnGenerate.disabled = false;
    loadingState.classList.add('hidden');
  }
}

// Switch Right Panel tabs (Visual / Raw Markdown)
function switchPreviewTab(tab) {
  state.activeTab = tab;
  const tabVisual = document.getElementById('tab-visual');
  const tabRaw = document.getElementById('tab-raw');
  const boxVisual = document.getElementById('preview-visual-box');
  const boxRaw = document.getElementById('preview-raw-box');

  tabVisual.classList.remove('active');
  tabRaw.classList.remove('active');
  boxVisual.classList.add('hidden');
  boxRaw.classList.add('hidden');

  if (tab === 'visual') {
    tabVisual.classList.add('active');
    boxVisual.classList.remove('hidden');
  } else {
    tabRaw.classList.add('active');
    boxRaw.classList.remove('hidden');
  }
}

// Copy raw markdown code to clipboard
function copyToClipboard() {
  const mdText = document.getElementById('markdown-output').value;
  if (!mdText) return;

  navigator.clipboard.writeText(mdText).then(() => {
    const copyText = document.getElementById('copy-text');
    const copyIcon = document.getElementById('copy-icon');

    copyText.textContent = '복사 완료!';
    copyIcon.setAttribute('data-lucide', 'check');
    if (window.lucide) window.lucide.createIcons();

    showToast('클립보드에 마크다운 코드가 복사되었습니다.', 'success');

    setTimeout(() => {
      copyText.textContent = '클립보드 복사';
      copyIcon.setAttribute('data-lucide', 'copy');
      if (window.lucide) window.lucide.createIcons();
    }, 2000);
  }).catch(err => {
    showToast('클립보드 복사 실패: ' + err.message, 'error');
  });
}

// Download the note as a .md file (works in every browser)
function downloadMarkdown() {
  if (!state.generatedMarkdown) {
    showToast('저장할 마크다운 데이터가 없습니다.', 'error');
    return;
  }
  const blob = new Blob([state.generatedMarkdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.targetDate}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Save generated note into the Obsidian vault
async function saveToObsidian() {
  if (!state.generatedMarkdown) {
    showToast('저장할 마크다운 데이터가 없습니다.', 'error');
    return;
  }

  if (!isValidDateString(state.targetDate)) {
    showToast('날짜 형식이 올바르지 않습니다.', 'error');
    return;
  }

  if (FS_SUPPORTED) {
    try {
      if (!(await ensureVaultPermission())) {
        showToast('Vault 폴더 접근이 허용되지 않아 저장하지 못했습니다.', 'error');
        return;
      }
      const savedPath = await writeNoteToVault(state.targetDate, state.generatedMarkdown);
      showToast(`저장 완료: ${state.vaultHandle.name}/${savedPath}`, 'success');
      await checkExistingNote(); // Update indicator state to show file exists now

      // Flash glowing green indicator briefly on the right panel
      const outputPanel = document.querySelector('.output-panel');
      outputPanel.style.borderColor = 'var(--accent-green)';
      setTimeout(() => {
        outputPanel.style.borderColor = '';
      }, 1500);
    } catch (error) {
      showToast('저장 실패: ' + error.message, 'error');
    }
    return;
  }

  // Obsidian URI mode (iPhone Safari, Firefox, ...): hand the note to the Obsidian app
  if (!state.config.vaultName) {
    showToast('Obsidian Vault 이름을 설정에서 먼저 등록해주세요.', 'error');
    openConfigModal();
    return;
  }
  const filePath = [...getNoteFolderSegments(state.targetDate), state.targetDate].join('/');
  const uri = 'obsidian://new' +
    `?vault=${encodeURIComponent(state.config.vaultName)}` +
    `&file=${encodeURIComponent(filePath)}` +
    `&content=${encodeURIComponent(state.generatedMarkdown)}` +
    '&overwrite=true';
  openExternalUri(uri);
}

function openExternalUri(uri) {
  window.location.href = uri;
}

// Toggle checklist state in visual preview
function toggleTaskChecked(checkbox) {
  const taskItem = checkbox.closest('.task-item');
  if (checkbox.checked) {
    taskItem.classList.add('checked');
  } else {
    taskItem.classList.remove('checked');
  }

  // Keep the generatedMarkdown and textarea synced with the checkbox state changes!
  updateMarkdownCheckboxState(taskItem.querySelector('.task-item-text').textContent, checkbox.checked);
}

// Update state markdown representation when checklist is toggled in visual view
function updateMarkdownCheckboxState(taskText, isChecked) {
  let markdown = state.generatedMarkdown;
  const oldText = isChecked ? `- [ ] ${taskText}` : `- [x] ${taskText}`;
  const newText = isChecked ? `- [x] ${taskText}` : `- [ ] ${taskText}`;

  // Safe replacement logic
  if (markdown.includes(oldText)) {
    markdown = markdown.replace(oldText, () => newText);
  } else {
    // In case spaces differ
    const regex = new RegExp(`-\\s*\\[[ xX]\\s*\\]\\s*${escapeRegExp(taskText)}`, 'g');
    markdown = markdown.replace(regex, () => newText);
  }

  state.generatedMarkdown = markdown;
  document.getElementById('markdown-output').value = markdown;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// Escape text before inserting it into innerHTML
function escapeHtml(string) {
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Custom Markdown to Premium Styled HTML Visual Renderer
function renderMarkdownVisual(md) {
  const container = document.getElementById('preview-visual-box');
  container.innerHTML = '';

  let html = '';
  const lines = md.split('\n');
  let inFrontmatter = false;
  let frontmatterLines = [];
  let inCallout = false;
  let calloutType = '';
  let calloutLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Frontmatter parsing
    if (line.trim() === '---') {
      if (!inFrontmatter && i === 0) {
        inFrontmatter = true;
        continue;
      } else if (inFrontmatter) {
        inFrontmatter = false;
        html += `<div class="frontmatter-box">`;
        frontmatterLines.forEach(fLine => {
          const parts = fLine.split(':');
          if (parts.length >= 2) {
            const key = parts[0].trim();
            const val = parts.slice(1).join(':').trim();
            html += `<div class="frontmatter-line"><span class="frontmatter-key">${escapeHtml(key)}</span>: ${escapeHtml(val)}</div>`;
          } else {
            html += `<div class="frontmatter-line">${escapeHtml(fLine)}</div>`;
          }
        });
        html += `</div>`;
        continue;
      }
    }

    if (inFrontmatter) {
      frontmatterLines.push(line);
      continue;
    }

    // Callout parsing
    if (line.trim().startsWith('>')) {
      // Extract callout contents
      let content = line.substring(line.indexOf('>') + 1).trim();

      if (content.startsWith('[!')) {
        inCallout = true;
        const calloutMeta = content.match(/\[!([^\]]+)\](.*)/);
        if (calloutMeta) {
          calloutType = calloutMeta[1].toUpperCase();
          const extraTitle = calloutMeta[2].trim();
          calloutLines = [];

          let calloutIcon = 'lightbulb';
          if (calloutType === 'IMPORTANT' || calloutType === 'WARNING') calloutIcon = 'alert-triangle';
          if (calloutType === 'TODO') calloutIcon = 'check-square';

          html += `<div class="obsidian-callout">
            <div class="callout-title"><i data-lucide="${calloutIcon}"></i> ${escapeHtml(calloutType)} ${escapeHtml(extraTitle)}</div>
            <div class="callout-body">`;
        }
        continue;
      }

      if (inCallout) {
        // Handle list bullet points inside callouts
        if (content.startsWith('-')) {
          content = '• ' + content.substring(1).trim();
        }
        calloutLines.push(escapeHtml(content));
        continue;
      }
    } else {
      if (inCallout) {
        inCallout = false;
        html += calloutLines.join('<br>') + `</div></div>`;
      }
    }

    // Title #
    if (line.startsWith('# ')) {
      const title = line.substring(2);
      html += `<h1>${escapeHtml(title)}</h1>`;
      continue;
    }

    // Headers ##
    if (line.startsWith('## ')) {
      const title = line.substring(3);
      let icon = 'calendar';
      if (title.includes('주요일정')) icon = 'star';
      else if (title.includes('학교')) icon = 'graduation-cap';
      else if (title.includes('연구실')) icon = 'beaker';
      else if (title.includes('기타')) icon = 'coffee';

      html += `<h2><i data-lucide="${icon}"></i> ${escapeHtml(title)}</h2>`;
      continue;
    }

    // Checkboxes
    const checkboxMatch = line.match(/^-\s*\[([ xX])\]\s*(.*)/);
    if (checkboxMatch) {
      const isChecked = checkboxMatch[1] !== ' ';
      const taskText = checkboxMatch[2];
      const checkedClass = isChecked ? 'checked' : '';
      const checkedAttr = isChecked ? 'checked' : '';
      html += `
        <div class="task-item ${checkedClass}">
          <input type="checkbox" ${checkedAttr} onchange="toggleTaskChecked(this)">
          <span class="task-item-text">${escapeHtml(taskText)}</span>
        </div>
      `;
      continue;
    }

    if (line.trim() === '') {
      continue;
    }

    // Normal Text
    if (!inCallout && !inFrontmatter) {
      // Render as bullet list item if starts with -
      if (line.startsWith('-')) {
        html += `<li style="font-size: 13.5px; color: var(--text-secondary); margin-left: 14px; margin-bottom: 6px; list-style-type: disc;">${escapeHtml(line.substring(1).trim())}</li>`;
      } else {
        html += `<p style="font-size: 13.5px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(line)}</p>`;
      }
    }
  }

  // Close trailing callout
  if (inCallout) {
    html += calloutLines.join('<br>') + `</div></div>`;
  }

  container.innerHTML = html;

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Toast notification helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconName = type === 'success' ? 'check-circle' : 'alert-circle';
  toast.innerHTML = `<i data-lucide="${iconName}"></i><span></span>`;
  toast.querySelector('span').textContent = message;

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  // Slide out and remove toast after 3.5 seconds
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse forwards';
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3500);
}

// Check if a daily note already exists for the selected date
// (only possible with direct folder access; the Obsidian URI mode cannot read notes)
async function checkExistingNote() {
  const banner = document.getElementById('existing-note-banner');
  if (!banner) return;

  banner.classList.add('hidden'); // Hide by default
  state.existingMarkdown = '';    // Reset state

  if (!FS_SUPPORTED || !state.vaultHandle || state.vaultPermission !== 'granted') return;
  if (!isValidDateString(state.targetDate)) return;

  const requestedDate = state.targetDate;
  try {
    const markdown = await readNoteFromVault(requestedDate);
    if (requestedDate !== state.targetDate) return; // Date changed while reading
    if (markdown) {
      // Keep track of the loaded existing note
      state.existingMarkdown = markdown;
      banner.classList.remove('hidden');
    }
  } catch (error) {
    console.error('기존 노트를 조회하는 중 에러가 발생했습니다.', error);
  }
}

// Load the existing markdown into the output workspace directly
function loadExistingNote() {
  if (!state.existingMarkdown) return;

  // Update result view
  document.getElementById('output-state-empty').classList.add('hidden');
  document.getElementById('output-state-loading').classList.add('hidden');
  document.getElementById('output-state-result').classList.remove('hidden');
  document.getElementById('preview-tabs').classList.remove('hidden');
  document.getElementById('output-actions').classList.remove('hidden');

  // Fill raw editor and preview
  state.generatedMarkdown = state.existingMarkdown;
  document.getElementById('markdown-output').value = state.existingMarkdown;
  renderMarkdownVisual(state.existingMarkdown);
  switchPreviewTab('visual');

  showToast('보관소의 기존 일정을 불러왔습니다. 새로운 할 일을 왼쪽에 추가로 입력한 뒤 AI 정리를 누르면 일정이 합쳐집니다.', 'success');
}
