// Application Global State
const state = {
  config: {
    geminiApiKey: '',
    obsidianVaultPath: '',
    saveSubfolder: 'Daily Notes',
    templatePreference: 'modern-dark',
    hasApiKey: false
  },
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

  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Default target date is "Tomorrow"
  setDateTarget('tomorrow');

  // Load configuration from local server
  await loadConfiguration();
  
  // Check if an existing note is already present
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

// Load Configuration from backend
async function loadConfiguration() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('설정을 가져오지 못했습니다.');
    
    const configData = await response.json();
    state.config = configData;

    // Update Status pills based on configuration
    const apiPill = document.getElementById('status-api');
    if (configData.hasApiKey) {
      apiPill.className = 'status-pill status-success';
      apiPill.querySelector('.status-text').textContent = 'API Key 연결됨';
    } else {
      apiPill.className = 'status-pill status-error';
      apiPill.querySelector('.status-text').textContent = 'API Key 미설정';
    }

    const vaultPill = document.getElementById('status-vault');
    if (configData.obsidianVaultPath) {
      vaultPill.className = 'status-pill status-success';
      vaultPill.querySelector('.status-text').textContent = 'Vault 연결됨';
    } else {
      vaultPill.className = 'status-pill status-error';
      vaultPill.querySelector('.status-text').textContent = 'Vault 미설정';
    }

    // Populate modal inputs
    document.getElementById('api-key-input').value = configData.geminiApiKey || '';
    document.getElementById('vault-path-input').value = configData.obsidianVaultPath || '';
    document.getElementById('subfolder-input').value = configData.saveSubfolder || '';

    // Populate weekly schedules
    const weekly = configData.weeklySchedule || {};
    document.getElementById('sched-monday').value = weekly.monday || '';
    document.getElementById('sched-tuesday').value = weekly.tuesday || '';
    document.getElementById('sched-wednesday').value = weekly.wednesday || '';
    document.getElementById('sched-thursday').value = weekly.thursday || '';
    document.getElementById('sched-friday').value = weekly.friday || '';
    document.getElementById('sched-saturday').value = weekly.saturday || '';
    document.getElementById('sched-sunday').value = weekly.sunday || '';

    // Populate flexible schedule
    document.getElementById('flexible-schedule-input').value = configData.flexibleSchedule || '';

  } catch (error) {
    showToast('설정 로드 실패: ' + error.message, 'error');
  }
}

// Save Configuration
async function saveConfiguration() {
  const apiKey = document.getElementById('api-key-input').value.trim();
  const vaultPath = document.getElementById('vault-path-input').value.trim();
  const subfolder = document.getElementById('subfolder-input').value.trim();

  if (!vaultPath) {
    showToast('Obsidian Vault 경로는 필수 입력사항입니다.', 'error');
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
    obsidianVaultPath: vaultPath,
    saveSubfolder: subfolder,
    templatePreference: 'modern-dark',
    weeklySchedule: weeklySchedule,
    flexibleSchedule: flexibleSchedule
  };

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatedConfig)
    });

    if (!response.ok) throw new Error('서버 저장 실패');

    const result = await response.json();
    if (result.success) {
      showToast('설정이 안전하게 저장되었습니다!', 'success');
      closeConfigModal();
      await loadConfiguration(); // Reload status indicator
      await checkExistingNote(); // Check if existing note is present with new vault path
    } else {
      showToast('설정 저장 중 오류: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('설정 저장 중 연결 에러: ' + error.message, 'error');
  }
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
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        rawText: rawText,
        date: state.targetDate,
        existingMarkdown: state.existingMarkdown
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'AI 변환 중 오류가 발생했습니다.');
    }

    const data = await response.json();
    if (data.success && data.markdown) {
      state.generatedMarkdown = data.markdown;
      
      // Update UI Result State
      document.getElementById('output-state-empty').classList.add('hidden');
      document.getElementById('output-state-loading').classList.add('hidden');
      document.getElementById('output-state-result').classList.remove('hidden');
      
      document.getElementById('preview-tabs').classList.remove('hidden');
      document.getElementById('output-actions').classList.remove('hidden');

      // Populate text editor
      document.getElementById('markdown-output').value = data.markdown;
      
      // Render beautiful preview
      renderMarkdownVisual(data.markdown);
      switchPreviewTab('visual');

      showToast('AI가 일정을 아주 깔끔하게 구조화했습니다!', 'success');
    } else {
      throw new Error('마크다운 데이터를 정상적으로 로드하지 못했습니다.');
    }

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

// Save generated note into local Obsidian Vault via express server
async function saveToObsidian() {
  if (!state.generatedMarkdown) {
    showToast('저장할 마크다운 데이터가 없습니다.', 'error');
    return;
  }

  if (!state.config.obsidianVaultPath) {
    showToast('Obsidian Vault 폴더 경로가 없습니다. 설정에서 먼저 등록해주세요.', 'error');
    openConfigModal();
    return;
  }

  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        date: state.targetDate,
        markdownContent: state.generatedMarkdown
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || '저장하는 중 에러가 발생했습니다.');
    }

    const data = await response.json();
    if (data.success) {
      showToast(`저장 완료! 옵시디언에서 즉시 열어보실 수 있습니다.`, 'success');
      await checkExistingNote(); // Update indicator state to show file exists now
      
      // Flash glowing green indicator briefly on the right panel
      const outputPanel = document.querySelector('.output-panel');
      outputPanel.style.borderColor = 'var(--accent-green)';
      setTimeout(() => {
        outputPanel.style.borderColor = '';
      }, 1500);
    }
  } catch (error) {
    showToast('저장 실패: ' + error.message, 'error');
  }
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
  // This is a premium micro-feature: If they check/uncheck in UI, we update the markdown code!
  updateMarkdownCheckboxState(taskItem.querySelector('.task-item-text').textContent, checkbox.checked);
}

// Update state markdown representation when checklist is toggled in visual view
function updateMarkdownCheckboxState(taskText, isChecked) {
  let markdown = state.generatedMarkdown;
  const oldText = isChecked ? `- [ ] ${taskText}` : `- [x] ${taskText}`;
  const newText = isChecked ? `- [x] ${taskText}` : `- [ ] ${taskText}`;
  
  // Safe replacement logic
  if (markdown.includes(oldText)) {
    markdown = markdown.replace(oldText, newText);
  } else {
    // In case spaces differ
    const regex = new RegExp(`-\\s*\\[[ xX]\\s*\\]\\s*${escapeRegExp(taskText)}`, 'g');
    markdown = markdown.replace(regex, newText);
  }
  
  state.generatedMarkdown = markdown;
  document.getElementById('markdown-output').value = markdown;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
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
            html += `<div class="frontmatter-line"><span class="frontmatter-key">${key}</span>: ${val}</div>`;
          } else {
            html += `<div class="frontmatter-line">${fLine}</div>`;
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
            <div class="callout-title"><i data-lucide="${calloutIcon}"></i> ${calloutType} ${extraTitle}</div>
            <div class="callout-body">`;
        }
        continue;
      }
      
      if (inCallout) {
        // Handle list bullet points inside callouts
        if (content.startsWith('-')) {
          content = '• ' + content.substring(1).trim();
        }
        calloutLines.push(content);
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
      html += `<h1>${title}</h1>`;
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
      
      html += `<h2><i data-lucide="${icon}"></i> ${title}</h2>`;
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
          <span class="task-item-text">${taskText}</span>
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
        html += `<li style="font-size: 13.5px; color: var(--text-secondary); margin-left: 14px; margin-bottom: 6px; list-style-type: disc;">${line.substring(1).trim()}</li>`;
      } else {
        html += `<p style="font-size: 13.5px; color: var(--text-secondary); margin-bottom: 8px;">${line}</p>`;
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
  toast.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${message}</span>
  `;
  
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
async function checkExistingNote() {
  const banner = document.getElementById('existing-note-banner');
  if (!banner) return;
  
  banner.classList.add('hidden'); // Hide by default
  state.existingMarkdown = '';    // Reset state

  if (!state.config.obsidianVaultPath) return;

  try {
    const response = await fetch(`/api/load?date=${state.targetDate}`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.exists && data.markdown) {
      // Keep track of the loaded existing note
      state.existingMarkdown = data.markdown;
      banner.classList.remove('hidden');
    }
  } catch (error) {
    console.error('기존 노트를 조회하는 중 에러가 발생했습니다.');
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

  showToast('보관소의 기존 일정을 불러왔습니다. 새로운 할 일을 왼쪽에 추가로 입력한 뒤 AI 정리를 누르면 일정이 스마트하게 합쳐집니다.', 'success');
}
