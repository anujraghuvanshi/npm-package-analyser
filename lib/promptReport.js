/**
 * Interactive report options (TTY). Arrow keys + Enter; no URLs in option text.
 */

const chalk = require('chalk');
const prompts = require('prompts');

function onCancel() {
  console.log('');
  process.exit(0);
}

/**
 * @param {{ forPdf?: boolean }} [ctx]
 * @returns {Promise<import('./reportPreferences').ReportPreferences>}
 */
async function promptReportPreferences(ctx = {}) {
  const intro = ctx.forPdf
    ? chalk.bold('\nPDF export — choose report options (use ↑ ↓, then Enter)\n')
    : chalk.bold('\nConfigure this report (use ↑ ↓, then Enter)\n');
  console.log(intro);

  const pOpts = { onCancel };

  const r1 = await prompts(
    {
      type: 'select',
      name: 'severityFloor',
      message:
        'Which vulnerability severities should appear in lists, counts, and the optional filtered table?',
      choices: [
        { title: 'All levels', value: 'all' },
        { title: 'Low or higher', value: 'low' },
        { title: 'Moderate or higher (typical “warnings and above”)', value: 'moderate' },
        { title: 'High or higher', value: 'high' },
        { title: 'Critical only', value: 'critical' },
      ],
      initial: 0,
    },
    pOpts,
  );

  const r2 = await prompts(
    {
      type: 'select',
      name: 'packageGraph',
      message: 'Which packages should be analyzed?',
      choices: [
        {
          title: 'Only those declared in package.json (dependencies and devDependencies)',
          value: 'direct',
        },
        {
          title:
            'Full install tree — package.json entries plus nested dependencies when a lockfile is present',
          value: 'full',
        },
      ],
      initial: 1,
    },
    pOpts,
  );

  const r3 = await prompts(
    {
      type: 'select',
      name: 'tableScope',
      message: 'Main package table — what should it list?',
      choices: [
        { title: 'Every analyzed package', value: 'full' },
        {
          title:
            'Only packages that match your severity choice (smaller table when you care about issues only)',
          value: 'vulnerable-only',
        },
      ],
      initial: 0,
    },
    pOpts,
  );

  const r4 = await prompts(
    {
      type: 'select',
      name: 'tableSort',
      message: 'How should rows in the table be ordered?',
      choices: [
        { title: 'Alphabetical by package name', value: 'name' },
        { title: 'By update importance (major updates first)', value: 'update-type' },
        { title: 'By security severity (highest first)', value: 'security' },
      ],
      initial: 0,
    },
    pOpts,
  );

  console.log('');

  return {
    severityFloor: r1.severityFloor ?? 'all',
    packageGraph: r2.packageGraph ?? 'full',
    tableScope: r3.tableScope ?? 'full',
    tableSort: r4.tableSort ?? 'name',
  };
}

/**
 * @returns {boolean}
 */
function shouldPromptInteractively() {
  return (
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY) &&
    process.env.REPORT_NON_INTERACTIVE !== '1' &&
    process.env.CI !== 'true'
  );
}

module.exports = {
  promptReportPreferences,
  shouldPromptInteractively,
};
