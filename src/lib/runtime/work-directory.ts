import fs from 'node:fs';
import path from 'node:path';
import { runtimeError } from './files.js';

export function runtimeWorkDirectory(value: string): string {
  if (!path.isAbsolute(value) || !fs.statSync(value).isDirectory())
    runtimeError(
      'RUNTIME_LAUNCH_CWD',
      'Runtime launch requires an explicit existing work directory.',
    );
  return fs.realpathSync(value);
}

export function assertRuntimeWorkDirectoryOutsideInstall(cwd: string, cache: string): void {
  const relative = path.relative(cache, cwd);
  if (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) ||
    /\/(?:\.agents|\.codex)\/skills(?:\/|$)/u.test(cwd.split(path.sep).join('/'))
  )
    runtimeError(
      'RUNTIME_LAUNCH_CWD',
      'A runtime cache or installed skill cannot be used as the work directory.',
    );
}
