import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { tarBytes } from './helpers/runtime-component.js';
import type { ComponentFile } from '../src/lib/runtime/manifest-types.js';

const repo = process.cwd(),
  sourceSh = path.join(repo, 'scripts/bootstrap/tiangong-runtime-bootstrap.sh'),
  sourcePs = path.join(repo, 'scripts/bootstrap/tiangong-runtime-bootstrap.ps1');
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const fileHash = (file: string) => hash(fs.readFileSync(file));
function write(file: string, bytes: string | Buffer, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { mode });
}
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime bootstrap 空格 ')),
    scripts = path.join(root, 'installed skill'),
    project = path.join(root, 'user project'),
    downloads = path.join(root, 'downloads'),
    base = path.join(root, 'base');
  for (const dir of [scripts, project, downloads, base]) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(sourceSh, path.join(scripts, 'tiangong-runtime-bootstrap.sh'));
  const testScript = path.join(scripts, 'tiangong-runtime-bootstrap.sh');
  fs.writeFileSync(
    testScript,
    fs
      .readFileSync(testScript, 'utf8')
      .replace(
        'PATH=/usr/bin:/bin:/usr/sbin:/sbin',
        `PATH='${path.join(root, 'fakebin')}:/usr/bin:/bin:/usr/sbin:/sbin'`,
      ),
  );
  fs.chmodSync(testScript, 0o700);
  fs.copyFileSync(sourcePs, path.join(scripts, 'tiangong-runtime-bootstrap.ps1'));
  const log = path.join(root, 'argv.log'),
    nodeRelative = process.platform === 'win32' ? 'bin/node.exe' : 'bin/node';
  if (process.platform === 'win32') {
    fs.mkdirSync(path.dirname(path.join(base, nodeRelative)), { recursive: true });
    fs.copyFileSync(process.execPath, path.join(base, nodeRelative));
  } else {
    write(
      path.join(base, nodeRelative),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(log)}\n`,
      0o755,
    );
  }
  write(
    path.join(base, 'cli/fake-cli.js'),
    process.platform === 'win32'
      ? `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(log)},process.argv.slice(2).join('\\n')+'\\n');`
      : 'fake cli\n',
  );
  let files: ComponentFile[] = [];
  for (const relative of [nodeRelative, 'cli/fake-cli.js']) {
    const file = path.join(base, relative),
      stat = fs.statSync(file);
    files.push({
      path: relative,
      bytes: stat.size,
      sha256: fileHash(file),
      mode: relative === nodeRelative ? 493 : 420,
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const checks = files.map((file) => `${file.sha256}  ${file.path}`).join('\n') + '\n';
  write(path.join(base, '.runtime-files.sha256'), checks);
  const integritySha = fileHash(path.join(base, '.runtime-files.sha256'));
  files = [
    {
      path: '.runtime-files.sha256',
      bytes: Buffer.byteLength(checks),
      sha256: integritySha,
      mode: 420 as const,
    },
    ...files,
  ].sort((a, b) => (a.path < b.path ? -1 : 1));
  const contents = Object.fromEntries(
    files.map((file) => [file.path, fs.readFileSync(path.join(base, file.path))]),
  );
  const archive = gzipSync(tarBytes(files, contents));
  const archiveFile = path.join(downloads, 'base.tar.gz');
  write(archiveFile, archive);
  const manifest = Buffer.from('{}\n'),
    manifestFile = path.join(downloads, 'manifest.json');
  write(manifestFile, manifest);
  const fakebin = path.join(root, 'fakebin');
  fs.mkdirSync(fakebin);
  const curlLog = path.join(root, 'curl.log');
  const curl = `#!/bin/sh\nout= url=\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then shift; out=$1; fi; url=$1; shift; done\nprintf '%s\\n' "$url" >> ${JSON.stringify(curlLog)}\ncase "$url" in *manifest.json) cp ${JSON.stringify(manifestFile)} "$out";; *base.tar.gz) cp ${JSON.stringify(archiveFile)} "$out";; *) exit 9;; esac\n`;
  write(path.join(fakebin, 'curl'), curl, 0o755);
  const uname = `#!/bin/sh\ncase "$1" in -s) printf '%s\\n' "\${FAKE_UNAME_S:-Linux}";; -m) printf '%s\\n' "\${FAKE_UNAME_M:-x86_64}";; *) printf '%s\\n' "\${FAKE_UNAME_S:-Linux}";; esac\n`;
  write(path.join(fakebin, 'uname'), uname, 0o755);
  write(
    path.join(fakebin, 'getconf'),
    '#!/bin/sh\nprintf "%s\\n" "${FAKE_LIBC:-glibc 2.39}"\n',
    0o755,
  );
  write(
    path.join(fakebin, 'sysctl'),
    '#!/bin/sh\ncase "$*" in *hw.optional.arm64*) printf "%s\\n" "${FAKE_ARM64:-0}";; *sysctl.proc_translated*) printf "%s\\n" "${FAKE_TRANSLATED:-0}";; esac\n',
    0o755,
  );
  const lock: Record<string, string | number> = {
    schema: 'tiangong-lca.runtime-bootstrap-lock.v1',
    bootstrap_protocol: 'tiangong-lca.runtime-bootstrap.v1',
    posix_script_sha256: fileHash(path.join(scripts, 'tiangong-runtime-bootstrap.sh')),
    powershell_script_sha256: fileHash(path.join(scripts, 'tiangong-runtime-bootstrap.ps1')),
    manifest_url:
      'https://github.com/tiangong-lca/runtime-fixture/releases/download/v1/manifest.json',
    manifest_bytes: manifest.length,
    manifest_sha256: hash(manifest),
    app_entry: 'foundry',
  };
  for (const platform of ['darwin_arm64', 'linux_x64', 'linux_arm64', 'win32_x64'])
    Object.assign(lock, {
      [`${platform}_component_key`]: hash(platform),
      [`${platform}_archive_url`]:
        'https://github.com/tiangong-lca/runtime-fixture/releases/download/v1/base.tar.gz',
      [`${platform}_archive_bytes`]: archive.length,
      [`${platform}_archive_sha256`]: hash(archive),
      [`${platform}_integrity_path`]: '.runtime-files.sha256',
      [`${platform}_integrity_sha256`]: integritySha,
      [`${platform}_file_count`]: 2,
      [`${platform}_node_path`]: nodeRelative,
      [`${platform}_cli_path`]: 'cli/fake-cli.js',
    });
  write(path.join(scripts, 'bootstrap-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  return {
    root,
    scripts,
    project,
    fakebin,
    log,
    curlLog,
    lock,
    base,
    archiveFile,
    manifestFile,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function run(
  f: ReturnType<typeof makeFixture>,
  extra: NodeJS.ProcessEnv = {},
  args = ['task', 'status', '--json'],
) {
  return spawnSync('/bin/sh', [path.join(f.scripts, 'tiangong-runtime-bootstrap.sh'), ...args], {
    cwd: f.project,
    encoding: 'utf8',
    env: {
      PATH: `${f.fakebin}:/usr/bin:/bin`,
      HOME: path.join(f.root, 'home'),
      XDG_CACHE_HOME: path.join(f.root, 'cache'),
      FAKE_UNAME_S: 'Linux',
      FAKE_UNAME_M: 'x86_64',
      FAKE_LIBC: 'glibc 2.39',
      TIANGONG_LCA_PASSWORD: 'must-not-forward',
      NODE_OPTIONS: 'must-not-forward',
      ...extra,
    },
    timeout: 30_000,
  });
}

test('POSIX bootstrap installs once without Node on PATH, reuses offline and forwards exact argv', () => {
  if (process.platform === 'win32') return;
  const f = makeFixture();
  try {
    const first = run(f);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, '');
    assert.deepEqual(fs.readFileSync(f.log, 'utf8').trim().split('\n').slice(-3), [
      'task',
      'status',
      '--json',
    ]);
    assert.equal(fs.readFileSync(f.curlLog, 'utf8').trim().split('\n').length, 2);
    fs.renameSync(path.join(f.fakebin, 'curl'), path.join(f.fakebin, 'curl.off'));
    const second = run(f);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(f.curlLog, 'utf8').trim().split('\n').length, 2);
    const cached = path.join(
      f.root,
      'cache',
      'tiangong-lca/runtimes/v1/components',
      hash('linux_x64'),
      'root',
      'cli/fake-cli.js',
    );
    fs.appendFileSync(cached, 'changed');
    const corrupt = run(f);
    assert.notEqual(corrupt.status, 0);
    assert.match(corrupt.stderr, /component_file_changed/u);
  } finally {
    f.close();
  }
});

test('POSIX bootstrap rejects script, lock, host, libc, cache and archive drift before execution', () => {
  if (process.platform === 'win32') return;
  const scenarios: Array<{
    change: (f: ReturnType<typeof makeFixture>) => NodeJS.ProcessEnv | void;
    pattern: RegExp;
  }> = [
    {
      change: (f) => {
        fs.appendFileSync(path.join(f.scripts, 'tiangong-runtime-bootstrap.sh'), '# changed\n');
      },
      pattern: /bootstrap_script_changed/u,
    },
    {
      change: (f) => {
        const lock = { ...f.lock, manifest_sha256: '0'.repeat(64) };
        write(path.join(f.scripts, 'bootstrap-lock.json'), JSON.stringify(lock, null, 2) + '\n');
      },
      pattern: /file_sha256_mismatch/u,
    },
    {
      change: () => ({ FAKE_UNAME_S: 'Darwin', FAKE_UNAME_M: 'x86_64', FAKE_ARM64: '0' }),
      pattern: /macos_intel_unsupported/u,
    },
    {
      change: () => ({ FAKE_UNAME_S: 'Linux', FAKE_UNAME_M: 'x86_64', FAKE_LIBC: 'musl 1.2' }),
      pattern: /linux_glibc_required/u,
    },
    { change: () => ({ FAKE_UNAME_S: 'FreeBSD' }), pattern: /unsupported_platform/u },
    {
      change: (f) => {
        const cache = path.join(f.root, 'cache', 'tiangong-lca/runtimes/v1');
        fs.mkdirSync(cache, { recursive: true });
        write(path.join(cache, 'user-data'), 'preserve');
      },
      pattern: /cache_not_owned/u,
    },
  ];
  for (const scenario of scenarios) {
    const f = makeFixture();
    try {
      const env = scenario.change(f) ?? {};
      const result = run(f, env);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.pattern);
      assert.equal(fs.existsSync(f.log), false);
    } finally {
      f.close();
    }
  }
});

test('POSIX bootstrap admits Rosetta only with Apple Silicon proof and serializes concurrent cold starts', async () => {
  if (process.platform === 'win32') return;
  const ros = makeFixture();
  try {
    const result = run(ros, {
      FAKE_UNAME_S: 'Darwin',
      FAKE_UNAME_M: 'x86_64',
      FAKE_ARM64: '1',
      FAKE_TRANSLATED: '1',
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    ros.close();
  }
  const f = makeFixture();
  try {
    const env = {
      PATH: `${f.fakebin}:/usr/bin:/bin`,
      HOME: path.join(f.root, 'home'),
      XDG_CACHE_HOME: path.join(f.root, 'cache'),
      FAKE_UNAME_S: 'Linux',
      FAKE_UNAME_M: 'x86_64',
      FAKE_LIBC: 'glibc 2.39',
    };
    const one = (label: string) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(
          '/bin/sh',
          [path.join(f.scripts, 'tiangong-runtime-bootstrap.sh'), label],
          { cwd: f.project, env },
        );
        let stderr = '';
        child.stderr.setEncoding('utf8').on('data', (value) => (stderr += value));
        child.on('close', (code) => resolve({ code, stderr }));
      });
    const results = await Promise.all([one('one'), one('two')]);
    assert.ok(
      results.every((result) => result.code === 0),
      JSON.stringify(results),
    );
    assert.equal(fs.readFileSync(f.curlLog, 'utf8').trim().split('\n').length, 2);
  } finally {
    f.close();
  }
});

test('Windows bootstrap runs through the cached native Node with no execution-policy bypass', () => {
  if (process.platform !== 'win32') {
    assert.match(fs.readFileSync(sourcePs, 'utf8'), /OSArchitecture-ne/);
    return;
  }
  const f = makeFixture();
  try {
    const local = path.join(f.root, 'local'),
      cache = path.join(local, 'tiangong-lca', 'runtimes', 'v1');
    fs.mkdirSync(cache, { recursive: true });
    write(path.join(cache, '.runtime-cache.json'), '{"schema":"tiangong-lca.runtime-cache.v1"}\n');
    const manifest = fs.readFileSync(f.manifestFile),
      manifestSha = hash(manifest);
    fs.mkdirSync(path.join(cache, 'manifests'));
    write(path.join(cache, 'manifests', manifestSha + '.json'), manifest);
    const key = hash('win32_x64'),
      root = path.join(cache, 'components', key, 'root');
    fs.cpSync(f.base, root, { recursive: true });
    const shell = path.join(
      process.env.SystemRoot!,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const result = spawnSync(
      shell,
      [
        '-NoProfile',
        '-File',
        path.join(f.scripts, 'tiangong-runtime-bootstrap.ps1'),
        'task',
        'status',
        '--json',
      ],
      {
        cwd: f.project,
        encoding: 'utf8',
        env: {
          SystemRoot: process.env.SystemRoot,
          USERPROFILE: path.join(f.root, 'home'),
          LOCALAPPDATA: local,
          PATH: path.join(process.env.SystemRoot!, 'System32'),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(f.log, 'utf8').trim().split(/\r?\n/u).slice(-3), [
      'task',
      'status',
      '--json',
    ]);
  } finally {
    f.close();
  }
});

test('bootstrap sources are dependency-free trust adapters with a machine lock schema', () => {
  const sh = fs.readFileSync(sourceSh, 'utf8'),
    ps = fs.readFileSync(sourcePs, 'utf8');
  assert.doesNotMatch(
    sh,
    /\beval\b|\bsource\b|curl[^\n]*(?:-k|--insecure)|BOOTSTRAP_TEST_PATH|TIANGONG_LCA_(?:USERNAME|PASSWORD|API_KEY)|NODE_OPTIONS/u,
  );
  assert.doesNotMatch(
    ps,
    /Invoke-Expression|ExecutionPolicy|TIANGONG_LCA_(?:USERNAME|PASSWORD|API_KEY)|NODE_OPTIONS/u,
  );
  assert.match(sh, /env -i/u);
  assert.match(ps, /EnvironmentVariables\.Clear/u);
  assert.match(ps, /OSArchitecture-ne\[Runtime\.InteropServices\.Architecture\]::X64/u);
  const schema = JSON.parse(
    fs.readFileSync(path.join(repo, 'assets/runtime/runtime-bootstrap-lock.schema.json'), 'utf8'),
  ) as { required: string[] };
  assert.equal(schema.required.length, 44);
});

test('POSIX bootstrap admits Linux arm64 and recovers a same-host dead bootstrap lock', () => {
  if (process.platform === 'win32') return;
  const arm = makeFixture();
  try {
    const result = run(arm, {
      FAKE_UNAME_S: 'Linux',
      FAKE_UNAME_M: 'aarch64',
      FAKE_LIBC: 'glibc 2.39',
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    arm.close();
  }
  const stale = makeFixture();
  try {
    const cache = path.join(stale.root, 'cache', 'tiangong-lca/runtimes/v1');
    fs.mkdirSync(path.join(cache, '.bootstrap.lock'), { recursive: true });
    write(path.join(cache, '.runtime-cache.json'), '{"schema":"tiangong-lca.runtime-cache.v1"}\n');
    write(path.join(cache, '.bootstrap.lock', 'pid'), '99999999\n');
    write(path.join(cache, '.bootstrap.lock', 'host'), os.hostname() + '\n');
    const result = run(stale);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    stale.close();
  }
});

test('POSIX bootstrap rejects a traversal archive before extracting outside its stage', () => {
  if (process.platform === 'win32') return;
  const f = makeFixture();
  try {
    const nodeBytes = fs.readFileSync(path.join(f.base, 'bin/node'));
    const integrity = {
      path: '.runtime-files.sha256',
      bytes: fs.statSync(path.join(f.base, '.runtime-files.sha256')).size,
      sha256: fileHash(path.join(f.base, '.runtime-files.sha256')),
      mode: 420 as const,
    };
    const bad = {
      path: '../outside',
      bytes: nodeBytes.length,
      sha256: hash(nodeBytes),
      mode: 493 as const,
    };
    const cliBytes = fs.readFileSync(path.join(f.base, 'cli/fake-cli.js')),
      cli = {
        path: 'cli/fake-cli.js',
        bytes: cliBytes.length,
        sha256: hash(cliBytes),
        mode: 420 as const,
      };
    const values = [integrity, bad, cli].sort((a, b) => (a.path < b.path ? -1 : 1)),
      contents = {
        [integrity.path]: fs.readFileSync(path.join(f.base, integrity.path)),
        [bad.path]: nodeBytes,
        [cli.path]: cliBytes,
      };
    const archive = gzipSync(tarBytes(values, contents));
    write(f.archiveFile, archive);
    const lock = { ...f.lock };
    for (const platform of ['darwin_arm64', 'linux_x64', 'linux_arm64', 'win32_x64']) {
      lock[`${platform}_archive_bytes`] = archive.length;
      lock[`${platform}_archive_sha256`] = hash(archive);
    }
    write(path.join(f.scripts, 'bootstrap-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe_relative_path|archive_inventory/u);
    assert.equal(fs.existsSync(path.join(f.root, 'outside')), false);
  } finally {
    f.close();
  }
});

test('CLI bootstrap source copies remain byte-identical and use pinned system tool paths', () => {
  assert.match(fs.readFileSync(sourceSh, 'utf8'), /PATH=\/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-copy-'));
  try {
    const copy = path.join(root, 'bootstrap.sh');
    fs.copyFileSync(sourceSh, copy);
    assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(sourceSh));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
