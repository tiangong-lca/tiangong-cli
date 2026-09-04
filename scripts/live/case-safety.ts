import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse } from 'node:path';
import { parseEnv } from 'node:util';

export const LOGIN_ORIGIN = 'https://lca.tiangong.earth';

export function loadPrivateCredentials(file: string): { username: string; password: string } {
  if (!isAbsolute(file)) throw new Error('LIVE_CREDENTIAL_FILE_UNSAFE');
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  ) {
    throw new Error('LIVE_CREDENTIAL_FILE_UNSAFE');
  }
  const bytes = readFileSync(file, 'utf8');
  const keys = ['TIANGONG_LCA_USERNAME', 'TIANGONG_LCA_PASSWORD'];
  const values = parseEnv(bytes);
  for (const key of keys) {
    const occurrences = bytes.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, 'gm')) ?? [];
    if (occurrences.length !== 1 || !values[key]?.trim())
      throw new Error('LIVE_CREDENTIAL_KEYS_INVALID');
  }
  return {
    username: (values.TIANGONG_LCA_USERNAME as string).trim(),
    password: values.TIANGONG_LCA_PASSWORD as string,
  };
}

export function assertLoginOrigin(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('LIVE_LOGIN_ORIGIN_REJECTED');
  }
  if (url.origin !== LOGIN_ORIGIN || url.username || url.password)
    throw new Error('LIVE_LOGIN_ORIGIN_REJECTED');
}

export function createPrivateCase(directory: string): {
  directory: string;
  caseId: string;
  contextFile: string;
  sessionFile: string;
} {
  if (!isAbsolute(directory) || existsSync(directory)) throw new Error('LIVE_CASE_PATH_UNSAFE');
  let parent = realpathSync(dirname(directory));
  const root = parse(parent).root;
  for (;;) {
    if (existsSync(join(parent, '.git'))) throw new Error('LIVE_CASE_IN_CHECKOUT');
    if (parent === root) break;
    parent = dirname(parent);
  }
  mkdirSync(directory, { mode: 0o700 });
  const caseId = `rc01-${randomUUID()}`;
  const contextFile = join(directory, 'context.json');
  const sessionFile = join(directory, 'session.json');
  writeFileSync(
    contextFile,
    JSON.stringify(
      { schema: 'tiangong.cli-live-case.v1', caseId, remoteWriteMode: 'read-only', sessionFile },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return { directory, caseId, contextFile, sessionFile };
}

export type CaseStage =
  'inputs' | 'browser-login' | 'source-identity' | 'installed-identity' | 'complete';

export function safeCaseReport(input: {
  caseId: string;
  stage: CaseStage;
  status: 'passed' | 'failed';
}) {
  return {
    schema: 'tiangong.cli-live-result.v1',
    caseId: input.caseId,
    stage: input.stage,
    status: input.status,
  };
}
