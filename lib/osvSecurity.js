/**
 * Map installed npm packages to security status using the OSV.dev API (Open Source Vulnerabilities).
 * @see https://google.github.io/osv.dev/api/
 */

const { readResolvedLockPairs, shouldSkipVersion } = require('./lockfile');

const OSV_DEFAULT_BASE = 'https://api.osv.dev';
const OSV_ECOSYSTEM = 'npm';
const BATCH_SIZE = 150;
const VULN_FETCH_CONCURRENCY = 12;
const REQUEST_TIMEOUT_MS =
  Number(process.env.DEPENDENCY_REPORT_OSV_TIMEOUT_MS) || 120000;

/** @typedef {'none' | 'info' | 'low' | 'moderate' | 'high' | 'critical' | 'unknown'} SecurityLevel */

/**
 * @param {SecurityLevel} a
 * @param {SecurityLevel} b
 * @returns {SecurityLevel}
 */
function maxSeverity(a, b) {
  const rank = { none: 0, info: 1, low: 2, moderate: 3, high: 4, critical: 5, unknown: 0 };
  const ra = rank[a] ?? 0;
  const rb = rank[b] ?? 0;
  return ra >= rb ? a : b;
}

/**
 * @param {{ name: string, version: string }[]} a
 * @param {{ name: string, version: string }[]} b
 * @returns {{ name: string, version: string }[]}
 */
function mergeQueryPairs(a, b) {
  const seen = new Set();
  /** @type {{ name: string, version: string }[]} */
  const out = [];
  for (const list of [a, b]) {
    for (const p of list) {
      if (!p || shouldSkipVersion(p.version)) {
        continue;
      }
      const k = `${p.name}@${p.version.trim()}`;
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push({ name: p.name, version: p.version.trim() });
    }
  }
  return out;
}

/**
 * @param {string} projectRoot
 * @param {Array<{ name: string, installedVersion?: string | null }>} rows
 * @returns {{ name: string, version: string }[]}
 */
function buildOsvQueries(projectRoot, rows) {
  const fromLock = readResolvedLockPairs(projectRoot) || [];
  const fromRows = pairsFromRows(rows);
  return mergeQueryPairs(fromLock, fromRows);
}

/**
 * @param {Array<{ name: string, installedVersion?: string | null }>} rows
 */
function pairsFromRows(rows) {
  const seen = new Set();
  /** @type {{ name: string, version: string }[]} */
  const out = [];
  for (const r of rows) {
    const v = r.installedVersion;
    if (!v || shouldSkipVersion(v)) {
      continue;
    }
    const k = `${r.name}@${v}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push({ name: r.name, version: v.trim() });
  }
  return out;
}

/**
 * @param {object} vuln
 * @returns {SecurityLevel}
 */
function severityFromVulnRecord(vuln) {
  if (!vuln || typeof vuln !== 'object') {
    return 'moderate';
  }

  let best = 0;
  const rank = { info: 1, low: 2, moderate: 3, high: 4, critical: 5 };

  /** @param {string} raw */
  const bumpFromLabel = (raw) => {
    if (!raw || typeof raw !== 'string') {
      return;
    }
    const s = raw.trim().toLowerCase();
    let r = 0;
    if (s === 'critical') {
      r = 5;
    } else if (s === 'high') {
      r = 4;
    } else if (s === 'moderate' || s === 'medium') {
      r = 3;
    } else if (s === 'low') {
      r = 2;
    } else if (s === 'info' || s === 'informational') {
      r = 1;
    }
    if (r > best) {
      best = r;
    }
  };

  const dsTop = vuln.database_specific;
  if (dsTop && typeof dsTop === 'object' && dsTop.severity) {
    bumpFromLabel(String(dsTop.severity));
  }

  if (Array.isArray(vuln.severity)) {
    for (const entry of vuln.severity) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const scoreStr = entry.score;
      if (typeof scoreStr === 'string') {
        const n = parseFloat(scoreStr);
        if (!Number.isNaN(n)) {
          if (n >= 9.0) {
            best = Math.max(best, 5);
          } else if (n >= 7.0) {
            best = Math.max(best, 4);
          } else if (n >= 4.0) {
            best = Math.max(best, 3);
          } else if (n > 0) {
            best = Math.max(best, 2);
          }
        }
      }
    }
  }

  for (const aff of vuln.affected || []) {
    if (!aff || typeof aff !== 'object') {
      continue;
    }
    const ds = aff.database_specific;
    const es = aff.ecosystem_specific;
    if (ds && typeof ds === 'object' && ds.severity) {
      bumpFromLabel(String(ds.severity));
    }
    if (es && typeof es === 'object' && es.severity) {
      bumpFromLabel(String(es.severity));
    }
  }

  if (best === 5) {
    return 'critical';
  }
  if (best === 4) {
    return 'high';
  }
  if (best === 3) {
    return 'moderate';
  }
  if (best === 2) {
    return 'low';
  }
  if (best === 1) {
    return 'info';
  }
  return 'moderate';
}

/**
 * @param {string} baseUrl
 * @param {unknown} body
 */
async function osvPostJson(baseUrl, pathname, body) {
  const url = `${baseUrl.replace(/\/$/, '')}${pathname}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'npm-package-analyser/1.0 (+https://osv.dev)',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * @param {string} baseUrl
 * @param {string} id
 */
async function osvGetVuln(baseUrl, id) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/vulns/${encodeURIComponent(id)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.min(REQUEST_TIMEOUT_MS, 60000));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'npm-package-analyser/1.0 (+https://osv.dev)',
      },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * @param {{ name: string, version: string }[]} queries
 * @param {string} baseUrl
 * @returns {Promise<{ ok: boolean, idLists: string[][] }>}
 */
async function runQueryBatches(queries, baseUrl) {
  /** @type {string[][]} */
  const allResults = [];

  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const chunk = queries.slice(i, i + BATCH_SIZE);
    const payload = {
      queries: chunk.map((q) => ({
        package: { ecosystem: OSV_ECOSYSTEM, name: q.name },
        version: q.version,
      })),
    };
    const json = await osvPostJson(baseUrl, '/v1/querybatch', payload);
    if (!json || !Array.isArray(json.results) || json.results.length !== chunk.length) {
      return { ok: false, idLists: [] };
    }
    for (let j = 0; j < chunk.length; j++) {
      const r = json.results[j];
      const vulns = Array.isArray(r?.vulns) ? r.vulns : [];
      const ids = vulns.map((v) => (v && v.id ? String(v.id) : '')).filter(Boolean);
      allResults.push(ids);
    }
  }

  return { ok: true, idLists: allResults };
}

/**
 * @param {string[]} ids
 * @param {string} baseUrl
 * @returns {Promise<Map<string, object>>}
 */
async function fetchVulnDetails(ids, baseUrl) {
  const unique = [...new Set(ids)];
  const map = new Map();
  if (unique.length === 0) {
    return map;
  }

  let next = 0;
  async function worker() {
    while (true) {
      const j = next++;
      if (j >= unique.length) {
        break;
      }
      const id = unique[j];
      const detail = await osvGetVuln(baseUrl, id);
      if (detail) {
        map.set(id, detail);
      }
    }
  }

  const nWorkers = Math.min(VULN_FETCH_CONCURRENCY, unique.length);
  await Promise.all(Array.from({ length: nWorkers }, () => worker()));
  return map;
}

/**
 * Per exact package@version OSV result (so transitive rows match the right version).
 * @param {{ name: string, version: string }[]} queries
 * @param {string[][]} idLists
 * @param {Map<string, object>} details
 * @returns {Map<string, { level: SecurityLevel, count: number }>}
 */
function aggregateByPackageVersion(queries, idLists, details) {
  /** @type {Map<string, { level: SecurityLevel, count: number }>} */
  const out = new Map();

  for (let i = 0; i < queries.length; i++) {
    const { name, version } = queries[i];
    const ids = idLists[i] || [];
    const key = `${name}@${version}`;
    let level = /** @type {SecurityLevel} */ ('none');
    for (const id of ids) {
      const vuln = details.get(id);
      const sev = vuln ? severityFromVulnRecord(vuln) : 'moderate';
      level = maxSeverity(level, sev);
    }
    const count = ids.length;
    const finalLevel = count === 0 ? 'none' : level;
    const existing = out.get(key);
    if (existing) {
      out.set(key, {
        level: maxSeverity(existing.level, finalLevel),
        count: existing.count + count,
      });
    } else {
      out.set(key, { level: finalLevel, count });
    }
  }

  return out;
}

/**
 * @param {string} projectRoot
 * @param {Array<{ name: string, installedVersion?: string | null }>} rows
 * @returns {Promise<Map<string, { level: SecurityLevel, count: number }> | null>}
 */
async function fetchOsvSeverityMap(projectRoot, rows) {
  const baseUrl =
    String(process.env.DEPENDENCY_REPORT_OSV_API || OSV_DEFAULT_BASE).trim() ||
    OSV_DEFAULT_BASE;

  const queries = buildOsvQueries(projectRoot, rows);

  if (!queries.length) {
    return null;
  }

  const { ok, idLists } = await runQueryBatches(queries, baseUrl);
  if (!ok || idLists.length !== queries.length) {
    return null;
  }

  const allIds = idLists.flat();
  const details = await fetchVulnDetails(allIds, baseUrl);

  return aggregateByPackageVersion(queries, idLists, details);
}

/**
 * @param {SecurityLevel} level
 * @param {number} count
 */
function securityTooltip(level, count) {
  if (level === 'unknown') {
    return 'Security check unavailable (OSV request failed or invalid response)';
  }
  if (level === 'none') {
    return 'No known issues in OSV for queried versions';
  }
  const sev =
    level === 'critical'
      ? 'Critical'
      : level === 'high'
        ? 'High'
        : level === 'moderate'
          ? 'Moderate'
          : level === 'low'
            ? 'Low'
            : 'Info';
  return `${count} OSV record(s) — highest severity: ${sev}`;
}

/**
 * @param {string} projectRoot
 * @param {Array<{ name: string, installedVersion?: string | null }>} rows
 */
async function attachSecurityFromOsv(projectRoot, rows) {
  const queries = buildOsvQueries(projectRoot, rows);

  if (!queries.length) {
    const msg =
      'Security check skipped: add package-lock.json or yarn.lock, or install deps so versions are known for OSV';
    for (const row of rows) {
      row.securityLevel = 'unknown';
      row.securityCount = 0;
      row.securityTooltip = msg;
    }
    return;
  }

  let byExact;
  try {
    byExact = await fetchOsvSeverityMap(projectRoot, rows);
  } catch {
    byExact = null;
  }

  if (byExact == null) {
    for (const row of rows) {
      row.securityLevel = 'unknown';
      row.securityCount = 0;
      row.securityTooltip = securityTooltip('unknown', 0);
    }
    return;
  }

  for (const row of rows) {
    const v = row.installedVersion;
    if (!v || shouldSkipVersion(v)) {
      row.securityLevel = 'unknown';
      row.securityCount = 0;
      row.securityTooltip =
        'Security check skipped: no resolved semver version for this row (install or refresh lockfile)';
      continue;
    }
    const hit = byExact.get(`${row.name}@${v.trim()}`);
    if (hit) {
      row.securityLevel = hit.level;
      row.securityCount = hit.count;
    } else {
      row.securityLevel = 'none';
      row.securityCount = 0;
    }
    row.securityTooltip = securityTooltip(row.securityLevel, row.securityCount);
  }
}

module.exports = {
  attachSecurityFromOsv,
  fetchOsvSeverityMap,
  securityTooltip,
  readResolvedLockPairs: require('./lockfile').readResolvedLockPairs,
  readPackageLockPairs: require('./lockfile').readPackageLockPairs,
  readYarnLockPairs: require('./lockfile').readYarnLockPairs,
  pairsFromRows,
  severityFromVulnRecord,
};
