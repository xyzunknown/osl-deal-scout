const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveDataPath(rootDir, fileName) {
  return path.join(rootDir, 'data', fileName);
}

module.exports = {
  ensureDir,
  readJson,
  resolveDataPath,
  writeJson,
  writeText
};
