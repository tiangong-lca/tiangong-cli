import { spawn } from 'node:child_process';
import type {
  FoundryCommandSpecAsyncSpawnOptions,
  FoundryCommandSpecSpawnResult,
} from '../../command-spec.js';

/** Resolve only after close, including cancellation and output overflow, so callers retain component leases. */
export function spawnRuntimeProcess(
  executable: string,
  argv: readonly string[],
  options: FoundryCommandSpecAsyncSpawnOptions,
): Promise<FoundryCommandSpecSpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...argv], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0;
    let error: Error | undefined;
    let force: NodeJS.Timeout | undefined;
    const stop = () => {
      child.kill('SIGTERM');
      force ??= setTimeout(() => child.kill('SIGKILL'), 3000);
    };
    const abort = () => {
      error = new Error('Runtime execution was interrupted.');
      stop();
    };
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    const capture = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBuffer ?? 16 * 1024 * 1024)) {
        error = new Error('Runtime output exceeded its bound.');
        stop();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.once('error', (value) => {
      error = value;
    });
    child.once('close', (status, signal) => {
      if (force) clearTimeout(force);
      options.signal.removeEventListener('abort', abort);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        status,
        signal,
        ...(error ? { error } : {}),
      });
    });
  });
}
