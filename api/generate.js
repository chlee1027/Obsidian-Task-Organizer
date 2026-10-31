const { sendJson, readJsonBody, isJsonRequest, requireUser, configKey } = require('../lib/http');
const { getJson } = require('../lib/store');
const { callGemini } = require('../lib/gemini');

module.exports = async (req, res) => {
  if (req.method !== 'POST' || !isJsonRequest(req)) {
    return sendJson(res, 405, { error: '허용되지 않는 요청입니다.' });
  }
  try {
    const username = await requireUser(req, res);
    if (!username) return;

    const { rawText, date, existingMarkdown } = await readJsonBody(req);
    if (typeof rawText !== 'string' || !rawText.trim()) {
      return sendJson(res, 400, { error: '무작위 메모 내용을 입력해주세요.' });
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return sendJson(res, 400, { error: '날짜 형식이 올바르지 않습니다.' });
    }

    const config = (await getJson(configKey(username))) || {};
    if (!config.geminiApiKey) {
      return sendJson(res, 400, { error: 'Gemini API Key가 등록되지 않았습니다. 설정에서 먼저 등록해주세요.' });
    }

    const markdown = await callGemini(
      config.geminiApiKey,
      config,
      rawText.slice(0, 20000),
      date,
      typeof existingMarkdown === 'string' ? existingMarkdown.slice(0, 50000) : ''
    );
    return sendJson(res, 200, { success: true, markdown });
  } catch (error) {
    console.error('Generation Error:', error);
    return sendJson(res, 500, { error: error.message || 'AI 생성 중 오류가 발생했습니다.' });
  }
};
