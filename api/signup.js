const {
  USERNAME_RE, MIN_PASSWORD_LENGTH, sendJson, readJsonBody, isJsonRequest, safeEqual,
  normalizeUsername, createUser, setSessionCookie, tooManyFailures, recordFailure
} = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST' || !isJsonRequest(req)) {
    return sendJson(res, 405, { error: '허용되지 않는 요청입니다.' });
  }
  const signupCode = process.env.SIGNUP_CODE || '';
  if (!signupCode) {
    return sendJson(res, 403, { error: '가입이 열려 있지 않습니다. (서버에 SIGNUP_CODE 미설정)' });
  }
  try {
    if (await tooManyFailures(req)) {
      return sendJson(res, 429, { error: '실패가 많아 15분 동안 잠겼습니다.' });
    }
    const body = await readJsonBody(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';

    if (!safeEqual(code, signupCode)) {
      await recordFailure(req);
      return sendJson(res, 403, { error: '가입 코드가 맞지 않습니다.' });
    }
    if (!USERNAME_RE.test(username)) {
      return sendJson(res, 400, { error: '아이디는 영문 소문자·숫자·_·- 로 3~20자여야 합니다.' });
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
      return sendJson(res, 400, { error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` });
    }
    if (!(await createUser(username, password))) {
      return sendJson(res, 409, { error: '이미 있는 아이디입니다.' });
    }
    await setSessionCookie(req, res, username);
    return sendJson(res, 200, { success: true, username });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
