/**
 * npm / GitHub Primer–style badge system: flat chips, 1px border, tight padding,
 * monospace for semver (like registry UI), sans-semibold for status labels.
 */

const { UPDATE_TYPE, BADGE_LABEL_FG } = require('./constants');

exports.NPM_BADGE_LAYOUT = {
  radius: 3,
  borderWidth: 0.55,
  padX: 6.75,
  padY: 3.75,
  fontVersion: 7,
  fontStatus: 7.35,
};

/** @typedef {{ bg: string, fg: string, border: string }} NpmBadgeStyle */

exports.versionBadges = {
  installed: {
    bg: '#FFFFFF',
    fg: BADGE_LABEL_FG,
    border: '#D0D7DE',
  },
  latest: {
    bg: '#DDF4FF',
    fg: BADGE_LABEL_FG,
    border: '#79C0FF',
  },
};

exports.statusBadges = {
  [UPDATE_TYPE.MAJOR]: {
    bg: '#FFEBE9',
    fg: BADGE_LABEL_FG,
    border: '#FF8182',
  },
  [UPDATE_TYPE.MINOR]: {
    bg: '#FFF8C5',
    fg: BADGE_LABEL_FG,
    border: '#EAC54F',
  },
  [UPDATE_TYPE.PATCH]: {
    bg: '#DDF4FF',
    fg: BADGE_LABEL_FG,
    border: '#79C0FF',
  },
  [UPDATE_TYPE.UP_TO_DATE]: {
    bg: '#DAFBE1',
    fg: BADGE_LABEL_FG,
    border: '#4AC26B',
  },
  [UPDATE_TYPE.UNKNOWN]: {
    bg: '#F6F8FA',
    fg: BADGE_LABEL_FG,
    border: '#D0D7DE',
  },
  [UPDATE_TYPE.PRERELEASE]: {
    bg: '#FBEFFF',
    fg: BADGE_LABEL_FG,
    border: '#D8B9FF',
  },
};

/**
 * @param {string} updateType
 * @returns {NpmBadgeStyle}
 */
exports.getStatusBadgeStyle = function getStatusBadgeStyle(updateType) {
  return exports.statusBadges[updateType] ?? exports.statusBadges[UPDATE_TYPE.UNKNOWN];
};

/**
 * @param {'version' | 'status'} kind
 */
function badgeFonts(kind) {
  if (kind === 'version') {
    return { family: 'Courier-Bold', size: exports.NPM_BADGE_LAYOUT.fontVersion };
  }
  return { family: 'Helvetica-Bold', size: exports.NPM_BADGE_LAYOUT.fontStatus };
}

/**
 * @param {object} doc PDFKit document
 * @param {number} ux column left
 * @param {number} colW column width
 * @param {number} rowTop
 * @param {number} rowH
 * @param {string} label
 * @param {NpmBadgeStyle} style
 * @param {'version' | 'status'} kind
 */
exports.drawNpmBadge = function drawNpmBadge(
  doc,
  ux,
  colW,
  rowTop,
  rowH,
  label,
  style,
  kind,
) {
  const L = exports.NPM_BADGE_LAYOUT;
  const innerPad = 2.5;
  const maxTagW = Math.max(0, colW - innerPad * 2);
  const { family, size } = badgeFonts(kind);

  doc.font(family).fontSize(size);
  const textW = doc.widthOfString(label);
  let tagW = Math.min(textW + L.padX * 2, maxTagW);
  const minW = size + L.padX * 1.25;
  if (tagW < minW) {
    tagW = Math.min(maxTagW, minW);
  }
  const tagH = size + L.padY * 2;
  const tagX = ux + (colW - tagW) / 2;
  const tagY = rowTop + (rowH - tagH) / 2;

  doc.save();
  doc.roundedRect(tagX, tagY, tagW, tagH, L.radius).fill(style.bg);
  doc
    .roundedRect(tagX, tagY, tagW, tagH, L.radius)
    .lineWidth(L.borderWidth)
    .strokeColor(style.border)
    .stroke();
  doc.fillColor(style.fg).font(family).fontSize(size);
  const lineH = doc.currentLineHeight(true);
  const textY = tagY + (tagH - lineH) / 2 + lineH * 0.065;
  doc.text(label, tagX, textY, {
    width: tagW,
    align: 'center',
    lineBreak: false,
    ellipsis: true,
  });
  doc.restore();
};
