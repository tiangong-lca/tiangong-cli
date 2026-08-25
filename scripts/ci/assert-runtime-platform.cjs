#!/usr/bin/env node

const ALLOWED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const ALLOWED_ARCHITECTURES = new Set(['arm64', 'x64']);

function parseArgs(argv) {
  const options = { platform: '', arch: '' };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== '--platform' && flag !== '--arch') {
      throw new Error(`unknown argument '${flag}'`);
    }
    if (seen.has(flag)) {
      throw new Error(`duplicate argument '${flag}'`);
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    seen.add(flag);
    index += 1;
    options[flag === '--platform' ? 'platform' : 'arch'] = value;
  }
  if (!ALLOWED_PLATFORMS.has(options.platform)) {
    throw new Error('--platform must be one of darwin, linux, or win32');
  }
  if (!ALLOWED_ARCHITECTURES.has(options.arch)) {
    throw new Error('--arch must be arm64 or x64');
  }
  return options;
}

function assertRuntimePlatform(expected, actual = process) {
  if (actual.platform !== expected.platform || actual.arch !== expected.arch) {
    throw new Error(
      `runner platform mismatch: expected ${expected.platform}/${expected.arch}, received ${actual.platform}/${actual.arch}`,
    );
  }
  return { platform: actual.platform, arch: actual.arch };
}

function main() {
  const expected = parseArgs(process.argv.slice(2));
  const actual = assertRuntimePlatform(expected);
  process.stdout.write(`${JSON.stringify({ ok: true, ...actual })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assertRuntimePlatform, parseArgs };
