// AOTO runs entirely in the browser. There is no backend server:
// - Settings (including the Gemini API key) live in this browser's localStorage.
// - Gemini is called directly from the browser with the user's own key.
// - Notes are written to the Obsidian vault in one of two ways:
//   1) File System Access API (Chrome/Edge on desktop): the user picks the vault
//      folder once, and notes are read/written directly in that folder.
//   2) Obsidian URI (Safari/iPhone, Firefox, etc.): obsidian://new opens the
//      Obsidian app and creates/overwrites the note there.

const CONFIG_STORAGE_KEY = 'aoto-config';
const FS_SUPPORTED = typeof window.showDirectoryPicker === 'function';

const DEFAULT_CONFIG = {
  geminiApiKey: '',
  vaultName: '',              // Used for obsidian:// URIs
  saveSubfolder: 'Daily Notes',
  templatePreference: 'modern-dark',
  flexibleSchedule: '',
  weeklySchedule: {
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: '',
    saturday: '',
    sunday: ''
  }
};

// Application Global State
const state = {
  config: structuredClone(DEFAULT_CONFIG),
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

  // Load configuration from localStorage, and the vault folder handle from IndexedDB
  loadConfiguration();
  if (FS_SUPPORTED) {
    await restoreVaultHandle();
  }
  updateStatusPills();

  // Default target date is "Tomorrow" (also checks for an existing note)
  setDateTarget('tomorrow');
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
function setDateTarget(type) {
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
  checkExistingNote();
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
// Configuration (localStorage)
// ---------------------------------------------------------------------------

function readStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_CONFIG),
      ...parsed,
      weeklySchedule: { ...DEFAULT_CONFIG.weeklySchedule, ...(parsed.weeklySchedule || {}) }
    };
  } catch (error) {
    return structuredClone(DEFAULT_CONFIG);
  }
}

// Load configuration into state and the settings modal
function loadConfiguration() {
  const config = readStoredConfig();
  state.config = config;

  // Populate modal inputs
  document.getElementById('api-key-input').value = config.geminiApiKey || '';
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
}

// Update the header status pills from current state
function updateStatusPills() {
  const apiPill = document.getElementById('status-api');
  if (state.config.geminiApiKey) {
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

  const updatedConfig = {
    geminiApiKey: apiKey,
    vaultName: vaultName,
    saveSubfolder: subfolder,
    templatePreference: 'modern-dark',
    weeklySchedule: weeklySchedule,
    flexibleSchedule: flexibleSchedule
  };

  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedConfig));
    state.config = updatedConfig;
    showToast('설정이 이 브라우저에 저장되었습니다.', 'success');
    closeConfigModal();
    updateStatusPills();
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
  const tabButtons = document.querySelectorAll('.modal-tab-btn');
  tabButtons.forEach(btn => btn.classList.remove('active'));

  const tabPanes = document.querySelectorAll('.modal-tab-pane');
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

// Restore the previously picked vault folder (permission may need re-granting)
async function restoreVaultHandle() {
  try {
    const handle = await idbGet('vault');
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
    await idbSet('vault', handle);
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

// ---------------------------------------------------------------------------
// Gemini (called directly from the browser)
// ---------------------------------------------------------------------------

function buildGeminiRequest(rawText, date, existingMarkdown) {
  const config = state.config;

  // Calculate weekday index and name to retrieve any fixed schedules.
  // Parse YYYY-MM-DD as a local date so the weekday does not shift with the timezone.
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const KoreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const [y, m, d] = date.split('-').map(Number);
  const dayIndex = new Date(y, m - 1, d).getDay();
  const weekdayKey = days[dayIndex];
  const weekdayKorean = KoreanDays[dayIndex];

  const weeklySchedule = config.weeklySchedule || {};
  const fixedScheduleForDay = weeklySchedule[weekdayKey] || '';
  const flexibleSchedule = config.flexibleSchedule || '';

  // System prompt directing the formatting for Obsidian Daily Notes
  const systemInstruction = `
You are a highly efficient personal assistant specializing in productivity, organization, and Obsidian vault note management.
Your task is to take a user's raw, unstructured, and messy thoughts, notes, and tasks written for the next day, and organize them into a beautifully structured, clean, and highly readable daily note in Obsidian Markdown format.

Follow these strict guidelines for formatting:
1. Language: Write entirely in Korean. Keep the tone professional, neat, and highly motivating.
2. NO EMOJIS: Do NOT use any emojis, icons, or visual symbols anywhere in the document (including headers, tasks, list points, callout titles, or description text). This is a strict constraint.
3. Frontmatter: Start the note with exactly this YAML frontmatter:
---
date: ${date}
tags: [daily-notes, task-organizer, scheduler]
status: organized
---

4. NO Main Title: Do NOT include any main title or h1 header (like '# YYYY-MM-DD' or '# 데일리 노트') in the note content. The filename itself acts as the title. Directly start with the category headers (like '## 주요일정') after the frontmatter.

5. Obsidian Checklist syntax: Use "- [ ] " for all task list items so that the user can check them off in Obsidian.
6. Smart Categorization: Group all tasks intelligently into EXACTLY these four sections (NO emoji in headers) and output them in this EXACT order:
   - "주요일정": Place only day-of-week fixed schedules (요일별 고정 일정) and rotating flexible schedules (이번주 유동 일정) here. This section must be at the very top. Do not place general daily tasks here.
   - "학교": ONLY place tasks here if the user explicitly mentions "학교" (school) or "졸작" (graduation project) in the raw text. Do not place general academic/study tasks here unless those exact keywords are present.
   - "연구실": Place all general academic-related work, studying, homework, reading papers, programming, lab tasks, research work, meetings, supervisor/professor tasks here, UNLESS the task explicitly mentions "학교" or "졸작". This is the default category for generic academic or study items.
   - "기타": Place general workouts, daily chores, errands, shopping, resting, personal appointments, and other general non-academic/non-lab activities mentioned in the raw memo text here.
7. NO Callout / AI Summary: Do NOT include any summary cards, callouts, or "내일을 위한 AI 한줄 평" at the end of the note. End the note directly after the last category.
8. Handle ambiguities: If something is mentioned but doesn't have a clear category, place it neatly in the most logical of the three sections. Do not lose any information from the user's raw input. Do not make up tasks that were not in the raw input, but keep all original raw items.
9. Deliver ONLY the pure Markdown content in the response. No wrapper codeblocks (like \`\`\`markdown) in the API output.
`;

  let userPromptText = `이것은 내가 작성한 무작위 메모와 할 일 목록이야. 위의 지침에 맞게 Obsidian 데일리 노트 마크다운으로 변환해줘.

[나의 무작위 메모]:
${rawText}`;

  // Append fixed schedule if it exists for this weekday
  if (fixedScheduleForDay && fixedScheduleForDay.trim()) {
    userPromptText += `

[해당 요일(${weekdayKorean})의 나의 주간 고정 일정]:
${fixedScheduleForDay.trim()}
(지침에 따라 위 고정 주간 일정을 '주요일정' 카테고리에 할 일 항목으로 포함하여 조립해줘.)`;
  }

  // Append flexible rotating schedules if present
  if (flexibleSchedule && flexibleSchedule.trim()) {
    userPromptText += `

[나의 이번 주 유동 일정 (시간표 등)]:
${flexibleSchedule.trim()}
(위의 유동 일정 텍스트를 보고, 오늘의 요일(${weekdayKorean})에 해당하는 일정이 기재되어 있다면, 시간을 정교하게 파싱하려 하지 말고 텍스트에 쓰여 있는 일정 내용 그대로(예: '월요일 알바' 또는 '수요일 저녁 세미나') '주요일정' 카테고리에 체크박스 할 일 항목으로 심플하게 그대로 추가해줘. 오늘 요일과 전혀 관련 없는 요일의 일정은 절대로 추가하지 마.)`;
  }

  // If existing markdown was provided, instruct Gemini to perform an intelligent merge!
  if (existingMarkdown && existingMarkdown.trim()) {
    userPromptText = `이전에 생성된 기존 옵시디언 데일리 노트의 마크다운 내용이 아래에 있어. 그리고 새롭게 추가하려는 무작위 메모가 아래에 같이 적혀있어.
지침에 맞게 기존 노트의 구조와 작업 완료 상태(이미 체크완료된 - [x] 항목 등)를 그대로 보존하면서, 새로운 메모의 할 일들을 적합한 카테고리에 똑똑하게 추가/병합해줘. 기존의 다른 일정이 절대 유실되지 않도록 철저하게 머지해줘.

[기존 데일리 노트]:
${existingMarkdown}

[추가할 새로운 메모]:
${rawText}`;
  }

  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPromptText }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.3,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048
    }
  };
}

async function callGemini(rawText, date, existingMarkdown) {
  const requestBody = buildGeminiRequest(rawText, date, existingMarkdown);

  // Use Gemini 2.5 Flash as standard fast and high quality model
  const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  const apiResponse = await fetch(geminiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': state.config.geminiApiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!apiResponse.ok) {
    let detail = '';
    try {
      const errJson = await apiResponse.json();
      detail = errJson.error && errJson.error.message ? errJson.error.message : '';
    } catch (e) { /* ignore */ }
    throw new Error(`Gemini API 오류 (${apiResponse.status}) ${detail}`.trim());
  }

  const resJson = await apiResponse.json();
  const part = resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content &&
    resJson.candidates[0].content.parts && resJson.candidates[0].content.parts[0];
  if (!part || !part.text) {
    throw new Error('Gemini API 응답에서 텍스트 내용을 추출하지 못했습니다.');
  }

  // Clean up any triple backticks wrapper that Gemini might have returned despite instructions
  return part.text
    .replace(/^```markdown\n/, '')
    .replace(/^```\n/, '')
    .replace(/\n```$/, '')
    .trim();
}

// Generate Schedule by calling Gemini API
async function generateTasks() {
  const rawText = document.getElementById('raw-memo').value.trim();

  if (!rawText) {
    showToast('AI 정리를 위해 무작위 할 일을 먼저 작성해주세요.', 'error');
    return;
  }

  if (!state.config.geminiApiKey) {
    showToast('Gemini API Key 설정이 필요합니다.', 'error');
    openConfigModal();
    return;
  }

  // Switch UI states to Loading
  setLoadingState(true);

  try {
    const markdown = await callGemini(rawText, state.targetDate, state.existingMarkdown);
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
