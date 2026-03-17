const path = require('path');
const { runDigest } = require('./lib/engine');

async function main() {
  const rootDir = __dirname;
  const shouldPush = process.argv.includes('--push');
  const result = await runDigest(rootDir, { push: shouldPush });
  process.stdout.write(result.text + '\n');
  process.stdout.write(`\nPush: ${result.pushed ? `sent to ${result.target}` : 'skipped'}\n`);
}

main().catch((error) => {
  process.stderr.write(`Digest failed: ${error.message}\n`);
  process.exit(1);
});
