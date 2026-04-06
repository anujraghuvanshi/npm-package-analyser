/**
 * CLI table: dark terminal + white text; Installed / Latest / Update use centered
 * calm pill tags (light fills + darker text; ANSI bg only on the label).
 */

// Enable ANSI colors when supported (some IDEs need this before chalk loads).
if (!process.env.NO_COLOR) {
  process.env.FORCE_COLOR = process.env.FORCE_COLOR || '3';
}

const chalk = require('chalk');
const Table = require('cli-table3');
const {
  UPDATE_TYPE,
  formatUpdateColumnLabel,
  PDF_TABLE,
  hexToRgb,
} = require('./constants');
const {
  summarizeDependencyRows,
  buildStructuredSummary,
  capitalizeSeverity,
} = require('./reportSummary');
const { defaultReportPreferences } = require('./reportPreferences');

/** Default body cells: bright white on terminal background. */
function cellPlain(text) {
  return chalk.white(String(text));
}

/** Table header: bold white (borders stay visible on dark terminals). */
function cellHeader(text) {
  return chalk.white.bold(String(text));
}

/**
 * @param {{ bg: string, fg: string }} style
 * @param {string} text
 */
function cellPill(style, text) {
  const [r, g, b] = hexToRgb(style.bg);
  const pad = ' ';
  return chalk.bgRgb(r, g, b).hex(style.fg).bold(`${pad}${text}${pad}`);
}

/** @param {string | null | undefined} version */
function cellInstalledVersion(version) {
  const t = version ?? '—';
  if (t === '—') {
    return chalk.gray('—');
  }
  return cellPill(PDF_TABLE.installedPill, t);
}

/** @param {string | null | undefined} version */
function cellLatestVersion(version) {
  const t = version ?? '—';
  if (t === '—') {
    return chalk.gray('—');
  }
  return cellPill(PDF_TABLE.latestPill, t);
}

/**
 * @param {string} updateType
 * @param {boolean} registryNote
 */
function cellUpdateType(updateType, registryNote) {
  const label = formatUpdateColumnLabel(updateType, registryNote);
  const style =
    PDF_TABLE.updateBadge[updateType] ?? PDF_TABLE.updateBadge[UPDATE_TYPE.UNKNOWN];
  return cellPill(style, label);
}

/**
 * Terminal Secure column: compact "icon" tile (saturated bg + light glyph).
 * @param {string} bgHex
 * @param {string} fgHex
 * @param {string} symbol
 */
function cellSecureIcon(bgHex, fgHex, symbol) {
  const [r, g, b] = hexToRgb(bgHex);
  const pad = '  ';
  return chalk.bgRgb(r, g, b).hex(fgHex).bold(`${pad}${symbol}${pad}`);
}

const GLYPH_SECURE = '\u2713';
const GLYPH_UNSECURE = '\u26A0';

const SECURE_ICON = {
  none: { bg: '#2E7D50', fg: '#FFFFFF', symbol: GLYPH_SECURE },
  unknown: { bg: '#546E7A', fg: '#ECEFF1', symbol: '\u2014' },
  info: { bg: '#0277BD', fg: '#FFFFFF', symbol: 'i' },
  low: { bg: '#B45309', fg: '#FFFFFF', symbol: GLYPH_UNSECURE },
  moderate: { bg: '#EA580C', fg: '#FFFFFF', symbol: GLYPH_UNSECURE },
  high: { bg: '#DC2626', fg: '#FFFFFF', symbol: GLYPH_UNSECURE },
  critical: { bg: '#991B1B', fg: '#FFFFFF', symbol: GLYPH_UNSECURE },
};

/**
 * @param {{
 *   securityLevel?: string,
 *   securityCount?: number,
 *   securityTooltip?: string
 * }} r
 */
const SECURE_ICON_BY_LEVEL = {
  none: SECURE_ICON.none,
  unknown: SECURE_ICON.unknown,
  info: SECURE_ICON.info,
  low: SECURE_ICON.low,
  moderate: SECURE_ICON.moderate,
  high: SECURE_ICON.high,
  critical: SECURE_ICON.critical,
};

function cellSecure(r) {
  const level = r.securityLevel ?? 'unknown';
  const pick = SECURE_ICON_BY_LEVEL[level] ?? { bg: '#546E7A', fg: '#FFFFFF', symbol: '?' };
  return cellSecureIcon(pick.bg, pick.fg, pick.symbol);
}

/**
 * @param {number | null | undefined} n
 */
function formatBytes(n) {
  if (n == null || Number.isNaN(n)) {
    return '—';
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Registry publish time → relative phrasing (e.g. "18 days ago", "1 month ago").
 * @param {string | null | undefined} isoOrDateString
 */
function formatLastUpdate(isoOrDateString) {
  if (isoOrDateString == null || isoOrDateString === '') {
    return '—';
  }
  const then = new Date(isoOrDateString).getTime();
  if (Number.isNaN(then)) {
    return '—';
  }
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 0) {
    return new Date(isoOrDateString).toISOString().slice(0, 10);
  }
  if (diffSec < 60) {
    return 'just now';
  }
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) {
    return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    if (days === 0) {
      return 'today';
    }
    if (days === 1) {
      return '1 day ago';
    }
    return `${days} days ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    if (months === 1) {
      return '1 month ago';
    }
    return `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  if (years === 1) {
    return '1 year ago';
  }
  return `${years} years ago`;
}

/**
 * PDF "Generated:" line — local time, 12-hour clock.
 * @param {Date} [date]
 */
function formatGeneratedAt(date = new Date()) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/**
 * @param {Array<{
 *   name: string,
 *   kind: string,
 *   installedVersion: string | null,
 *   latestVersion: string | null,
 *   updateType: string,
 *   lastPublished: string | null,
 *   unpackedSizeBytes: number | null,
 *   registryError?: string | null,
 *   securityLevel?: string,
 *   securityCount?: number,
 *   securityTooltip?: string
 * }>} rows
 */
function printConsoleTable(rows) {
  const table = new Table({
    head: [
      cellHeader('Package'),
      cellHeader('Secure'),
      cellHeader('Installed'),
      cellHeader('Latest'),
      cellHeader('Update'),
      cellHeader('Size'),
      cellHeader('Last Update'),
    ],
    colAligns: ['left', 'center', 'center', 'center', 'center', 'right', 'left'],
    style: {
      head: [],
      border: ['gray'],
    },
    wordWrap: true,
  });

  for (const r of rows) {
    const lastUpdate = formatLastUpdate(r.lastPublished);
    const registryNote = Boolean(r.registryError);

    const displayName =
      r.kind === 'transitive'
        ? `${cellPlain(r.name)} ${chalk.gray('(transitive)')}`
        : cellPlain(r.name);
    table.push([
      displayName,
      cellSecure(r),
      cellInstalledVersion(r.installedVersion),
      cellLatestVersion(r.latestVersion),
      cellUpdateType(r.updateType, registryNote),
      cellPlain(formatBytes(r.unpackedSizeBytes)),
      cellPlain(lastUpdate),
    ]);
  }

  console.log(`${table.toString()}\u001b[0m`);
  console.log(
    chalk.gray('Secure (OSV): ') +
      cellSecureIcon(SECURE_ICON.none.bg, SECURE_ICON.none.fg, SECURE_ICON.none.symbol) +
      chalk.gray(' secure · ') +
      cellSecureIcon(SECURE_ICON.moderate.bg, SECURE_ICON.moderate.fg, SECURE_ICON.moderate.symbol) +
      chalk.gray('/') +
      cellSecureIcon(SECURE_ICON.high.bg, SECURE_ICON.high.fg, SECURE_ICON.high.symbol) +
      chalk.gray(' vulnerabilities (by severity) · ') +
      cellSecureIcon(SECURE_ICON.unknown.bg, SECURE_ICON.unknown.fg, SECURE_ICON.unknown.symbol) +
      chalk.gray(' check unavailable'),
  );
}

/**
 * @param {Array<{
 *   name: string,
 *   updateType: string,
 *   securityLevel?: string,
 * }>} rows
 * @param {import('./reportPreferences').ReportPreferences} [prefs]
 */
function printConsoleSummary(rows, prefs) {
  const p = prefs ?? defaultReportPreferences();
  const stats = summarizeDependencyRows(rows, p);
  const narrative = buildStructuredSummary(stats);

  console.log('');
  console.log(chalk.white.bold('Summary'));
  console.log('');
  console.log(chalk.cyan.bold('Dependency Health Overview'));
  for (const line of narrative.healthLines) {
    console.log(`${chalk.gray('  •')} ${chalk.white(line)}`);
  }

  console.log('');
  console.log(chalk.cyan.bold('Security Status'));
  for (const line of narrative.securityLines) {
    console.log(`${chalk.gray('  •')} ${chalk.white(line)}`);
  }

  if (narrative.priorityLines.length > 0) {
    console.log('');
    console.log(chalk.red.bold('Highest-priority vulnerabilities (Critical and High)'));
    for (const line of narrative.priorityLines) {
      console.log(`${chalk.gray('  •')} ${chalk.white(line)}`);
    }
  }

  if (stats.withAdvisory.length > 0) {
    console.log('');
    console.log(chalk.red.bold('Packages with vulnerabilities'));
    for (const { name, level } of stats.withAdvisory) {
      console.log(
        `${chalk.gray('  •')} ${chalk.white(`${name} (highest: ${capitalizeSeverity(level)})`)}`,
      );
    }
  }

  console.log('');
  console.log(chalk.cyan.bold('Recommendation'));
  for (const line of narrative.recommendationLines) {
    console.log(`${chalk.gray('  •')} ${chalk.white(line)}`);
  }

  console.log('');
  const sym = narrative.overallIsPositive ? '\u2705 ' : '\u26a0 ';
  const detailStyle = narrative.overallIsPositive ? chalk.green.bold : chalk.hex('#F59E0B').bold;
  console.log(
    chalk.white.bold(`${narrative.overallLabel}: `) +
      detailStyle(`${sym}${narrative.overallDetail}`),
  );
  console.log('');
}

module.exports = {
  printConsoleTable,
  printConsoleSummary,
  formatBytes,
  formatLastUpdate,
  formatGeneratedAt,
};
