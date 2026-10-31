const { sendJson, isJsonRequest, clearSessionCookie } = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST' || !isJsonRequest(req)) {
    return sendJson(res, 405, { error: '허용되지 않는 요청입니다.' });
  }
  clearSessionCookie(req, res);
  return sendJson(res, 200, { success: true });
};
