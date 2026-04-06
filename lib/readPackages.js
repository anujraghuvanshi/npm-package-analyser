/**
 * Load dependencies from package.json and resolve installed versions from node_modules.
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');
const { readResolvedLockPairs } = require('./lockfile');

/**
 * @param {string} projectRoot
 * @returns {{ name: string, wantedRange: string, kind: 'dependencies' | 'devDependencies' }[]}
 */
function collectDeclaredPackages(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);

  const out = [];

  const deps = pkg.dependencies || {};
  for (const [name, wantedRange] of Object.entries(deps)) {
    out.push({
      name,
      wantedRange: String(wantedRange),
      kind: 'dependencies',
    });
  }

  const devDeps = pkg.devDependencies || {};
  for (const [name, wantedRange] of Object.entries(devDeps)) {
    out.push({
      name,
      wantedRange: String(wantedRange),
      kind: 'devDependencies',
    });
  }

  return out;
}

/**
 * Read version from node_modules/<name>/package.json (supports scoped names).
 * @param {string} projectRoot
 * @param {string} packageName
 * @returns {string | null}
 */
function readInstalledVersion(projectRoot, packageName) {
  const parts = packageName.startsWith('@') ? packageName.split('/') : [packageName];
  const rel =
    parts.length === 2
      ? path.join('node_modules', parts[0], parts[1])
      : path.join('node_modules', parts[0]);
  const installedPkgPath = path.join(projectRoot, rel, 'package.json');

  try {
    const data = JSON.parse(fs.readFileSync(installedPkgPath, 'utf8'));
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Heuristic: npm registry cannot resolve arbitrary git/file/tar URLs as "latest" the same way.
 * @param {string} range
 */
function isNonRegistrySpec(range) {
  return (
    /^(file:|git\+|git:|github:|https?:\/\/|link:|workspace:|workspace:\*)/i.test(
      range.trim(),
    ) || range.includes('/')
  );
}

/**
 * When package.json pins an exact semver (not a range like ^1.0.0), use it for reporting
 * and OSV if the lockfile omits the package and node_modules is missing (stale install).
 * @param {string} wantedRange
 * @returns {string | null}
 */
function exactVersionFromDeclaredRange(wantedRange) {
  if (!wantedRange || typeof wantedRange !== 'string') {
    return null;
  }
  const s = wantedRange.trim();
  if (!s || isNonRegistrySpec(s)) {
    return null;
  }
  const v = semver.valid(s);
  return v || null;
}

/**
 * Targets for the report: every resolved package from package-lock.json or yarn.lock (transitives
 * included), merged with any direct dependency from package.json that is missing from the lockfile.
 * @param {string} projectRoot
 * @param {{ directOnly?: boolean }} [opts]
 * @returns {{
 *   name: string,
 *   wantedRange: string,
 *   kind: 'dependencies' | 'devDependencies' | 'transitive',
 *   lockedVersion: string | null
 * }[]}
 */
function collectReportTargets(projectRoot, opts = {}) {
  const { directOnly = false } = opts;
  const declared = collectDeclaredPackages(projectRoot);
  const directByName = new Map(declared.map((d) => [d.name, d]));
  const lockPairs = readResolvedLockPairs(projectRoot);

  if (lockPairs && lockPairs.length > 0) {
    /** @type {{ name: string, wantedRange: string, kind: 'dependencies' | 'devDependencies' | 'transitive', lockedVersion: string | null }[]} */
    const out = [];
    const seen = new Set();

    for (const { name, version } of lockPairs) {
      if (directOnly && !directByName.has(name)) {
        continue;
      }
      const key = `${name}@${version}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const d = directByName.get(name);
      out.push({
        name,
        wantedRange: d ? d.wantedRange : version,
        kind: d ? d.kind : 'transitive',
        lockedVersion: version,
      });
    }

    for (const d of declared) {
      const anyLocked = lockPairs.some((p) => p.name === d.name);
      if (anyLocked) {
        continue;
      }
      const installed = readInstalledVersion(projectRoot, d.name);
      const pinned = exactVersionFromDeclaredRange(d.wantedRange);
      const resolved = installed ?? pinned ?? null;
      const key = resolved ? `${d.name}@${resolved}` : `__node__${d.name}`;
      if (resolved && seen.has(key)) {
        continue;
      }
      if (resolved) {
        seen.add(key);
      }
      out.push({
        name: d.name,
        wantedRange: d.wantedRange,
        kind: d.kind,
        lockedVersion: resolved,
      });
    }

    return out;
  }

  return declared.map((d) => ({
    name: d.name,
    wantedRange: d.wantedRange,
    kind: d.kind,
    lockedVersion:
      readInstalledVersion(projectRoot, d.name) ??
      exactVersionFromDeclaredRange(d.wantedRange),
  }));
}

module.exports = {
  collectDeclaredPackages,
  collectReportTargets,
  readInstalledVersion,
  isNonRegistrySpec,
  exactVersionFromDeclaredRange,
};
