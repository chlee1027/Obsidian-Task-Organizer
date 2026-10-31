const {
  sendJson, readJsonBody, isJsonRequest, normalizeUsername, verifyUser,
  setSessionCookie, tooManyFailures, recordFailure, clearFailures
} = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST' || !isJsonRequest(req)) {
    return sendJson(res, 405, { error: '허용되지 않는 요청입니다.' });
  }
  try {
    if (await tooManyFailures(req)) {
      return sendJson(res, 429, { error: '실패가 많아 15분 동안 잠겼습니다.' });
    }
    const body = await readJsonBody(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await verifyUser(username, password))) {
      await recordFailure(req);
      return sendJson(res, 401, { error: '아이디 또는 비밀번호가 맞지 않습니다.' });
    }
    await clearFailures(req);
    await setSessionCookie(req, res, username);
    return sendJson(res, 200, { success: true, username });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
