/**
 * PDF report (PDFKit): white rows; Installed / Latest / Update use centered pill tags.
 */

const fs = require('fs');
const PDFDocument = require('pdfkit');
const {
  PDF_TABLE,
  formatUpdateColumnLabel,
  UPDATE_TYPE,
  BADGE_LABEL_FG,
} = require('./constants');
const { formatBytes, formatLastUpdate, formatGeneratedAt } = require('./reportConsole');
const {
  summarizeDependencyRows,
  buildStructuredSummary,
  capitalizeSeverity,
} = require('./reportSummary');
const { defaultReportPreferences, severityFloorLabel } = require('./reportPreferences');

const DEFAULT_PDF_TITLE = 'Smart Dependency Report';

/**
 * Load a PNG/JPEG (or GIF) from an http(s) URL for the "secure" PDF icon.
 * @param {string} url
 * @param {{ timeoutMs?: number, maxBytes?: number }} [limits]
 * @returns {Promise<Buffer | null>}
 */
async function fetchSecureIconBuffer(url, limits = {}) {
  const timeoutMs =
    limits.timeoutMs ?? (Number(process.env.DEPENDENCY_REPORT_ICON_TIMEOUT_MS) || 8000);
  const maxBytes =
    limits.maxBytes ?? (Number(process.env.DEPENDENCY_REPORT_ICON_MAX_BYTES) || 524288);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) {
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) {
      return null;
    }
    return buf;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

const GLYPH_INFO = 'i';
const GLYPH_ADVISORY = '!';

/**
 * @param {*} doc
 * @param {number} cx
 * @param {number} cy
 * @param {number} arm
 * @param {string} strokeColor
 */
function drawPdfCheckStroke(doc, cx, cy, arm, strokeColor) {
  doc.save();
  doc.strokeColor(strokeColor).lineWidth(1.05).lineCap('round').lineJoin('round');
  doc.moveTo(cx - arm * 0.78, cy + arm * 0.02);
  doc.lineTo(cx - arm * 0.1, cy + arm * 0.72);
  doc.lineTo(cx + arm * 0.98, cy - arm * 0.62);
  doc.stroke();
  doc.restore();
}

const SECURE_ISSUE_PILL = {
  info: PDF_TABLE.updateBadge[UPDATE_TYPE.PATCH],
  low: PDF_TABLE.updateBadge[UPDATE_TYPE.MINOR],
  moderate: { bg: '#FED7AA', fg: BADGE_LABEL_FG },
  high: PDF_TABLE.updateBadge[UPDATE_TYPE.MAJOR],
  critical: { bg: '#FECACA', fg: BADGE_LABEL_FG },
};

/**
 * @param {string} updateType
 * @returns {{ bg: string, fg: string } | null}
 */
function updateBadgeColors(updateType) {
  return PDF_TABLE.updateBadge[updateType] ?? PDF_TABLE.updateBadge[UPDATE_TYPE.UNKNOWN];
}

const TAG_FONT = 6.5;
const PILL_PAD_X = 7;
const PILL_PAD_Y = 3;
const PILL_RADIUS = 5;

const SUMMARY_ALL_SECURE_FG = '#2D5A45';

/**
 * @param {string} outPath
 * @param {object[]} rows
 * @param {{
 *   title?: string,
 *   secureIconUrl?: string,
 *   preferences?: import('./reportPreferences').ReportPreferences,
 *   summaryRows?: object[],
 * }} [opts]
 */
async function writePdfReport(outPath, rows, opts = {}) {
  const preferences = opts.preferences ?? defaultReportPreferences();
  const summarySource = Array.isArray(opts.summaryRows) ? opts.summaryRows : rows;
  const iconUrl = String(
    opts.secureIconUrl || process.env.DEPENDENCY_REPORT_SECURE_ICON_URL || '',
  ).trim();
  let secureIconBuffer = null;
  if (iconUrl && /^https?:\/\//i.test(iconUrl)) {
    secureIconBuffer = await fetchSecureIconBuffer(iconUrl);
    if (!secureIconBuffer) {
      console.warn(
        'npm-package-analyser: DEPENDENCY_REPORT_SECURE_ICON_URL could not be loaded; using built-in check icon in PDF.',
      );
    }
  }

  const title = opts.title || DEFAULT_PDF_TITLE;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: title,
      Author: 'npm-package-analyser',
    },
  });

  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a1a1a').text(title, { align: 'center' });
  doc.moveDown(0.3);
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#333333')
    .text(`Generated: ${formatGeneratedAt()}`, { align: 'center' });
  doc.moveDown(0.25);
  const scopeLabel =
    preferences.packageGraph === 'direct'
      ? 'Scope: package.json dependencies only'
      : 'Scope: full dependency tree (when lockfile present)';
  const tableLabel =
    preferences.tableScope === 'vulnerable-only'
      ? 'Table: packages matching severity filter only'
      : 'Table: all analyzed packages';
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#555555')
    .text(`${scopeLabel} · Severity focus: ${severityFloorLabel(preferences.severityFloor)} · ${tableLabel}`, {
      align: 'center',
    });
  doc.moveDown(1.0);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;
  const weights = [1.88, 0.55, 0.92, 0.92, 0.88, 0.72, 1.13];
  const sum = weights.reduce((a, b) => a + b, 0);
  const cols = weights.map((w) => (w / sum) * pageWidth);
  const SECURE_COL = 1;
  const INSTALLED_COL = 2;
  const LATEST_COL = 3;
  const UPDATE_COL = 4;
  const SIZE_COL = 5;
  const LAST_UPDATE_COL = 6;

  const rowH = 22;
  const headerH = 26;
  let y = doc.y;

  function ensureSpace(heightNeeded) {
    if (y + heightNeeded > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }

  function columnLeft(index) {
    let left = x0;
    for (let j = 0; j < index; j++) {
      left += cols[j];
    }
    return left;
  }

  /**
   * @param {number} x
   * @param {number} width
   * @param {string} text
   * @param {{ size?: number, bold?: boolean, color?: string, align?: 'left'|'center'|'right' }} [options]
   */
  function drawCellText(x, width, text, options = {}) {
    const t = String(text ?? '—');
    const align = options.align || 'left';
    doc.save();
    doc
      .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(options.size || 7)
      .fillColor(options.color || PDF_TABLE.bodyText);
    doc.text(t, x + 4, y + 5, {
      width: width - 8,
      ellipsis: true,
      lineBreak: false,
      align,
    });
    doc.restore();
  }

  /**
   * @param {number} ux
   * @param {number} colW
   * @param {string} label
   * @param {{ bg: string, fg: string }} style
   * @param {{ bold?: boolean, fontSize?: number }} [fontOpts]
   */
  function drawPill(ux, colW, label, style, fontOpts = {}) {
    const bold = fontOpts.bold !== false;
    const fs = typeof fontOpts.fontSize === 'number' ? fontOpts.fontSize : TAG_FONT;
    doc.save();
    const innerPad = 4;
    const maxTagW = Math.max(0, colW - innerPad * 2);

    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    const textW = doc.widthOfString(label);
    let tagW = Math.min(textW + PILL_PAD_X * 2, maxTagW);
    if (tagW < fs + PILL_PAD_X) {
      tagW = Math.min(maxTagW, fs + PILL_PAD_X * 2);
    }
    const tagH = fs + PILL_PAD_Y * 2;
    const tagX = ux + (colW - tagW) / 2;
    const tagY = y + (rowH - tagH) / 2;

    doc.roundedRect(tagX, tagY, tagW, tagH, PILL_RADIUS).fill(style.bg);
    doc.fillColor(style.fg);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    const lineH = doc.currentLineHeight(true);
    const textY = tagY + (tagH - lineH) / 2 + lineH * 0.08;
    doc.text(label, tagX, textY, {
      width: tagW,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
    doc.restore();
  }

  /**
   * @param {number} ux
   * @param {number} colW
   * @param {Buffer | null} [iconBuffer]
   */
  function drawSecureCleanPill(ux, colW, iconBuffer) {
    const style = PDF_TABLE.latestPill;
    const fs = 7.2;
    const innerPad = 4;
    const maxTagW = Math.max(0, colW - innerPad * 2);
    let tagW = Math.min(fs + PILL_PAD_X * 2, maxTagW);
    const tagH = fs + PILL_PAD_Y * 2;
    const tagX = ux + (colW - tagW) / 2;
    const tagY = y + (rowH - tagH) / 2;
    doc.save();
    doc.roundedRect(tagX, tagY, tagW, tagH, PILL_RADIUS).fill(style.bg);
    const cx = tagX + tagW / 2;
    const cy = tagY + tagH / 2 + 0.35;
    const arm = Math.min(tagW, tagH) * 0.3;
    if (iconBuffer && Buffer.isBuffer(iconBuffer) && iconBuffer.length > 0) {
      try {
        const maxSide = Math.min(tagW - 2, tagH - 2, 11);
        const ix = tagX + (tagW - maxSide) / 2;
        const iy = tagY + (tagH - maxSide) / 2;
        doc.image(iconBuffer, ix, iy, { width: maxSide, height: maxSide, fit: [maxSide, maxSide] });
      } catch {
        drawPdfCheckStroke(doc, cx, cy, arm, style.fg);
      }
    } else {
      drawPdfCheckStroke(doc, cx, cy, arm, style.fg);
    }
    doc.restore();
  }

  ensureSpace(headerH);
  doc.save();
  doc.rect(x0, y, pageWidth, headerH).fill(PDF_TABLE.headerBg);
  doc.restore();

  let cx = x0;
  const headers = [
    'Package',
    'Secure',
    'Installed',
    'Latest',
    'Update',
    'Size',
    'Last Update',
  ];
  headers.forEach((h, i) => {
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_TABLE.headerText);
    let hAlign = 'left';
    if (i === SECURE_COL || i === INSTALLED_COL || i === LATEST_COL || i === UPDATE_COL) {
      hAlign = 'center';
    }
    if (i === SIZE_COL) {
      hAlign = 'right';
    }
    doc.text(h, cx + 4, y + 8, {
      width: cols[i] - 8,
      align: hAlign,
      lineBreak: false,
      ellipsis: true,
    });
    doc.restore();
    cx += cols[i];
  });
  y += headerH;

  for (const r of rows) {
    ensureSpace(rowH);

    doc.save();
    doc.rect(x0, y, pageWidth, rowH).fill(PDF_TABLE.rowBg);
    doc.strokeColor(PDF_TABLE.grid).lineWidth(0.25);
    doc.rect(x0, y, pageWidth, rowH).stroke();
    doc.restore();

    const lastUpdate = formatLastUpdate(r.lastPublished);
    const registryNote = Boolean(r.registryError);
    const updateLabel = formatUpdateColumnLabel(r.updateType, registryNote);
    const badge = updateBadgeColors(r.updateType);

    const pkgLabel = r.kind === 'transitive' ? `${r.name} (transitive)` : r.name;
    drawCellText(columnLeft(0), cols[0], pkgLabel, { align: 'left' });

    const secUx = columnLeft(SECURE_COL);
    const secW = cols[SECURE_COL];
    const secLevel = r.securityLevel ?? 'unknown';
    if (secLevel === 'none') {
      drawSecureCleanPill(secUx, secW, secureIconBuffer);
    } else if (secLevel === 'unknown') {
      drawCellText(secUx, secW, '\u2014', { align: 'center', size: 9, color: '#94A3B8' });
    } else if (secLevel === 'info') {
      drawPill(secUx, secW, GLYPH_INFO, SECURE_ISSUE_PILL.info, { fontSize: 7.2 });
    } else {
      const issueStyle = SECURE_ISSUE_PILL[secLevel] ?? SECURE_ISSUE_PILL.high;
      drawPill(secUx, secW, GLYPH_ADVISORY, issueStyle, { fontSize: 7.5 });
    }

    const installedText = r.installedVersion ?? '—';
    const latestText = r.latestVersion ?? '—';
    if (installedText === '—') {
      drawCellText(columnLeft(INSTALLED_COL), cols[INSTALLED_COL], '—', {
        align: 'center',
      });
    } else {
      drawPill(columnLeft(INSTALLED_COL), cols[INSTALLED_COL], installedText, PDF_TABLE.installedPill);
    }
    if (latestText === '—') {
      drawCellText(columnLeft(LATEST_COL), cols[LATEST_COL], '—', { align: 'center' });
    } else {
      drawPill(columnLeft(LATEST_COL), cols[LATEST_COL], latestText, PDF_TABLE.latestPill);
    }

    drawCellText(columnLeft(SIZE_COL), cols[SIZE_COL], formatBytes(r.unpackedSizeBytes), {
      align: 'right',
    });
    drawCellText(columnLeft(LAST_UPDATE_COL), cols[LAST_UPDATE_COL], lastUpdate, { align: 'left' });

    drawPill(columnLeft(UPDATE_COL), cols[UPDATE_COL], updateLabel, badge);

    y += rowH;
  }

  const stats = summarizeDependencyRows(summarySource, preferences);
  const narrative = buildStructuredSummary(stats);
  const summaryReserve =
    320 +
    stats.withAdvisory.length * 11 +
    narrative.priorityLines.length * 11 +
    narrative.recommendationLines.length * 10;

  const needsRegistryFootnote =
    rows.some((row) => row.registryError) ||
    summarySource.some((row) => row.registryError);
  doc.moveDown(0.75);
  y = doc.y;
  ensureSpace((needsRegistryFootnote ? 72 : 0) + summaryReserve);
  if (needsRegistryFootnote) {
    const footnoteRest =
      'If an update tag shows a trailing asterisk (*), the latest version could not be read from the npm registry. ' +
      'Typical reasons are git, file, link, or workspace dependencies, or a failed registry request.';
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#555555')
      .text('Note: ', x0, y, { continued: true, lineBreak: false });
    doc
      .font('Helvetica')
      .fillColor('#666666')
      .text(footnoteRest, {
        width: pageWidth,
        lineGap: 2,
        align: 'left',
      });
    doc.moveDown(0.55);
    y = doc.y;
  }
  doc.moveDown(0.5);
  ensureSpace(Math.min(380, 260 + stats.withAdvisory.length * 11));

  const bulletX = x0 + 6;
  const bulletW = pageWidth - 12;

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('Summary', x0, doc.y, {
    width: pageWidth,
    lineGap: 2,
  });
  doc.moveDown(0.35);

  /**
   * @param {string} sectionTitle
   * @param {string[]} lines
   */
  function writeSummarySection(sectionTitle, lines) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1a1a1a').text(sectionTitle, x0, doc.y, {
      width: pageWidth,
      lineGap: 2,
    });
    doc.moveDown(0.14);
    doc.font('Helvetica').fontSize(8).fillColor('#374151');
    for (const line of lines) {
      doc.text(`• ${line}`, bulletX, doc.y, {
        width: bulletW,
        lineGap: 2.5,
        align: 'left',
      });
    }
    doc.moveDown(0.32);
  }

  writeSummarySection('Dependency Health Overview', narrative.healthLines);
  writeSummarySection('Security Status', narrative.securityLines);

  if (narrative.priorityLines.length > 0) {
    y = doc.y;
    ensureSpace(28 + narrative.priorityLines.length * 12);
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#991B1B')
      .text('Highest-priority vulnerabilities (Critical and High)', x0, doc.y, {
        width: pageWidth,
        lineGap: 2,
      });
    doc.moveDown(0.1);
    doc.font('Helvetica').fontSize(8).fillColor('#444444');
    for (const line of narrative.priorityLines) {
      y = doc.y;
      ensureSpace(14);
      doc.text(`• ${line}`, bulletX + 2, doc.y, {
        width: bulletW - 2,
        lineGap: 1.5,
        align: 'left',
      });
    }
    doc.moveDown(0.28);
  }

  if (stats.withAdvisory.length > 0) {
    y = doc.y;
    ensureSpace(28 + Math.min(stats.withAdvisory.length * 12, 400));
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#991B1B')
      .text('Packages with vulnerabilities', x0, doc.y, {
        width: pageWidth,
        lineGap: 2,
      });
    doc.moveDown(0.1);
    doc.font('Helvetica').fontSize(8).fillColor('#444444');
    for (const { name, level } of stats.withAdvisory) {
      y = doc.y;
      ensureSpace(14);
      doc.text(`• ${name} (highest: ${capitalizeSeverity(level)})`, bulletX + 2, doc.y, {
        width: bulletW - 2,
        lineGap: 1.5,
        align: 'left',
      });
    }
    doc.moveDown(0.28);
  }

  writeSummarySection('Recommendation', narrative.recommendationLines);

  const overallColor = narrative.overallIsPositive ? SUMMARY_ALL_SECURE_FG : '#B45309';
  const yOverall = doc.y;
  const overallFs = 9;
  const overallGap = 4;
  doc.font('Helvetica-Bold').fontSize(overallFs);
  const overallLabelStr = `${narrative.overallLabel}: `;
  const labelW = doc.widthOfString(overallLabelStr);
  doc.fillColor('#1a1a1a').text(overallLabelStr, x0, yOverall, { lineBreak: false });

  const detailX = x0 + labelW + overallGap;
  doc.font('Helvetica-Bold').fontSize(overallFs).fillColor(overallColor);
  doc.text(narrative.overallDetail, detailX, yOverall, { lineBreak: false });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

module.exports = { writePdfReport, DEFAULT_PDF_TITLE };
