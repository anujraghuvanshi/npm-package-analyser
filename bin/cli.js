#!/usr/bin/env node
/**
 * Smart Dependency Report CLI
 *
 * Usage:
 *   npx npm-package-analyser <path-to-project>
 *
 * Resolves direct + transitive packages from package-lock.json or Yarn v1 yarn.lock when present.
 *
 * Options:
 *   --major-only          Only packages with a semver MAJOR update available
 *   --sort=update-type    Sort by update severity, then name
 *   --sort=name           Sort by package name (default)
 *   --sort=security       Sort by worst advisory severity, then name (alias: severity)
 *   --yes-pdf             Write PDF to ~/Documents without prompting
 *   --no-pdf              Do not prompt and do not write PDF
 *   --no-interactive      Skip questionnaires; defaults + --sort for table order
 *   --help, -h            Show help
 *
 * Environment (optional):
 *   DEPENDENCY_REPORT_OSV_API           OSV API base (default: https://api.osv.dev)
 *   DEPENDENCY_REPORT_OSV_TIMEOUT_MS    OSV HTTP timeout ms (default: 120000)
 *   REPORT_SKIP_AUDIT                   Set to 1 to skip OSV (Secure column unknown)
 *   DEPENDENCY_REPORT_SECURE_ICON_URL   Optional HTTPS URL for PDF secure-cell image
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const chalk = require('chalk');
const ora = require('ora');
const { run } = require('../lib/runReport');
const { writePdfReport } = require('../lib/reportPdf');
const { promptReportPreferences, shouldPromptInteractively } = require('../lib/promptReport');
const {
  defaultReportPreferences,
  preferencesEqual,
} = require('../lib/reportPreferences');

/**
 * @param {string} dest
 * @param {object[]} tableRows
 * @param {import('../lib/reportPreferences').ReportPreferences} [preferences]
 * @param {object[]} [summaryRows] full analyzed rows for PDF summary (defaults to tableRows)
 */
async function writePdfReportWithProgress(dest, tableRows, preferences, summaryRows) {
  const useSpin =
    process.stdout.isTTY &&
    process.env.REPORT_NO_PROGRESS !== '1' &&
    process.env.CI !== 'true';
  const spin = useSpin
    ? ora({ text: 'Writing PDF…', color: 'cyan', discardStdin: true }).start()
    : null;
  try {
    await writePdfReport(dest, tableRows, { preferences, summaryRows });
  } finally {
    if (spin) {
      spin.stop();
    }
  }
}

/**
 * @param {number} ms
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(2)} s`;
  }
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}m ${r.toFixed(1)} s`;
}

function printHelp() {
  console.log(`
Smart Dependency Report (npm-package-analyser)

Usage:
  npm-package-analyser <path-to-project>
  npx npm-package-analyser <path-to-project>

The path must be a directory that contains package.json (Node.js / npm project).

Options:
  --major-only          Only include packages with a semver MAJOR update available
  --sort=update-type    Sort by update severity (Major → Minor → Patch → …), then name
  --sort=security       Sort by worst known advisory severity, then name (alias: --sort=severity)
  --sort=name           Sort alphabetically by package name (default)
  --yes-pdf             Export PDF to your Documents folder without prompting
  --no-pdf              Skip PDF export and do not prompt
  --no-interactive      Skip all questionnaires (same as REPORT_NON_INTERACTIVE=1)
  --help, -h            Show this help

In an interactive terminal, you answer a few multiple-choice prompts before the table
(arrow keys to move, Enter to confirm): severity focus, lockfile scope, table contents,
sort. The same prompts run again if you export a PDF, unless you use --no-interactive
or REPORT_NON_INTERACTIVE=1.

After the report, if your terminal is interactive, you may be asked whether to save a PDF
to: ~/Documents/dependency-report-YYYY-MM-DD-HHmm.pdf

Lockfiles: package-lock.json (preferred if present) or yarn.lock lists all resolved packages,
including transitives, for the table and OSV checks.

Privacy: No analytics or telemetry. Network calls go only to the public npm registry and
OSV.dev (see README) for metadata and vulnerability data.

Environment:
  DEPENDENCY_REPORT_OSV_API           OSV API base (default: https://api.osv.dev)
  DEPENDENCY_REPORT_OSV_TIMEOUT_MS    Timeout ms for OSV requests (default: 120000)
  REPORT_SKIP_AUDIT                   Set to 1 to skip OSV
  DEPENDENCY_REPORT_SECURE_ICON_URL   Optional image URL for PDF secure column
  REPORT_TARGET                       When set, npm run report with no args uses this path
  REPORT_NO_PROGRESS                  Set to 1 to disable spinner and phase logs
  REPORT_NON_INTERACTIVE              Set to 1 to skip questionnaires (same as --no-interactive)
`);
}

/**
 * @param {'name' | 'update-type' | 'security'} sort
 */
function tableSortFromCli(sort) {
  if (sort === 'update-type') {
    return 'update-type';
  }
  if (sort === 'security') {
    return 'security';
  }
  return 'name';
}

/**
 * @param {{ noInteractive: boolean, sort: string }} parsed
 * @returns {Promise<import('../lib/reportPreferences').ReportPreferences>}
 */
async function resolveReportPreferences(parsed) {
  const allowPrompt =
    !parsed.noInteractive &&
    process.env.REPORT_NON_INTERACTIVE !== '1' &&
    shouldPromptInteractively();
  if (allowPrompt) {
    return promptReportPreferences({ forPdf: false });
  }
  return {
    ...defaultReportPreferences(),
    tableSort: tableSortFromCli(
      /** @type {'name' | 'update-type' | 'security'} */ (parsed.sort),
    ),
  };
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = {
    majorOnly: false,
    sort: /** @type {'name' | 'update-type' | 'security'} */ ('name'),
    pdfMode: /** @type {'prompt' | 'yes' | 'no'} */ ('prompt'),
    help: false,
    noInteractive: false,
    /** @type {string | null} */
    projectPath: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--major-only') {
      opts.majorOnly = true;
      continue;
    }
    if (arg === '--yes-pdf') {
      opts.pdfMode = 'yes';
      continue;
    }
    if (arg === '--no-pdf') {
      opts.pdfMode = 'no';
      continue;
    }
    if (arg === '--no-interactive') {
      opts.noInteractive = true;
      continue;
    }
    if (arg.startsWith('--sort=')) {
      const v = arg.slice('--sort='.length).toLowerCase();
      if (v === 'update-type' || v === 'type') {
        opts.sort = 'update-type';
      } else if (v === 'security' || v === 'severity') {
        opts.sort = 'security';
      } else if (v === 'name' || v === 'package') {
        opts.sort = 'name';
      } else {
        console.warn(`Unknown --sort value "${v}", using name.`);
        opts.sort = 'name';
      }
      continue;
    }
    if (arg.startsWith('-')) {
      console.warn(`Ignoring unknown argument: ${arg}`);
      continue;
    }
    if (opts.projectPath == null) {
      opts.projectPath = arg;
    } else {
      console.warn(`Ignoring extra path argument: ${arg}`);
    }
  }

  return opts;
}

function documentsDir() {
  return path.join(os.homedir(), 'Documents');
}

function suggestedPdfFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `dependency-report-${y}-${m}-${day}-${h}${min}.pdf`;
}

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function isAffirmative(answer) {
  const a = answer.toLowerCase();
  return a === 'y' || a === 'yes';
}

/**
 * @param {string} projectRoot
 * @param {{ majorOnly: boolean, noInteractive: boolean }} runOpts
 * @param {object[]} tableRows
 * @param {object[]} summaryRows
 * @param {import('../lib/reportPreferences').ReportPreferences} prefs
 * @param {'prompt' | 'yes' | 'no'} pdfMode
 */
async function maybeWritePdf(projectRoot, runOpts, tableRows, summaryRows, prefs, pdfMode) {
  const docs = documentsDir();
  const dest = path.join(docs, suggestedPdfFilename());

  if (pdfMode === 'no') {
    return;
  }

  let doExport = false;
  if (pdfMode === 'yes') {
    doExport = true;
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    const answer = await ask('Export report to PDF in your Documents folder? [y/N]: ');
    doExport = isAffirmative(answer);
  }

  if (!doExport) {
    return;
  }

  const allowPdfQuestions =
    !runOpts.noInteractive &&
    process.env.REPORT_NON_INTERACTIVE !== '1' &&
    shouldPromptInteractively();

  let useTableRows = tableRows;
  let useSummaryRows = summaryRows;
  let usePrefs = prefs;
  if (allowPdfQuestions) {
    const pdfPrefs = await promptReportPreferences({ forPdf: true });
    if (!preferencesEqual(pdfPrefs, prefs)) {
      usePrefs = pdfPrefs;
      const { rows: regTable, summaryRows: regSummary } = await run(projectRoot, {
        majorOnly: runOpts.majorOnly,
        printConsole: false,
        preferences: usePrefs,
      });
      useTableRows = regTable;
      useSummaryRows = regSummary;
    } else {
      usePrefs = pdfPrefs;
    }
  }

  fs.mkdirSync(docs, { recursive: true });
  await writePdfReportWithProgress(dest, useTableRows, usePrefs, useSummaryRows);
  console.log(`PDF written to: ${dest}`);
}

async function main() {
  const t0 = Date.now();
  const parsed = parseArgs(process.argv);
  let printElapsed = false;

  try {
    if (parsed.help) {
      printHelp();
      return;
    }

    const rawPath = parsed.projectPath ?? '.';
    const projectRoot = path.resolve(process.cwd(), rawPath);
    const pkgPath = path.join(projectRoot, 'package.json');

    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      console.error(`Error: not a directory: ${projectRoot}`);
      process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(pkgPath)) {
      console.error(
        'Error: package.json not found. This tool only analyzes Node.js / npm projects.\n' +
          `  Expected: ${pkgPath}\n` +
          '  Pass a directory that contains package.json (dependencies and optional lockfile).',
      );
      process.exitCode = 1;
      return;
    }

    if (!fs.statSync(pkgPath).isFile()) {
      console.error(`Error: package.json must be a file: ${pkgPath}`);
      process.exitCode = 1;
      return;
    }

    printElapsed = true;

    try {
      const preferences = await resolveReportPreferences(parsed);
      const { rows, summaryRows } = await run(projectRoot, {
        majorOnly: parsed.majorOnly,
        printConsole: true,
        preferences,
      });
      await maybeWritePdf(
        projectRoot,
        { majorOnly: parsed.majorOnly, noInteractive: parsed.noInteractive },
        rows,
        summaryRows,
        preferences,
        parsed.pdfMode,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Dependency report failed:', message);
      process.exitCode = 1;
    }
  } finally {
    if (printElapsed) {
      const elapsed = Date.now() - t0;
      console.log('');
      console.log(
        chalk.cyan.bold('Time elapsed: ') + chalk.white.bold(formatDuration(elapsed)),
      );
    }
  }
}

main();
