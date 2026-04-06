/**
 * Compare installed vs latest using semver and classify update type.
 */

const semver = require('semver');
const { UPDATE_TYPE } = require('./constants');
const { isNonRegistrySpec } = require('./readPackages');

/**
 * @param {string | null} installed
 * @param {string | null} latest
 * @returns {typeof UPDATE_TYPE[keyof typeof UPDATE_TYPE]}
 */
function classifyUpdateType(installed, latest) {
  if (!latest) {
    return UPDATE_TYPE.UNKNOWN;
  }
  if (!installed || !semver.valid(installed)) {
    return UPDATE_TYPE.UNKNOWN;
  }
  if (!semver.valid(latest)) {
    return UPDATE_TYPE.UNKNOWN;
  }

  if (semver.eq(installed, latest)) {
    return UPDATE_TYPE.UP_TO_DATE;
  }

  if (!semver.gt(latest, installed)) {
    const pre = semver.prerelease(installed);
    if (pre && semver.eq(semver.coerce(installed), semver.coerce(latest))) {
      return UPDATE_TYPE.PRERELEASE;
    }
    return UPDATE_TYPE.UNKNOWN;
  }

  const diff = semver.diff(installed, latest);
  if (diff === 'major') {
    return UPDATE_TYPE.MAJOR;
  }
  if (diff === 'minor') {
    return UPDATE_TYPE.MINOR;
  }
  if (diff === 'patch') {
    return UPDATE_TYPE.PATCH;
  }
  if (diff === 'prerelease') {
    return UPDATE_TYPE.PRERELEASE;
  }
  return UPDATE_TYPE.UNKNOWN;
}

function describeNonRegistryRow(wantedRange) {
  if (isNonRegistrySpec(wantedRange)) {
    return {
      skipRegistry: true,
      note: 'Non-registry spec (git/file/link/workspace)',
    };
  }
  return { skipRegistry: false, note: null };
}

module.exports = {
  classifyUpdateType,
  describeNonRegistryRow,
};
