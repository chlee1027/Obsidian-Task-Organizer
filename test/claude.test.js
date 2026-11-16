// Tests for lib/claude.js without calling the real API (the client is injected).
const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk').default;
const { buildClaudeRequest, callClaude, describeError, DEFAULT_MODEL } = require('../lib/claude');
const { buildPrompt } = require('../lib/prompt');

const CONFIG = { weeklySchedule: { monday: '월 알바' }, flexibleSchedule: '' };
const DATE = '2026-11-16'; // a Monday

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try { return fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function fakeClient(response, seen) {
  return () => ({
    beta: {
      messages: {
        create: async (req) => {
          if (seen) seen.push(req);
          if (response instanceof Error) throw response;
          return response;
        }
      }
    }
  });
}

test('request uses the shared prompt, the default model and server-side fallbacks', () => {
  withEnv({ CLAUDE_MODEL: undefined, CLAUDE_EFFORT: undefined }, () => {
    const req = buildClaudeRequest(CONFIG, '메모', DATE, '');
    const { system, user } = buildPrompt(CONFIG, '메모', DATE, '');
    assert.equal(req.model, DEFAULT_MODEL);
    assert.equal(req.system, system);
    assert.deepEqual(req.messages, [{ role: 'user', content: user }]);
    assert.ok(user.includes('월 알바'));
    assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(req.fallbacks, 'default');
    assert.equal(req.output_config, undefined);
  });
});

test('CLAUDE_MODEL and a valid CLAUDE_EFFORT are applied; an invalid effort is ignored', () => {
  withEnv({ CLAUDE_MODEL: 'claude-haiku-5-5', CLAUDE_EFFORT: 'low' }, () => {
    const req = buildClaudeRequest(CONFIG, '메모', DATE, '');
    assert.equal(req.model, 'claude-haiku-5-5');
    assert.deepEqual(req.output_config, { effort: 'low' });
  });
  withEnv({ CLAUDE_EFFORT: 'fast' }, () => {
    assert.equal(buildClaudeRequest(CONFIG, '메모', DATE, '').output_config, undefined);
  });
});

test('text blocks are joined, other blocks skipped, a code fence is removed', async () => {
  const seen = [];
  const md = await callClaude('sk-ant-test', CONFIG, '메모', DATE, '', fakeClient({
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: '```markdown\n---\ndate: 2026-11-16\n' },
      { type: 'text', text: '---\n## 주요일정\n- [ ] 월 알바\n```' }
    ]
  }, seen));
  assert.equal(md, '---\ndate: 2026-11-16\n---\n## 주요일정\n- [ ] 월 알바');
  assert.equal(seen.length, 1);
});

test('refusal, max_tokens and empty answers become Korean errors', async () => {
  await assert.rejects(
    callClaude('k', CONFIG, '메모', DATE, '', fakeClient({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] })),
    /거부했습니다 \(cyber\)/
  );
  await assert.rejects(
    callClaude('k', CONFIG, '메모', DATE, '', fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '---' }] })),
    /길이 한도/
  );
  await assert.rejects(
    callClaude('k', CONFIG, '메모', DATE, '', fakeClient({ stop_reason: 'end_turn', content: [] })),
    /비어 있습니다/
  );
});

test('SDK errors are mapped without leaking the key', async () => {
  const authError = Object.create(Anthropic.AuthenticationError.prototype);
  assert.match(describeError(authError), /키가 올바르지 않습니다/);
  const rateError = Object.create(Anthropic.RateLimitError.prototype);
  assert.match(describeError(rateError), /요청 한도/);
  assert.equal(describeError(new Error('other')), null);

  await assert.rejects(
    callClaude('sk-ant-secret-value', CONFIG, '메모', DATE, '', fakeClient(authError)),
    (err) => /키가 올바르지 않습니다/.test(err.message) && !err.message.includes('sk-ant-secret-value')
  );
});
