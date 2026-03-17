const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function runtimeDataDir(rootDir) {
  if (isServerlessRuntime()) {
    return path.join('/tmp', 'osl-deal-scout-data');
  }
  return path.join(rootDir, 'data');
}

function seedRuntimeFile(rootDir, fileName) {
  const runtimeDir = runtimeDataDir(rootDir);
  ensureDir(runtimeDir);
  const runtimePath = path.join(runtimeDir, fileName);
  if (fs.existsSync(runtimePath)) return runtimePath;

  const bundledPath = path.join(rootDir, 'data', fileName);
  if (fs.existsSync(bundledPath)) {
    fs.copyFileSync(bundledPath, runtimePath);
  }
  return runtimePath;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

function resolveDataPath(rootDir, fileName) {
  if (isServerlessRuntime()) {
    return seedRuntimeFile(rootDir, fileName);
  }
  return path.join(rootDir, 'data', fileName);
}

module.exports = {
  ensureDir,
  readJson,
  resolveDataPath,
  writeJson,
  writeText
};
