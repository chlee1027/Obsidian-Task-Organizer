// Calls the Claude API with the same prompt as lib/gemini.js (server side, so the key never reaches the browser).

const Anthropic = require('@anthropic-ai/sdk').default;
const { buildPrompt, stripCodeFence } = require('./prompt');

// Set CLAUDE_MODEL to switch models without a code change.
const DEFAULT_MODEL = 'claude-sonnet-5-5';
// Optional CLAUDE_EFFORT (low | medium | high | xhigh | max). Unset means the model default.
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// The Vercel function for /api/generate may run for 60 s, so stop a little before that
// and do not retry inside the same request.
const REQUEST_TIMEOUT_MS = 55000;

function buildClaudeRequest(config, rawText, date, existingMarkdown) {
  const { system, user } = buildPrompt(config, rawText, date, existingMarkdown);
  const model = (process.env.CLAUDE_MODEL || DEFAULT_MODEL).trim();
  const effort = (process.env.CLAUDE_EFFORT || '').trim();

  const request = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    // If a safety classifier declines the request, the API re-runs it on a fallback model
    // chosen by refusal category inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default'
  };
  if (EFFORTS.has(effort)) {
    request.output_config = { effort };
  }
  return request;
}

// Turns SDK errors into short Korean messages; never includes the key
function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Claude API 키가 올바르지 않습니다. 설정에서 키를 다시 확인해주세요.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'Claude API 키에 이 모델을 쓸 권한이 없습니다.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Claude API 요청 한도에 걸렸습니다. 잠시 뒤 다시 시도해주세요.';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Claude API 요청 오류 (400) ${error.message}`.trim();
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return 'Claude API 응답이 시간 안에 오지 않았습니다. 메모를 나눠서 다시 시도해주세요.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Claude API 에 연결하지 못했습니다. 잠시 뒤 다시 시도해주세요.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Claude API 오류 (${error.status}) ${error.message}`.trim();
  }
  return null;
}

// makeClient is injectable for tests
async function callClaude(apiKey, config, rawText, date, existingMarkdown, makeClient) {
  const client = makeClient
    ? makeClient(apiKey)
    : new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
  const request = buildClaudeRequest(config, rawText, date, existingMarkdown);

  let response;
  try {
    response = await client.beta.messages.create(request);
  } catch (error) {
    const message = describeError(error);
    if (message) throw new Error(message);
    throw error;
  }

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details && response.stop_details.category;
    throw new Error(`Claude 가 요청을 거부했습니다${category ? ` (${category})` : ''}.`);
  }

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude 응답이 길이 한도에 걸려 잘렸습니다. 메모를 나눠서 다시 시도해주세요.');
  }
  if (!text.trim()) {
    console.error('Claude empty response:', JSON.stringify({ stop_reason: response.stop_reason, usage: response.usage }));
    throw new Error(`Claude 응답이 비어 있습니다 (stop_reason: ${response.stop_reason || '없음'}).`);
  }

  return stripCodeFence(text);
}

module.exports = { buildClaudeRequest, callClaude, describeError, DEFAULT_MODEL };
