#!/usr/bin/env node
/**
 * Forwards CLI args to bin/cli.js so `npm run report -- /path` and `npm run report /path`
 * both work across npm versions. If no args, uses REPORT_TARGET when set.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const cli = path.join(__dirname, '..', 'bin', 'cli.js');
let args = process.argv.slice(2);

if (args.length === 0 && process.env.REPORT_TARGET) {
  args = [process.env.REPORT_TARGET.trim()].filter(Boolean);
}

const result = spawnSync(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
