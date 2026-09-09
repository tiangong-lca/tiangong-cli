const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');

const branches = [
  ['lint', 'peers:check'],
  ['test:package', 'test:coverage', 'test:coverage:assert-full'],
];

async function runParallelGate(scripts, run) {
  assert.equal(
    scripts['prepush:gate'],
    branches
      .flat()
      .map((name) => `pnpm ${name}`)
      .join(' && '),
    'Parallel gate must be re-reviewed when the canonical gate changes.',
  );
  const results = await Promise.all(
    branches.map(async (commands) => {
      for (const name of commands) {
        let status;
        try {
          status = await run(name);
        } catch {
          return 1;
        }
        if (status !== 0) return 1;
      }
      return 0;
    }),
  );
  return results.find((status) => status !== 0) ?? 0;
}

function run(name) {
  console.log(`[parallel gate] pnpm run ${name}`);
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['run', name], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.once('close', (status) => resolve(status ?? 1));
  });
}

if (require.main === module) {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  runParallelGate(scripts, run).then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}

module.exports = { runParallelGate };
