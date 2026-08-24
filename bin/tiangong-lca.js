#!/usr/bin/env node

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryPath = path.join(rootDir, 'dist', 'src', 'main.js');

export function resolveInvokedUrl(argv1 = process.argv[1]) {
  if (!argv1) {
    return null;
  }

  const resolvedPath = path.resolve(argv1);
  try {
    return pathToFileURL(realpathSync(resolvedPath)).href;
  } catch {
    return pathToFileURL(resolvedPath).href;
  }
}

export async function runFromBin(argv = process.argv.slice(2), env = process.env) {
  if (!existsSync(entryPath)) {
    throw new Error(
      "Missing built CLI artifacts at 'dist/src/main.js'. Run 'pnpm build' or reinstall dependencies to regenerate dist.",
    );
  }

  const entryUrl = pathToFileURL(entryPath).href;
  const { main } = await import(entryUrl);
  return main(argv, env);
}

const invokedUrl = resolveInvokedUrl(process.argv[1]);

if (invokedUrl && import.meta.url === invokedUrl) {
  try {
    process.exitCode = await runFromBin();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
