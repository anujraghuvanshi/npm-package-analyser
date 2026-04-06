/**
 * Orchestrates reading package.json, querying npm, sorting/filtering, and rendering console output.
 */

const { collectReportTargets, readInstalledVersion } = require('./readPackages');
const { fetchPackageMeta } = require('./npmRegistry');
const {
  classifyUpdateType,
  describeNonRegistryRow,
} = require('./analyzeVersions');
const { UPDATE_TYPE, UPDATE_TYPE_SORT_ORDER } = require('./constants');
const chalk = require('chalk');
const { attachSecurityFromOsv } = require('./osvSecurity');
const { printConsoleTable, printConsoleSummary } = require('./reportConsole');
const {
  defaultReportPreferences,
  filterRowsForTable,
  severityRank,
} = require('./reportPreferences');

/**
 * @typedef {object} ReportRow
 * @property {string} name
 * @property {'dependencies'|'devDependencies'|'transitive'} kind
 * @property {string} wantedRange
 * @property {string | null} installedVersion
 * @property {string | null} latestVersion
 * @property {string | null} lastPublished
 * @property {number | null} unpackedSizeBytes
 * @property {string} updateType
 * @property {string | null} registryError
 * @property {'none'|'info'|'low'|'moderate'|'high'|'critical'|'unknown'} [securityLevel]
 * @property {number} [securityCount]
 * @property {string} [securityTooltip]
 */

/**
 * Run async work in chunks to limit concurrent registry calls.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {{ onProgress?: (done: number, total: number) => void }} [progressOpts]
 * @returns {Promise<R[]>}
 */
async function mapPool(items, limit, fn, progressOpts) {
  const onProgress = progressOpts?.onProgress;
  const total = items.length;
  let completed = 0;
  const bump = () => {
    if (!onProgress) {
      return;
    }
    completed += 1;
    onProgress(completed, total);
  };

  const results = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } finally {
        bump();
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * @param {string} projectRoot
 * @param {{
 *   majorOnly?: boolean,
 *   printConsole?: boolean,
 *   concurrency?: number,
 *   showProgress?: boolean,
 *   preferences?: import('./reportPreferences').ReportPreferences
 * }} options
 * @returns {Promise<{
 *   rows: ReportRow[],
 *   summaryRows: ReportRow[],
 *   preferences: import('./reportPreferences').ReportPreferences
 * }>}
 */
function sortRows(a, b, tableSort) {
  if (tableSort === 'security') {
    const ra = severityRank(a.securityLevel ?? 'none');
    const rb = severityRank(b.securityLevel ?? 'none');
    if (rb !== ra) {
      return rb - ra;
    }
  } else if (tableSort === 'update-type') {
    const oa =
      UPDATE_TYPE_SORT_ORDER[a.updateType] ?? UPDATE_TYPE_SORT_ORDER[UPDATE_TYPE.UNKNOWN];
    const ob =
      UPDATE_TYPE_SORT_ORDER[b.updateType] ?? UPDATE_TYPE_SORT_ORDER[UPDATE_TYPE.UNKNOWN];
    if (oa !== ob) {
      return oa - ob;
    }
  }
  return a.name.localeCompare(b.name, 'en');
}

async function run(projectRoot, options = {}) {
  const {
    majorOnly = false,
    printConsole = true,
    concurrency = 12,
    showProgress: showProgressOpt,
    preferences: preferencesIn,
  } = options;

  const preferences = preferencesIn
    ? { ...defaultReportPreferences(), ...preferencesIn }
    : defaultReportPreferences();

  const tableSort = preferences.tableSort;

  const activityEnabled =
    showProgressOpt !== false &&
    printConsole &&
    process.env.REPORT_NO_PROGRESS !== '1';

  const useSpinner =
    activityEnabled &&
    Boolean(process.stdout.isTTY) &&
    process.env.CI !== 'true';

  const plainLog = activityEnabled && !useSpinner;

  /** @param {string} msg */
  const phaseLog = (msg) => {
    if (plainLog) {
      console.log(`${chalk.cyan('›')} ${msg}`);
    }
  };

  /** @type {import('ora').Ora | null} */
  let spinner = null;
  if (useSpinner) {
    const ora = require('ora');
    spinner = ora({
      text: 'Reading package.json and lockfile…',
      color: 'cyan',
      discardStdin: true,
    }).start();
  } else if (plainLog) {
    phaseLog('Reading package.json and lockfile…');
  }

  try {
  const targets = collectReportTargets(projectRoot, {
    directOnly: preferences.packageGraph === 'direct',
  });
  if (spinner) {
    spinner.text =
      targets.length === 0
        ? 'No packages to analyze…'
        : `Fetching npm registry metadata (${targets.length} packages)…`;
  } else {
    phaseLog(
      targets.length === 0
        ? 'No packages in graph.'
        : `Fetching npm registry metadata for ${targets.length} packages…`,
    );
  }

  /** @type {ReportRow[]} */
  const rows = await mapPool(
    targets,
    concurrency,
    async (entry) => {
    const installed =
      entry.lockedVersion ?? readInstalledVersion(projectRoot, entry.name);
    const { skipRegistry, note } = describeNonRegistryRow(entry.wantedRange);

    if (skipRegistry) {
      return {
        name: entry.name,
        kind: entry.kind,
        wantedRange: entry.wantedRange,
        installedVersion: installed,
        latestVersion: null,
        lastPublished: null,
        unpackedSizeBytes: null,
        updateType: UPDATE_TYPE.UNKNOWN,
        registryError: note,
      };
    }

    const meta = await fetchPackageMeta(entry.name);
    const latest = meta.latestVersion;
    let updateType = UPDATE_TYPE.UNKNOWN;

    if (latest) {
      updateType = classifyUpdateType(installed, latest);
    } else if (meta.error) {
      updateType = UPDATE_TYPE.UNKNOWN;
    }

    return {
      name: entry.name,
      kind: entry.kind,
      wantedRange: entry.wantedRange,
      installedVersion: installed,
      latestVersion: latest,
      lastPublished: meta.lastPublished,
      unpackedSizeBytes: meta.unpackedSizeBytes,
      updateType,
      registryError: meta.error,
    };
    },
    {
      onProgress:
        spinner || plainLog
          ? (done, total) => {
              if (total === 0) {
                return;
              }
              if (spinner) {
                if (done === total || total <= 15 || done % 12 === 0 || done === 1) {
                  spinner.text = `Fetching npm registry metadata… ${done}/${total}`;
                }
                return;
              }
              if (
                plainLog &&
                (done === total || total <= 20 || done % 50 === 0 || done === 1)
              ) {
                console.log(
                  `${chalk.cyan('›')}   npm registry ${chalk.dim(`${done}/${total}`)}`,
                );
              }
            }
          : undefined,
    },
  );

  if (spinner) {
    spinner.text = 'Checking vulnerabilities (OSV.dev)…';
  } else {
    phaseLog('Checking vulnerabilities (OSV.dev)…');
  }

  if (process.env.REPORT_SKIP_AUDIT === '1') {
    for (const row of rows) {
      row.securityLevel = 'unknown';
      row.securityCount = 0;
      row.securityTooltip = 'Skipped OSV (REPORT_SKIP_AUDIT=1)';
    }
  } else {
    await attachSecurityFromOsv(projectRoot, rows);
  }

  if (spinner) {
    spinner.stop();
    spinner = null;
  } else if (plainLog) {
    phaseLog('Building report…');
  }

  let filtered = rows;
  if (majorOnly) {
    filtered = rows.filter((r) => r.updateType === UPDATE_TYPE.MAJOR);
  }

  const sorted = [...filtered].sort((a, b) => sortRows(a, b, tableSort));

  const displayRows = filterRowsForTable(sorted, preferences);

  if (printConsole) {
    printConsoleTable(displayRows);
    if (displayRows.length < sorted.length) {
      console.log(
        chalk.dim(
          `\nTable: ${displayRows.length} of ${sorted.length} packages (filtered). Summary below uses all ${sorted.length} analyzed packages.`,
        ),
      );
    }
    // Summary / health / vuln lists use the full analyzed set so issues are not dropped when
    // the table is limited to "vulnerable only".
    printConsoleSummary(sorted, preferences);

    const flagged = sorted.filter((r) => r.registryError);
    if (flagged.length > 0) {
      console.log(
        chalk.yellow(
          `\nNote: ${flagged.length} package(s) have registry/spec limitations (git/file/link or fetch errors).`,
        ),
      );
    }
  }

  return {
    rows: displayRows,
    summaryRows: sorted,
    preferences: { ...preferences, tableSort },
  };
  } catch (err) {
    if (spinner) {
      spinner.fail('Analysis failed');
      spinner = null;
    }
    throw err;
  }
}

module.exports = { run, mapPool };
