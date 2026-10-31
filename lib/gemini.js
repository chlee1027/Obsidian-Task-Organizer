// Builds the Gemini prompt and calls the Gemini API (server side, so the key never reaches the browser).

const DEFAULT_MODEL = 'gemini-3.8-flash';

function buildGeminiRequest(config, rawText, date, existingMarkdown) {

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
      // Sampling is left at the model defaults: Google recommends keeping temperature at 1.0
      // for Gemini 3 models (lower values can cause looping).
      // The model thinks before answering and thinking tokens count toward this limit,
      // so leave generous room or the answer can come back empty.
      maxOutputTokens: 16384
    }
  };
}

async function callGemini(apiKey, config, rawText, date, existingMarkdown) {
  const requestBody = buildGeminiRequest(config, rawText, date, existingMarkdown);

  // gemini-2.5-flash is no longer available to new API keys (404), so default to 3.8 Flash.
  // Set the GEMINI_MODEL environment variable to switch models without a code change.
  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const apiResponse = await fetch(geminiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
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
  const candidate = resJson.candidates && resJson.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  // Join every answer part (skip thought summaries, if any)
  const text = parts.filter(p => p && p.text && !p.thought).map(p => p.text).join('');

  if (!text) {
    const blockReason = resJson.promptFeedback && resJson.promptFeedback.blockReason;
    const finishReason = candidate && candidate.finishReason;
    console.error('Gemini empty response:', JSON.stringify({ blockReason, finishReason, usage: resJson.usageMetadata }));
    if (blockReason) {
      throw new Error(`Gemini 가 요청을 거부했습니다 (${blockReason}).`);
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini 응답이 길이 한도에 걸려 비어 있습니다. 메모를 나눠서 다시 시도해주세요.');
    }
    throw new Error(`Gemini 응답이 비어 있습니다 (finishReason: ${finishReason || '없음'}).`);
  }

  // Clean up any triple backticks wrapper that Gemini might have returned despite instructions
  return text
    .replace(/^```markdown\n/, '')
    .replace(/^```\n/, '')
    .replace(/\n```$/, '')
    .trim();
}

module.exports = { buildGeminiRequest, callGemini };
