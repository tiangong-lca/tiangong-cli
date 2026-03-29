import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadDistModule<T>(relativePath: string): Promise<T> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), 'dist', relativePath)).href;
  return (await import(moduleUrl)) as T;
}
