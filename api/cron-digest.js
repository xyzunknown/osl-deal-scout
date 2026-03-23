const path = require('path');
const { runDigest } = require('../lib/engine');

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}

module.exports = async function cronDigestHandler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
  }

  try {
    const rootDir = path.join(__dirname, '..');
    const result = await runDigest(rootDir, { push: true, trigger: 'auto' });
    return sendJson(res, 200, {
      ok: true,
      pushed: result.pushed,
      target: result.target || '',
      projectCount: Array.isArray(result.projects) ? result.projects.length : 0
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
};
