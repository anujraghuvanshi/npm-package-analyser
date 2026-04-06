/**
 * Shared constants for dependency reporting (colors, sort order, labels).
 */

/** @enum {string} */
exports.UPDATE_TYPE = {
  MAJOR: 'Major',
  MINOR: 'Minor',
  PATCH: 'Patch',
  UP_TO_DATE: 'Up to date',
  PRERELEASE: 'Prerelease',
  UNKNOWN: 'Unknown',
};

/** Sort priority: lower = earlier in list when sorting by update type. */
exports.UPDATE_TYPE_SORT_ORDER = {
  [exports.UPDATE_TYPE.MAJOR]: 0,
  [exports.UPDATE_TYPE.MINOR]: 1,
  [exports.UPDATE_TYPE.PATCH]: 2,
  [exports.UPDATE_TYPE.PRERELEASE]: 3,
  [exports.UPDATE_TYPE.UP_TO_DATE]: 4,
  [exports.UPDATE_TYPE.UNKNOWN]: 5,
};

/** Soft "light black" for badge text (calmer than #000, still readable on pastels). */
exports.BADGE_LABEL_FG = '#4B5563';

/**
 * PDF / shared pill colors (hex). Light, calm fills with darker text for contrast.
 */
exports.PDF_TABLE = {
  rowBg: '#FFFFFF',
  grid: '#DDE1E6',
  headerBg: '#2c3e50',
  headerText: '#FFFFFF',
  bodyText: '#1a1a1a',
  /** Version columns — dark text on light fills */
  installedPill: { bg: '#F3F4F6', fg: exports.BADGE_LABEL_FG },
  latestPill: { bg: '#D1FAE5', fg: exports.BADGE_LABEL_FG },
  /** Update status — soft pastels */
  updateBadge: {
    [exports.UPDATE_TYPE.MAJOR]: { bg: '#FEE2E2', fg: exports.BADGE_LABEL_FG },
    [exports.UPDATE_TYPE.MINOR]: { bg: '#FEF3C7', fg: exports.BADGE_LABEL_FG },
    [exports.UPDATE_TYPE.PATCH]: { bg: '#DBEAFE', fg: exports.BADGE_LABEL_FG },
    [exports.UPDATE_TYPE.UP_TO_DATE]: { bg: '#D1FAE5', fg: exports.BADGE_LABEL_FG },
    [exports.UPDATE_TYPE.UNKNOWN]: { bg: '#F3F4F6', fg: exports.BADGE_LABEL_FG },
    [exports.UPDATE_TYPE.PRERELEASE]: { bg: '#EDE9FE', fg: exports.BADGE_LABEL_FG },
  },
};

/** @param {string} hex #RRGGBB */
exports.hexToRgb = function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
};

/**
 * @param {string} updateType
 * @param {boolean} registryNote
 */
exports.formatUpdateColumnLabel = function formatUpdateColumnLabel(updateType, registryNote) {
  const star = registryNote ? '*' : '';
  let label;
  if (updateType === exports.UPDATE_TYPE.UP_TO_DATE) {
    label = 'LATEST';
  } else if (updateType === exports.UPDATE_TYPE.UNKNOWN) {
    label = 'Unknown';
  } else {
    label = String(updateType).toUpperCase();
  }
  return `${label}${star}`;
};
