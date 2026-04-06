/**
 * Fetch package metadata from the public npm registry (using fetch).
 */

const REGISTRY_BASE = 'https://registry.npmjs.org';
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * @typedef {object} RegistryMeta
 * @property {string | null} latestVersion
 * @property {string | null} lastPublished
 * @property {number | null} unpackedSizeBytes
 * @property {string | null} error
 */

/**
 * @param {string} packageName
 * @returns {Promise<RegistryMeta>}
 */
async function fetchPackageMeta(packageName) {
  const url = `${REGISTRY_BASE}/${encodeURIComponent(packageName)}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (res.status === 404) {
      return {
        latestVersion: null,
        lastPublished: null,
        unpackedSizeBytes: null,
        error: 'Package not found on registry',
      };
    }

    if (!res.ok) {
      return {
        latestVersion: null,
        lastPublished: null,
        unpackedSizeBytes: null,
        error: `Registry HTTP ${res.status}`,
      };
    }

    const data = await res.json();

    if (data == null || data.error || !data['dist-tags']) {
      return {
        latestVersion: null,
        lastPublished: null,
        unpackedSizeBytes: null,
        error: data?.error || 'Not found or invalid registry response',
      };
    }

    const latest = data['dist-tags']?.latest;
    if (!latest || typeof latest !== 'string') {
      return {
        latestVersion: null,
        lastPublished: null,
        unpackedSizeBytes: null,
        error: 'No dist-tags.latest',
      };
    }

    const timeMap = data.time || {};
    const lastPublished = typeof timeMap[latest] === 'string' ? timeMap[latest] : null;

    const verInfo = data.versions?.[latest];
    const unpacked =
      verInfo?.dist && typeof verInfo.dist.unpackedSize === 'number'
        ? verInfo.dist.unpackedSize
        : null;

    return {
      latestVersion: latest,
      lastPublished,
      unpackedSizeBytes: unpacked,
      error: null,
    };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return {
      latestVersion: null,
      lastPublished: null,
      unpackedSizeBytes: null,
      error: message,
    };
  }
}

module.exports = { fetchPackageMeta, REGISTRY_BASE };
