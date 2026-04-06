/**
 * User report filters (interactive or defaults).
 * @typedef {'all' | 'info' | 'low' | 'moderate' | 'high' | 'critical'} SeverityFloor
 * @typedef {'direct' | 'full'} PackageGraph
 * @typedef {'full' | 'vulnerable-only'} TableScope
 * @typedef {'name' | 'update-type' | 'security'} TableSort
 * @typedef {object} ReportPreferences
 * @property {SeverityFloor} severityFloor
 * @property {PackageGraph} packageGraph
 * @property {TableScope} tableScope
 * @property {TableSort} tableSort
 */

/** @type {Record<string, number>} */
const SEVERITY_RANK = {
  none: 0,
  unknown: 0,
  info: 1,
  low: 2,
  moderate: 3,
  high: 4,
  critical: 5,
};

/**
 * @param {string | undefined} level
 */
function severityRank(level) {
  if (!level) {
    return 0;
  }
  return SEVERITY_RANK[level] ?? 0;
}

/**
 * Advisory level counts for filtered lists.
 * @param {string} level
 * @param {SeverityFloor} floor
 */
function advisoryMatchesFloor(level, floor) {
  if (level === 'none' || level === 'unknown') {
    return false;
  }
  if (floor === 'all') {
    return true;
  }
  return severityRank(level) >= severityRank(floor);
}

/**
 * @param {SeverityFloor} floor
 */
function severityFloorLabel(floor) {
  const map = {
    all: 'all severity levels',
    info: 'informational and above',
    low: 'low and above',
    moderate: 'moderate and above',
    high: 'high and above',
    critical: 'critical only',
  };
  return map[floor] ?? floor;
}

/**
 * @returns {ReportPreferences}
 */
function defaultReportPreferences() {
  return {
    severityFloor: 'all',
    packageGraph: 'full',
    tableScope: 'full',
    tableSort: 'name',
  };
}

/**
 * @param {object[]} rows analyzed rows (before tableScope filter)
 * @param {ReportPreferences} prefs
 */
function filterRowsForTable(rows, prefs) {
  if (prefs.tableScope !== 'vulnerable-only') {
    return rows;
  }
  return rows.filter((r) => {
    const s = r.securityLevel ?? 'unknown';
    if (s === 'none' || s === 'unknown') {
      return false;
    }
    return advisoryMatchesFloor(s, prefs.severityFloor);
  });
}

/**
 * Critical and high only — for priority block (from full analyzed rows).
 * @param {Array<{ name: string, securityLevel?: string }>} rows
 */
function priorityVulnerableEntries(rows) {
  /** @type {{ name: string, level: string }[]} */
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const s = r.securityLevel ?? 'unknown';
    if (s !== 'critical' && s !== 'high') {
      continue;
    }
    const k = `${r.name}@${s}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push({ name: r.name, level: s });
  }
  out.sort((a, b) => {
    if (a.level !== b.level) {
      return severityRank(b.level) - severityRank(a.level);
    }
    return a.name.localeCompare(b.name, 'en');
  });
  return out;
}

/**
 * @param {ReportPreferences} a
 * @param {ReportPreferences} b
 */
function preferencesEqual(a, b) {
  return (
    a.severityFloor === b.severityFloor &&
    a.packageGraph === b.packageGraph &&
    a.tableScope === b.tableScope &&
    a.tableSort === b.tableSort
  );
}

module.exports = {
  SEVERITY_RANK,
  severityRank,
  advisoryMatchesFloor,
  severityFloorLabel,
  defaultReportPreferences,
  filterRowsForTable,
  priorityVulnerableEntries,
  preferencesEqual,
};
