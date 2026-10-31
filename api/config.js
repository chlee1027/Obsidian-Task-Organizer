const { sendJson, readJsonBody, isJsonRequest, requireUser, configKey } = require('../lib/http');
const { getJson, setJson } = require('../lib/store');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function str(v, max = 5000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function cleanPath(p) {
  let cleaned = str(p, 500);
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1);
  return cleaned.trim().replace(/^[\/]+|[\/]+$/g, '');
}

// What the browser may see: everything except the API key itself
function publicView(config) {
  return {
    hasApiKey: Boolean(config.geminiApiKey),
    vaultName: config.vaultName || '',
    saveSubfolder: config.saveSubfolder ?? 'Daily Notes',
    weeklySchedule: config.weeklySchedule || {},
    flexibleSchedule: config.flexibleSchedule || ''
  };
}

module.exports = async (req, res) => {
  try {
    const username = await requireUser(req, res);
    if (!username) return;
    const key = configKey(username);
    const current = (await getJson(key)) || {};

    if (req.method === 'GET') {
      return sendJson(res, 200, publicView(current));
    }

    if (req.method === 'POST' && isJsonRequest(req)) {
      const body = await readJsonBody(req);
      const weeklyIn = body.weeklySchedule && typeof body.weeklySchedule === 'object' ? body.weeklySchedule : {};
      const weeklySchedule = {};
      DAYS.forEach(d => { weeklySchedule[d] = str(weeklyIn[d], 1000); });

      const next = {
        // An empty key field means "keep the saved key"; clearApiKey removes it explicitly
        geminiApiKey: body.clearApiKey ? '' : (str(body.geminiApiKey, 200) || current.geminiApiKey || ''),
        vaultName: str(body.vaultName, 200),
        saveSubfolder: cleanPath(body.saveSubfolder),
        weeklySchedule,
        flexibleSchedule: str(body.flexibleSchedule, 5000)
      };
      await setJson(key, next);
      return sendJson(res, 200, { success: true, config: publicView(next) });
    }

    return sendJson(res, 405, { error: '허용되지 않는 요청입니다.' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};

