const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildDashboardHtml, collectLeads, formatDigest, runDigest } = require('./lib/engine');
const { readJson, resolveDataPath, writeJson } = require('./lib/store');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';
const APP_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || '');

function normalizeBasePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  return '/' + raw.replace(/^\/+|\/+$/g, '');
}

function stripBasePath(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(basePath + '/')) {
    return pathname.slice(basePath.length) || '/';
  }
  return null;
}

function send(res, status, contentType, body) {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function extractPathParam(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  return decodeURIComponent(pathname.slice(prefix.length));
}

function createHandler(rootDir, options = {}) {
  const publicDir = path.join(rootDir, 'public');
  const basePath = normalizeBasePath(options.basePath || '');

  return async function handler(req, res) {
    try {
      const host = req.headers.host || `${HOST}:${PORT}`;
      const originalUrl = new URL(req.url, `http://${host}`);
      const pathname = stripBasePath(originalUrl.pathname, basePath);
      if (pathname === null) {
        return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      }

      if (pathname === '/') {
        return send(res, 200, 'text/html; charset=utf-8', buildDashboardHtml(rootDir, { basePath }));
      }

      if (pathname === '/styles.css') {
        return send(res, 200, 'text/css; charset=utf-8', fs.readFileSync(path.join(publicDir, 'styles.css')));
      }

      if (pathname === '/app.js') {
        return send(res, 200, 'application/javascript; charset=utf-8', fs.readFileSync(path.join(publicDir, 'app.js')));
      }

      if (pathname === '/favicon.svg') {
        return send(res, 200, 'image/svg+xml; charset=utf-8', fs.readFileSync(path.join(publicDir, 'favicon.svg')));
      }

      if (pathname === '/logo-mark.svg') {
        return send(res, 200, 'image/svg+xml; charset=utf-8', fs.readFileSync(path.join(publicDir, 'logo-mark.svg')));
      }

      if (pathname === '/apple-touch-icon.png') {
        return send(res, 200, 'image/png', fs.readFileSync(path.join(publicDir, 'apple-touch-icon.png')));
      }

      if (pathname === '/api/projects') {
        const data = readJson(resolveDataPath(rootDir, 'projects.json'), { generatedAt: '', projects: [] });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
      }

      if (pathname === '/api/history') {
        const data = readJson(resolveDataPath(rootDir, 'run-history.json'), { runs: [] });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
      }

      if (pathname === '/api/templates') {
        const data = readJson(resolveDataPath(rootDir, 'email-templates.json'), { templates: [] });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
      }

      if (pathname === '/api/crm-records' && req.method === 'GET') {
        const data = readJson(resolveDataPath(rootDir, 'crm-records.json'), { records: [] });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
      }

      if (pathname === '/api/crm-records' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.project_name) {
          return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'project_name is required' }));
        }
        const dataPath = resolveDataPath(rootDir, 'crm-records.json');
        const data = readJson(dataPath, { records: [] });
        const existing = data.records.findIndex((r) => r.project_name === body.project_name);
        if (existing >= 0) data.records[existing] = body;
        else data.records.push(body);
        writeJson(dataPath, data);
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, record: body }));
      }

      const crmUpdateName = extractPathParam(pathname, '/api/crm-records/');
      if (crmUpdateName && req.method === 'PUT') {
        const body = await readJsonBody(req);
        body.project_name = crmUpdateName;
        const dataPath = resolveDataPath(rootDir, 'crm-records.json');
        const data = readJson(dataPath, { records: [] });
        const existing = data.records.findIndex((r) => r.project_name === crmUpdateName);
        if (existing >= 0) data.records[existing] = body;
        else data.records.push(body);
        writeJson(dataPath, data);
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, record: body }));
      }

      if (crmUpdateName && req.method === 'DELETE') {
        const dataPath = resolveDataPath(rootDir, 'crm-records.json');
        const data = readJson(dataPath, { records: [] });
        data.records = data.records.filter((r) => r.project_name !== crmUpdateName);
        writeJson(dataPath, data);
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
      }

      if (pathname === '/api/project-rules') {
        const data = readJson(resolveDataPath(rootDir, 'project-rules.json'), { whitelist: [], blacklist: [] });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
      }

      if (pathname === '/api/refresh' && req.method === 'POST') {
        const data = await collectLeads(rootDir);
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
      }

      if (pathname === '/api/digest' && req.method === 'GET') {
        const data = readJson(resolveDataPath(rootDir, 'projects.json'), { generatedAt: '', projects: [] });
        const config = readJson(resolveDataPath(rootDir, 'config.json'), {});
        const text = formatDigest(data.projects || [], config);
        return send(res, 200, 'text/plain; charset=utf-8', text);
      }

      if (pathname === '/api/digest/run' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await runDigest(rootDir, { push: Boolean(body.push) });
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(result, null, 2));
      }

      if (pathname === '/api/export/csv' && req.method === 'GET') {
        const projectPayload = readJson(resolveDataPath(rootDir, 'projects.json'), {
          projects: [],
          strictProjects: [],
          fundraisingProjects: [],
          dexProjects: [],
          ecosystemProjects: []
        });
        const crmRecords = readJson(resolveDataPath(rootDir, 'crm-records.json'), { records: [] }).records || [];
        const crmFields = readJson(resolveDataPath(rootDir, 'crm-fields.json'), { fields: [] }).fields || [];
        const crmMap = new Map(crmRecords.map((r) => [r.project_name, r]));
        const exportedProjects = new Map();

        const collectProjects = (list, bucket) => {
          (list || []).forEach((project) => {
            if (!project || !project.name) return;
            const existing = exportedProjects.get(project.name) || { ...project, exportBuckets: [] };
            const nextBuckets = new Set([...(existing.exportBuckets || []), bucket]);
            exportedProjects.set(project.name, {
              ...existing,
              ...project,
              exportBuckets: Array.from(nextBuckets)
            });
          });
        };

        collectProjects(projectPayload.projects || [], 'strict');
        collectProjects(projectPayload.fundraisingProjects || [], 'fundraising');
        collectProjects(projectPayload.dexProjects || [], 'dex');
        collectProjects(projectPayload.ecosystemProjects || [], 'ecosystem');
        const projects = Array.from(exportedProjects.values());

        const headers = [
          'name', 'score', 'priorityBand', 'sector', 'freshness', 'region', 'stage',
          'discoveryPath', 'radarBucket', 'exportBuckets',
          'reasonSummary', 'fitSummary', 'website', 'twitter', 'nextStep',
          ...crmFields.map((f) => 'crm_' + f.key)
        ];

        const escapeCsv = (val) => {
          const s = String(val || '');
          if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        };

        const rows = [headers.map(escapeCsv).join(',')];
        projects.forEach((p) => {
          const crm = crmMap.get(p.name) || {};
          const row = [
            p.name, p.score, p.priorityBand, p.sector, p.freshness, p.region, p.stage,
            p.discoveryPath, p.radarBucket, (p.exportBuckets || []).join('|'),
            p.reasonSummary, p.fitSummary, p.website, p.twitter, p.nextStep,
            ...crmFields.map((f) => crm[f.key] || '')
          ];
          rows.push(row.map(escapeCsv).join(','));
        });

        const csvContent = '\uFEFF' + rows.join('\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="osl-deal-scout-export.csv"'
        });
        return res.end(csvContent);
      }

      return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    } catch (error) {
      return send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
    }
  };
}

const handler = createHandler(ROOT_DIR, { basePath: APP_BASE_PATH });

if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    const displayBase = APP_BASE_PATH || '';
    process.stdout.write(`OSL Deal Scout running at http://${HOST}:${PORT}${displayBase || ''}\n`);
  });
}

module.exports = handler;
module.exports.createHandler = createHandler;
