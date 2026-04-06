/**
 * Shared dependency report summary (PDF + terminal): counts, narrative, recommendations.
 */

const { UPDATE_TYPE } = require('./constants');
const {
  advisoryMatchesFloor,
  priorityVulnerableEntries,
  severityFloorLabel,
} = require('./reportPreferences');

/**
 * @param {Array<{
 *   name: string,
 *   updateType: string,
 *   securityLevel?: string,
 * }>} rows
 * @param {import('./reportPreferences').ReportPreferences} [prefs]
 */
function summarizeDependencyRows(rows, prefs) {
  const floor = prefs?.severityFloor ?? 'all';

  const byUpdate = {
    minor: 0,
    major: 0,
    patch: 0,
    latest: 0,
    unknown: 0,
    prerelease: 0,
  };
  for (const r of rows) {
    switch (r.updateType) {
      case UPDATE_TYPE.MINOR:
        byUpdate.minor++;
        break;
      case UPDATE_TYPE.MAJOR:
        byUpdate.major++;
        break;
      case UPDATE_TYPE.PATCH:
        byUpdate.patch++;
        break;
      case UPDATE_TYPE.UP_TO_DATE:
        byUpdate.latest++;
        break;
      case UPDATE_TYPE.UNKNOWN:
        byUpdate.unknown++;
        break;
      case UPDATE_TYPE.PRERELEASE:
        byUpdate.prerelease++;
        break;
      default:
        byUpdate.unknown++;
    }
  }

  /** @type {{ name: string, level: string }[]} */
  const withAdvisory = [];
  let nClean = 0;
  let nAuditUnknown = 0;
  let nBelowFloor = 0;
  /** Rows with any known OSV advisory (any severity), before severity-focus filter */
  let nAnyAdvisory = 0;

  for (const r of rows) {
    const s = r.securityLevel ?? 'unknown';
    if (s === 'none') {
      nClean++;
    } else if (s === 'unknown') {
      nAuditUnknown++;
    } else if (s === 'info' || s === 'low' || s === 'moderate' || s === 'high' || s === 'critical') {
      nAnyAdvisory++;
      if (advisoryMatchesFloor(s, floor)) {
        withAdvisory.push({ name: r.name, level: s });
      } else if (floor !== 'all') {
        nBelowFloor++;
      }
    }
  }

  const allAuditClean = rows.length > 0 && nClean === rows.length && nAuditUnknown === 0;
  const allAuditUnknown = rows.length > 0 && nAuditUnknown === rows.length;

  const priorityPackages = priorityVulnerableEntries(rows);

  return {
    total: rows.length,
    byUpdate,
    withAdvisory,
    nClean,
    nAuditUnknown,
    nBelowFloor,
    nAnyAdvisory,
    allAuditClean,
    allAuditUnknown,
    priorityPackages,
    severityFloor: floor,
  };
}

function capitalizeSeverity(level) {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/** @param {number} n @param {string} singular @param {string} plural */
function nounCount(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * @param {{
 *   total: number,
 *   byUpdate: object,
 *   withAdvisory: { name: string, level: string }[],
 *   nClean: number,
 *   nAuditUnknown: number,
 *   nBelowFloor: number,
 *   nAnyAdvisory: number,
 *   allAuditClean: boolean,
 *   allAuditUnknown: boolean,
 *   priorityPackages: { name: string, level: string }[],
 *   severityFloor: string,
 * }} stats
 */
function buildStructuredSummary(stats) {
  const {
    total,
    byUpdate,
    withAdvisory,
    nClean,
    nAuditUnknown,
    nBelowFloor,
    nAnyAdvisory,
    allAuditClean,
    allAuditUnknown,
    priorityPackages,
    severityFloor,
  } = stats;
  const { minor, major, patch, latest, unknown, prerelease } = byUpdate;

  const healthLines = [
    `${total} package${total === 1 ? '' : 's'} analyzed`,
    `${minor} minor update${minor === 1 ? '' : 's'} available (safe to upgrade)`,
    `${major} major update${major === 1 ? '' : 's'} available (requires review)`,
    `${patch} patch update${patch === 1 ? '' : 's'} available (low-risk improvements)`,
    `${latest} package${latest === 1 ? '' : 's'} ${latest === 1 ? 'is' : 'are'} up to date`,
    `${unknown} package${unknown === 1 ? '' : 's'} ${unknown === 1 ? 'has' : 'have'} unknown status`,
  ];
  if (prerelease > 0) {
    healthLines.push(
      `${prerelease} package${prerelease === 1 ? '' : 's'} ${prerelease === 1 ? 'has' : 'have'} prerelease-related semver`,
    );
  }

  /** @type {string[]} */
  const securityLines = [];
  if (total === 0) {
    securityLines.push('No packages were included in this report.');
  } else if (withAdvisory.length > 0) {
    securityLines.push(
      `${nClean} package${nClean === 1 ? '' : 's'} ${nClean === 1 ? 'has' : 'have'} no known security issues for the checked versions`,
    );
    if (severityFloor !== 'all') {
      securityLines.push(
        `Severity focus: ${severityFloorLabel(severityFloor)} (${withAdvisory.length} package${withAdvisory.length === 1 ? '' : 's'} in scope)`,
      );
    }
    securityLines.push(
      `${withAdvisory.length} package${withAdvisory.length === 1 ? '' : 's'} ${withAdvisory.length === 1 ? 'matches' : 'match'} your vulnerability criteria`,
    );
    if (nBelowFloor > 0 && severityFloor !== 'all') {
      securityLines.push(
        `${nBelowFloor} other package${nBelowFloor === 1 ? '' : 's'} ${nBelowFloor === 1 ? 'has' : 'have'} findings below your selected severity threshold`,
      );
    }
    securityLines.push('Use the package table to see versions and plan upgrades.');
  } else if (allAuditClean) {
    securityLines.push(`All ${total} package${total === 1 ? '' : 's'} are clear for the checked versions`);
    securityLines.push('No known security issues at your selected severity focus');
  } else if (allAuditUnknown) {
    securityLines.push('Security data was not available for this run');
    securityLines.push('The Secure column may show unavailable until versions are resolved from a lockfile or install');
    securityLines.push('Add a lockfile or install dependencies, then run the report again');
  } else {
    securityLines.push(
      `No packages in this view match your severity threshold; ${nClean} package${nClean === 1 ? '' : 's'} ${nClean === 1 ? 'is' : 'are'} clear`,
    );
    if (nBelowFloor > 0 && severityFloor !== 'all') {
      securityLines.push(
        `${nBelowFloor} package${nBelowFloor === 1 ? '' : 's'} ${nBelowFloor === 1 ? 'has' : 'have'} findings below the selected threshold`,
      );
    }
    securityLines.push(
      `${nAuditUnknown} package${nAuditUnknown === 1 ? '' : 's'} could not be assessed`,
    );
  }

  /** @type {string[]} */
  const priorityLines = [];
  if (priorityPackages.length > 0) {
    for (const p of priorityPackages) {
      priorityLines.push(`${p.name} (${capitalizeSeverity(p.level)})`);
    }
  }

  /** @type {string[]} */
  const recommendationLines = [];
  if (total === 0) {
    recommendationLines.push('Add dependencies to package.json to populate this report.');
  } else {
    if (major > 0) {
      recommendationLines.push(
        `Prioritize upgrading ${nounCount(major, 'major dependency', 'major dependencies')} with caution`,
      );
    }
    if (minor > 0 || patch > 0) {
      const bits = [];
      if (minor > 0) {
        bits.push(`${minor} minor`);
      }
      if (patch > 0) {
        bits.push(`${patch} patch`);
      }
      recommendationLines.push(
        `Apply ${bits.join(' and ')} update${minor + patch === 1 ? '' : 's'} to keep the project current`,
      );
    }
    if (unknown > 0) {
      recommendationLines.push(`Investigate ${nounCount(unknown, 'package', 'packages')} with unknown status`);
    }
    if (withAdvisory.length > 0) {
      recommendationLines.push(
        `Remediate ${nounCount(withAdvisory.length, 'package', 'packages')} that match your security criteria`,
      );
    }
    if (priorityPackages.length > 0) {
      recommendationLines.push(
        `Address Critical and High findings first (${priorityPackages.length} package${priorityPackages.length === 1 ? '' : 's'})`,
      );
    }
    if (recommendationLines.length === 0) {
      recommendationLines.push('No semver upgrades flagged; continue monitoring for new releases.');
    }
  }

  let overallLabel = 'Overall Status';
  let overallDetail = '';
  let overallIsPositive = true;

  if (total === 0) {
    overallDetail = 'No data';
    overallIsPositive = false;
  } else if (withAdvisory.length > 0) {
    overallDetail = 'Needs attention - security vulnerabilities present';
    overallIsPositive = false;
  } else if (nAnyAdvisory > 0) {
    overallDetail =
      'Security issues found, but none match your severity focus — lower the threshold or review the package table';
    overallIsPositive = false;
  } else if (allAuditUnknown) {
    overallDetail = 'Security check unavailable - confirm lockfile and network';
    overallIsPositive = false;
  } else if (major > 0 || minor > 0 || patch > 0 || unknown > 0) {
    overallDetail = 'Healthy with pending upgrades';
    overallIsPositive = true;
  } else {
    overallDetail = 'Up to date';
    overallIsPositive = true;
  }

  return {
    healthLines,
    securityLines,
    priorityLines,
    recommendationLines,
    overallLabel,
    overallDetail,
    overallIsPositive,
  };
}

module.exports = {
  summarizeDependencyRows,
  buildStructuredSummary,
  capitalizeSeverity,
};
