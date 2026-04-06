/**
 * Resolved dependency pairs from package-lock.json (npm) or yarn.lock (Yarn v1 classic).
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} v
 */
function shouldSkipVersion(v) {
  if (!v || typeof v !== 'string') {
    return true;
  }
  const t = v.trim();
  if (!t || t === 'null' || t === 'undefined') {
    return true;
  }
  return /^(file:|git\+|git:|github:|link:|workspace:|\*)/i.test(t) || /^https?:\/\//i.test(t);
}

/**
 * @param {string} key
 */
function nameFromLockPackagesKey(key) {
  const k = key.replace(/\\/g, '/');
  const i = k.lastIndexOf('node_modules/');
  if (i === -1) {
    return null;
  }
  return k.slice(i + 'node_modules/'.length) || null;
}

/**
 * @param {string} projectRoot
 * @returns {{ name: string, version: string }[] | null}
 */
function readPackageLockPairs(projectRoot) {
  const lockPath = path.join(projectRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }

  /** @type {{ name: string, version: string }[]} */
  const out = [];
  const seen = new Set();

  function add(name, version) {
    if (!name || shouldSkipVersion(version)) {
      return;
    }
    const k = `${name}@${version}`;
    if (seen.has(k)) {
      return;
    }
    seen.add(k);
    out.push({ name, version: version.trim() });
  }

  if (lock.packages && typeof lock.packages === 'object') {
    for (const [pkgPath, meta] of Object.entries(lock.packages)) {
      if (!meta || typeof meta !== 'object' || !meta.version) {
        continue;
      }
      const name = typeof meta.name === 'string' ? meta.name : nameFromLockPackagesKey(pkgPath);
      add(name, meta.version);
    }
  } else if (lock.dependencies && typeof lock.dependencies === 'object') {
    const walk = (deps) => {
      if (!deps || typeof deps !== 'object') {
        return;
      }
      for (const [name, node] of Object.entries(deps)) {
        if (node && typeof node === 'object' && typeof node.version === 'string') {
          add(name, node.version);
        }
        if (node && node.dependencies) {
          walk(node.dependencies);
        }
      }
    };
    walk(lock.dependencies);
  }

  return out.length ? out : null;
}

/**
 * Yarn v1 classic lockfile key → npm package name.
 * @param {string} key
 * @returns {string | null}
 */
function packageNameFromYarnLockKey(key) {
  if (!key || typeof key !== 'string') {
    return null;
  }
  if (key.startsWith('@')) {
    const idx = key.indexOf('@', 1);
    if (idx === -1) {
      return null;
    }
    return key.slice(0, idx);
  }
  const idx = key.lastIndexOf('@');
  if (idx <= 0) {
    return null;
  }
  return key.slice(0, idx);
}

/**
 * @param {string} projectRoot
 * @returns {{ name: string, version: string }[] | null}
 */
function readYarnLockPairs(projectRoot) {
  const lockPath = path.join(projectRoot, 'yarn.lock');
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  let lockfile;
  try {
    lockfile = require('@yarnpkg/lockfile');
  } catch {
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch {
    return null;
  }
  /** Yarn 2+ starts with __metadata — classic parser won't produce useful entries */
  if (/^__metadata\s*:/m.test(raw.trimStart())) {
    return null;
  }
  const parsed = lockfile.parse(raw);
  if (!parsed || parsed.type !== 'success' || !parsed.object || typeof parsed.object !== 'object') {
    return null;
  }

  /** @type {{ name: string, version: string }[]} */
  const out = [];
  const seen = new Set();

  for (const [descriptor, meta] of Object.entries(parsed.object)) {
    if (!meta || typeof meta !== 'object') {
      continue;
    }
    const version =
      typeof meta.version === 'string'
        ? meta.version
        : typeof (/** @type {*} */ (meta)).Version === 'string'
          ? (/** @type {*} */ (meta)).Version
          : null;
    const name = packageNameFromYarnLockKey(descriptor);
    if (!name || shouldSkipVersion(version)) {
      continue;
    }
    const k = `${name}@${version}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push({ name, version: version.trim() });
  }

  return out.length ? out : null;
}

/**
 * Prefer npm lockfile when present; otherwise Yarn v1 yarn.lock.
 * @param {string} projectRoot
 * @returns {{ name: string, version: string }[] | null}
 */
function readResolvedLockPairs(projectRoot) {
  const npmLock = readPackageLockPairs(projectRoot);
  if (npmLock && npmLock.length > 0) {
    return npmLock;
  }
  return readYarnLockPairs(projectRoot);
}

module.exports = {
  readPackageLockPairs,
  readYarnLockPairs,
  readResolvedLockPairs,
  shouldSkipVersion,
};
