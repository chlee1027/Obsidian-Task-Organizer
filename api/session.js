const { sendJson, getSessionUser } = require('../lib/http');

module.exports = async (req, res) => {
  try {
    const username = await getSessionUser(req);
    return sendJson(res, 200, {
      authenticated: Boolean(username),
      username: username || null,
      signupOpen: Boolean(process.env.SIGNUP_CODE)
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
