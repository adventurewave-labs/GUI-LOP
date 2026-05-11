/**
 * Docker-availability helper for the contract-test suites.
 *
 * Testcontainers requires a working Docker daemon. The sandboxed CI agents
 * and many local dev environments do not expose `/var/run/docker.sock`, so
 * every contract suite must self-skip cleanly instead of failing.
 *
 * Usage:
 *   import { describeIfDocker } from '../_helpers/docker-available.js';
 *   describeIfDocker('PgFooRepository contract', () => { ... });
 *
 * The check is performed lazily and the result cached for the duration of
 * the Jest worker so we don't pay the cost on every `describe` block.
 *
 * Detection strategy (cheap, no docker pulls):
 *   1. `DOCKER_HOST` env var — honour the operator's explicit endpoint.
 *   2. Otherwise probe the canonical Unix socket at `/var/run/docker.sock`.
 *   3. On Windows, accept the named pipe `//./pipe/docker_engine`.
 *
 * We deliberately avoid running `docker info` as a subprocess: that adds
 * 200-800 ms per process and breaks in environments where the CLI exists
 * but the daemon doesn't.
 */

import fs from 'node:fs';
import os from 'node:os';

let _cachedAvailable = null;
let _cachedReason = null;

function probeUnixSocket(path) {
  try {
    const stat = fs.statSync(path);
    return stat.isSocket();
  } catch {
    return false;
  }
}

function probeWindowsPipe(path) {
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

/**
 * @returns {{ available: boolean, reason: string }}
 */
function detect() {
  if (_cachedAvailable !== null) {
    return { available: _cachedAvailable, reason: _cachedReason };
  }

  if (process.env.DOCKER_HOST && process.env.DOCKER_HOST.trim() !== '') {
    _cachedAvailable = true;
    _cachedReason = `DOCKER_HOST=${process.env.DOCKER_HOST}`;
    return { available: true, reason: _cachedReason };
  }

  if (os.platform() === 'win32') {
    if (probeWindowsPipe('\\\\.\\pipe\\docker_engine')) {
      _cachedAvailable = true;
      _cachedReason = 'named pipe \\\\.\\pipe\\docker_engine';
      return { available: true, reason: _cachedReason };
    }
    _cachedAvailable = false;
    _cachedReason = 'no Docker named pipe found';
    return { available: false, reason: _cachedReason };
  }

  if (probeUnixSocket('/var/run/docker.sock')) {
    _cachedAvailable = true;
    _cachedReason = '/var/run/docker.sock';
    return { available: true, reason: _cachedReason };
  }

  const home = process.env.HOME || '';
  const candidates = [
    `${home}/.docker/run/docker.sock`,
    `${home}/.colima/default/docker.sock`,
    '/run/docker.sock',
  ].filter(Boolean);
  for (const p of candidates) {
    if (probeUnixSocket(p)) {
      _cachedAvailable = true;
      _cachedReason = p;
      return { available: true, reason: _cachedReason };
    }
  }

  _cachedAvailable = false;
  _cachedReason = 'no Docker socket found';
  return { available: false, reason: _cachedReason };
}

/** Synchronous boolean check, cached for the process lifetime. */
export function isDockerAvailable() {
  return detect().available;
}

/** Reason string describing how Docker was detected (or why it wasn't). */
export function dockerStatus() {
  return detect().reason;
}

let _printedSkipNotice = false;

/**
 * `describe`-replacement that auto-skips when Docker is unavailable.
 *
 * The skipped block name is suffixed with `[skipped: docker unavailable]`
 * so the reason is visible in Jest output, and a one-time console line is
 * printed at first skip so CI logs don't silently swallow the fact.
 */
export function describeIfDocker(name, fn) {
  const { available, reason } = detect();
  if (available) {
    return describe(name, fn);
  }
  if (!_printedSkipNotice) {
    _printedSkipNotice = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[contracts] Docker unavailable (${reason}); ` +
        'real-infrastructure contract suites will be skipped. ' +
        'Set DOCKER_HOST or start the docker daemon to run them.',
    );
  }
  // eslint-disable-next-line jest/no-disabled-tests
  return describe.skip(`${name} [skipped: docker unavailable]`, fn);
}
