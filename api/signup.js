const {
  USERNAME_RE, MIN_PASSWORD_LENGTH, sendJson, readJsonBody, isJsonRequest,
  normalizeUsername, createUser, setSessionCookie, signupLimitReached, recordSignup
} = require('../lib/http');

// Open sign-up: anyone can create an account with a username and password.
// A per-IP limit keeps automated mass sign-ups from filling the Redis store.
module.exports = async (req, res) => {
  if (req.method !== 'POST' || !isJsonRequest(req)) {
    return sendJson(res, 405, { error: '허용되지 않는 요청입니다.' });
  }
  try {
    const body = await readJsonBody(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!USERNAME_RE.test(username)) {
      return sendJson(res, 400, { error: '아이디는 영문 소문자·숫자·_·- 로 3~20자여야 합니다.' });
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
      return sendJson(res, 400, { error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` });
    }
    if (await signupLimitReached(req)) {
      return sendJson(res, 429, { error: '이 네트워크에서 가입이 많아 1시간 동안 가입이 막혔습니다.' });
    }
    if (!(await createUser(username, password))) {
      return sendJson(res, 409, { error: '이미 있는 아이디입니다.' });
    }
    await recordSignup(req);
    await setSessionCookie(req, res, username);
    return sendJson(res, 200, { success: true, username });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
