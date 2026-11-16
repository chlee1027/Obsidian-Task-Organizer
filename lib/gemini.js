// Builds the Gemini prompt and calls the Gemini API (server side, so the key never reaches the browser).

const { buildPrompt, stripCodeFence } = require('./prompt');

const DEFAULT_MODEL = 'gemini-3.8-flash';

function buildGeminiRequest(config, rawText, date, existingMarkdown) {
  const { system, user } = buildPrompt(config, rawText, date, existingMarkdown);
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: user }]
      }
    ],
    systemInstruction: {
      parts: [{ text: system }]
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

  return stripCodeFence(text);
}

module.exports = { buildGeminiRequest, callGemini };
