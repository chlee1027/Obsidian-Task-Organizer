const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Helper to clean paths of double quotes (e.g. copied from Windows Explorer)
function cleanPath(p) {
  if (!p) return '';
  let cleaned = p.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  return cleaned.trim();
}

// Helper to read config
async function readConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Return default empty config if file doesn't exist
    return {
      geminiApiKey: '',
      obsidianVaultPath: '',
      saveSubfolder: 'Daily Notes',
      templatePreference: 'modern-dark',
      flexibleSchedule: '', // For weekly rotating schedules like part-time shifts
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
  }
}

// Helper to write config
async function writeConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// API: Get configurations
app.get('/api/config', async (req, res) => {
  try {
    const config = await readConfig();
    // Return config with masked API key for security, but allow UI to see if it exists
    res.json({
      ...config,
      hasApiKey: !!config.geminiApiKey,
      // Provide a masked version or keep it empty if not set
      geminiApiKey: config.geminiApiKey ? '••••••••••••••••' : ''
    });
  } catch (error) {
    res.status(500).json({ error: '설정을 읽는 중 오류가 발생했습니다.' });
  }
});

// API: Save configurations
app.post('/api/config', async (req, res) => {
  try {
    const newConfig = req.body;
    const currentConfig = await readConfig();

    // If API Key is sent as masked, keep the existing API Key
    if (newConfig.geminiApiKey === '••••••••••••••••') {
      newConfig.geminiApiKey = currentConfig.geminiApiKey;
    }

    // Strip double quotes if present from copy-pasting paths
    newConfig.obsidianVaultPath = cleanPath(newConfig.obsidianVaultPath);
    newConfig.saveSubfolder = cleanPath(newConfig.saveSubfolder);

    await writeConfig(newConfig);
    res.json({ success: true, message: '설정이 성공적으로 저장되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '설정을 저장하는 중 오류가 발생했습니다.' });
  }
});

// API: Generate daily note using Gemini API
app.post('/api/generate', async (req, res) => {
  const { rawText, date, existingMarkdown } = req.body;

  if (!rawText || !rawText.trim()) {
    return res.status(400).json({ error: '무작위 메모 내용을 입력해주세요.' });
  }

  try {
    const config = await readConfig();
    const apiKey = config.geminiApiKey;

    if (!apiKey) {
      return res.status(400).json({ error: 'Gemini API Key가 등록되지 않았습니다. 설정에서 먼저 등록해주세요.' });
    }

    // Calculate weekday index and name to retrieve any fixed schedules
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const KoreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dateObj = new Date(date);
    const dayIndex = dateObj.getDay();
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

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: userPromptText
            }
          ]
        }
      ],
      systemInstruction: {
        parts: [
          {
            text: systemInstruction
          }
        ]
      },
      generationConfig: {
        temperature: 0.3,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
      }
    };

    // Use Gemini 2.5 Flash as standard fast and high quality model
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      throw new Error(`Gemini API Error: ${apiResponse.status} - ${errText}`);
    }

    const resJson = await apiResponse.json();
    let generatedMarkdown = '';
    
    if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content && resJson.candidates[0].content.parts[0]) {
      generatedMarkdown = resJson.candidates[0].content.parts[0].text;
    } else {
      throw new Error('Gemini API 응답에서 텍스트 내용을 추출하지 못했습니다.');
    }

    // Clean up any triple backticks wrapper that Gemini might have returned despite instructions
    generatedMarkdown = generatedMarkdown.replace(/^```markdown\n/, '').replace(/^```\n/, '').replace(/\n```$/, '');

    res.json({ success: true, markdown: generatedMarkdown.trim() });

  } catch (error) {
    console.error('Generation Error:', error);
    res.status(500).json({ error: error.message || 'AI 생성 중 오류가 발생했습니다. API Key 상태를 확인해 주세요.' });
  }
});

// API: Load existing daily note from Obsidian vault
app.get('/api/load', async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: '날짜를 지정해 주세요.' });
  }

  try {
    const config = await readConfig();
    const vaultPath = cleanPath(config.obsidianVaultPath);
    const subfolder = cleanPath(config.saveSubfolder || '');

    if (!vaultPath) {
      return res.json({ exists: false, message: 'Vault 경로가 설정되지 않았습니다.' });
    }

    let targetDirectory = path.resolve(vaultPath);
    if (subfolder) {
      targetDirectory = path.join(targetDirectory, subfolder);
    }

    // Group by month: Append YYYY-MM subfolder
    if (date && date.includes('-')) {
      const parts = date.split('-');
      if (parts.length >= 2) {
        targetDirectory = path.join(targetDirectory, `${parts[0]}-${parts[1]}`);
      }
    }

    const fileName = `${date}.md`;
    const filePath = path.join(targetDirectory, fileName);

    try {
      const data = await fs.readFile(filePath, 'utf8');
      res.json({ exists: true, markdown: data });
    } catch (err) {
      // File does not exist
      res.json({ exists: false });
    }

  } catch (error) {
    console.error('Load File Error:', error);
    res.status(500).json({ error: `파일을 읽는 과정에서 오류가 발생했습니다: ${error.message}` });
  }
});

// API: Save markdown file directly to Obsidian vault path
app.post('/api/save', async (req, res) => {
  const { date, markdownContent } = req.body;

  if (!markdownContent) {
    return res.status(400).json({ error: '저장할 내용이 없습니다.' });
  }

  try {
    const config = await readConfig();
    const vaultPath = cleanPath(config.obsidianVaultPath);
    const subfolder = cleanPath(config.saveSubfolder || '');

    if (!vaultPath) {
      return res.status(400).json({ error: 'Obsidian 보관소(Vault) 경로가 설정되지 않았습니다. 설정에서 먼저 등록해주세요.' });
    }

    // Normalize path and join with subfolder if provided
    let targetDirectory = path.resolve(vaultPath);
    if (subfolder) {
      targetDirectory = path.join(targetDirectory, subfolder);
    }

    // Group by month: Append YYYY-MM subfolder
    if (date && date.includes('-')) {
      const parts = date.split('-');
      if (parts.length >= 2) {
        targetDirectory = path.join(targetDirectory, `${parts[0]}-${parts[1]}`);
      }
    }

    // Create target directory if it doesn't exist
    await fs.mkdir(targetDirectory, { recursive: true });

    // Filename: YYYY-MM-DD.md
    const fileName = `${date}.md`;
    const filePath = path.join(targetDirectory, fileName);

    // Write file
    await fs.writeFile(filePath, markdownContent, 'utf8');

    res.json({
      success: true,
      filePath: filePath,
      fileName: fileName,
      message: `성공적으로 저장되었습니다! 저장된 경로: ${filePath}`
    });

  } catch (error) {
    console.error('Save File Error:', error);
    res.status(500).json({ error: `파일을 저장하는 과정에서 오류가 발생했습니다: ${error.message}. 경로와 권한을 확인해주세요.` });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Obsidian AI Scheduler Server is running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
