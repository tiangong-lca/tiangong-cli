import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const MANIFEST_PATH = 'contracts/supabase-consumer-manifest.v3.json';
export const SCHEMA_PATH = 'contracts/supabase-consumer-manifest.v3.schema.json';
export const AUDIT_TOOL_PATH = 'scripts/scan-data-api-consumers.ts';
export const REPOSITORY = 'tiangong-lca/tiangong-cli';
export const MANIFEST_SCHEMA = 'tiangong.supabase-consumer-manifest.v3';

type GitEntry = { mode: string; path: string; oid: string };
type Span = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  sha256: string;
};

export type ConsumerOccurrence = {
  id: string;
  file: string;
  line: number;
  span: Span;
  operation: string;
  transport: 'postgrest' | 'auth' | 'edge-function' | 'storage' | 'realtime' | 'postgres';
  credential: 'authenticated-user-session' | 'publishable-key' | 'unknown';
  schema: string;
  object: string;
  signature: string;
  acl: string;
  semantics: string;
  upstream: string[];
  sourceClass: 'typescript-ast' | 'javascript-ast';
};

export type ConsumerManifest = {
  schema: typeof MANIFEST_SCHEMA;
  version: 3;
  repository: typeof REPOSITORY;
  baseCommit: string;
  headCommit: string;
  authority: {
    status: 'candidate';
    authorizesDatabaseFreeze: false;
    authorizesHostedMutation: false;
  };
  source: {
    derivation: 'typescript-compiler-ast-v1';
    governedPatterns: string[];
    exactExemptions: string[];
    treeDigestAlgorithm: 'sha256(mode\\0path\\0blobOid\\0)';
    treeDigest: string;
    fileCount: number;
  };
  occurrences: ConsumerOccurrence[];
  publicResidue: { relations: string[]; rpcs: string[]; views: string[] };
  pending: Array<{ capability: string; reason: string; upstream: string[] }>;
  absenceProofs: Array<{ surface: string; result: 'absent'; evidence: string }>;
};

export function assertExactOccurrenceSet(
  declared: ConsumerOccurrence[],
  derived: ConsumerOccurrence[],
): void {
  const declaredIds = new Set(declared.map((item) => item.id));
  const derivedIds = new Set(derived.map((item) => item.id));
  if (declaredIds.size !== declared.length)
    throw new Error('manifest has duplicate occurrence IDs');
  if (derivedIds.size !== derived.length)
    throw new Error('derivation has duplicate occurrence IDs');
  const declaredRows = new Set(declared.map((item) => JSON.stringify(item)));
  const derivedRows = new Set(derived.map((item) => JSON.stringify(item)));
  if (
    declaredRows.size !== declared.length ||
    derivedRows.size !== derived.length ||
    [...declaredRows].some((row) => !derivedRows.has(row)) ||
    [...derivedRows].some((row) => !declaredRows.has(row))
  ) {
    throw new Error('manifest occurrence set is not bidirectionally exact');
  }
}

const GOVERNED_PATTERNS = ['src/**/*.ts', 'scripts/**/*.ts', 'bin/**/*.js'];
const SUPABASE_ROUTE = /\/(?:rest|auth|functions|storage)\/v1/u;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(root: string, args: string[]): Buffer {
  const result = spawnSync('git', args, { cwd: root, encoding: 'buffer' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout;
}

function fullCommit(root: string, revision: string): string {
  const commit = git(root, ['rev-parse', '--verify', `${revision}^{commit}`])
    .toString('utf8')
    .trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`invalid commit: ${revision}`);
  return commit;
}

function canonicalOrigin(root: string): string {
  const remote = git(root, ['remote', 'get-url', 'origin']).toString('utf8').trim();
  const match = remote.match(
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/u,
  );
  if (!match || match[1]?.toLowerCase() !== REPOSITORY) {
    throw new Error(`origin must be canonical GitHub repository ${REPOSITORY}; got ${remote}`);
  }
  return REPOSITORY;
}

function governed(pathname: string): boolean {
  if (pathname === AUDIT_TOOL_PATH) return false;
  return (
    (pathname.startsWith('src/') && pathname.endsWith('.ts')) ||
    (pathname.startsWith('scripts/') && pathname.endsWith('.ts')) ||
    (pathname.startsWith('bin/') && pathname.endsWith('.js'))
  );
}

function treeEntries(root: string, commit: string): GitEntry[] {
  const fields = git(root, [
    'ls-tree',
    '-r',
    '-z',
    '--format=%(objectmode)%x00%(objectname)%x00%(path)',
    commit,
  ])
    .toString('utf8')
    .split('\0');
  const result: GitEntry[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [mode, oid, pathname] = fields.slice(index, index + 3);
    if (!mode || !oid || !pathname || !governed(pathname)) continue;
    if (mode !== '100644' && mode !== '100755') {
      throw new Error(`governed path is not a regular blob: ${pathname} (${mode})`);
    }
    result.push({ mode, oid, path: pathname });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function treeDigest(entries: GitEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) hash.update(`${entry.mode}\0${entry.path}\0${entry.oid}\0`);
  return hash.digest('hex');
}

function blob(root: string, commit: string, pathname: string): string {
  return git(root, ['show', `${commit}:${pathname}`]).toString('utf8');
}

function literal(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function propertyName(node: ts.CallExpression): string | undefined {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    return literal(expression.argumentExpression);
  }
  return undefined;
}

function receiverText(node: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const expression = node.expression;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expression.expression.getText(sourceFile);
  }
  return '';
}

function annotationValues(source: string, label: string): string[] {
  const pattern = new RegExp(`^\\s*//\\s*${label}:\\s*(.+?)\\s*$`, 'gmu');
  return [...source.matchAll(pattern)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function makeOccurrence(options: {
  file: string;
  sourceFile: ts.SourceFile;
  node: ts.Node;
  operation: string;
  transport: ConsumerOccurrence['transport'];
  credential: ConsumerOccurrence['credential'];
  schema: string;
  object: string;
  signature: string;
  acl: string;
  semantics: string;
  upstream?: string[];
}): ConsumerOccurrence {
  const start = options.node.getStart(options.sourceFile);
  const end = options.node.getEnd();
  const startPosition = options.sourceFile.getLineAndCharacterOfPosition(start);
  const endPosition = options.sourceFile.getLineAndCharacterOfPosition(end);
  const text = options.sourceFile.text.slice(start, end);
  const seed = `${options.file}\0${start}\0${end}\0${options.operation}\0${options.object}`;
  return {
    id: `cli-${sha256(seed).slice(0, 24)}`,
    file: options.file,
    line: startPosition.line + 1,
    span: {
      startOffset: start,
      endOffset: end,
      startLine: startPosition.line + 1,
      startColumn: startPosition.character + 1,
      endLine: endPosition.line + 1,
      endColumn: endPosition.character + 1,
      sha256: sha256(text),
    },
    operation: options.operation,
    transport: options.transport,
    credential: options.credential,
    schema: options.schema,
    object: options.object,
    signature: options.signature,
    acl: options.acl,
    semantics: options.semantics,
    upstream: options.upstream ?? [],
    sourceClass: options.file.endsWith('.js') ? 'javascript-ast' : 'typescript-ast',
  };
}

function callSemantics(node: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const text = node.parent.getText(sourceFile).slice(0, 300);
  if (/\.(?:insert|upsert|update|delete|upload|remove)\s*\(/u.test(text))
    return 'mutation-no-automatic-replay';
  if (/\.(?:select|download|createSignedUrl)\s*\(/u.test(text))
    return 'read-auth-refresh-once-401-403';
  return 'capability-specific';
}

export function deriveOccurrences(file: string, source: string): ConsumerOccurrence[] {
  const kind = file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const occurrences: ConsumerOccurrence[] = [];
  const declaredRelations = annotationValues(source, 'data-api-relations');
  const dynamicExpressions = new Set(
    annotationValues(source, 'data-api-dynamic-relation-expression'),
  );

  const addCall = (
    node: ts.CallExpression,
    operation: string,
    transport: ConsumerOccurrence['transport'],
    object: string,
    schema: string,
    credential: ConsumerOccurrence['credential'] = 'authenticated-user-session',
    upstream: string[] = [],
  ): void => {
    occurrences.push(
      makeOccurrence({
        file,
        sourceFile,
        node,
        operation,
        transport,
        credential,
        schema,
        object,
        signature: node.getText(sourceFile),
        acl:
          credential === 'authenticated-user-session'
            ? 'authenticated-only; anon-deny; service-role-deny'
            : 'publishable-key bootstrap; no service-role',
        semantics: callSemantics(node, sourceFile),
        upstream,
      }),
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && /^postgres(?:ql)?:\/\//iu.test(node.text)) {
      throw new Error(
        `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: forbidden or unresolved direct PostgreSQL connection`,
      );
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['Pool', 'Client'].includes(node.expression.text)
    ) {
      throw new Error(
        `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: forbidden or unresolved direct PostgreSQL client`,
      );
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ['pgmq', 'pg_cron'].includes(node.expression.getText(sourceFile))
    ) {
      throw new Error(
        `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: forbidden or unresolved PGMQ/Cron surface`,
      );
    }
    if (
      ts.isBindingElement(node) &&
      ['from', 'rpc', 'schema', 'auth', 'storage', 'functions'].includes(
        (node.propertyName ?? node.name).getText(sourceFile).replace(/["']/gu, ''),
      ) &&
      ts.isObjectBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      /(?:supabase|client)/iu.test(node.parent.parent.initializer?.getText(sourceFile) ?? '')
    ) {
      throw new Error(
        `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: destructured Supabase consumer alias is forbidden because it bypasses exact receiver classification`,
      );
    }
    if (ts.isCallExpression(node)) {
      const name = propertyName(node);
      const receiver = receiverText(node, sourceFile);
      if (name === 'from' && !/^(?:Array|Buffer|Object|Uint8Array)$/u.test(receiver)) {
        const argument = node.arguments[0];
        const value = argument ? literal(argument) : undefined;
        if (/\.storage$/u.test(receiver)) {
          addCall(
            node,
            'storage.bucket',
            'storage',
            value ?? argument?.getText(sourceFile) ?? '<missing>',
            'storage',
          );
        } else if (value) {
          addCall(node, 'postgrest.relation', 'postgrest', value, 'public');
        } else if (argument && dynamicExpressions.has(argument.getText(sourceFile))) {
          for (const relation of declaredRelations)
            addCall(node, 'postgrest.relation', 'postgrest', relation, 'public');
        } else {
          throw new Error(
            `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: unresolved dynamic .from() target`,
          );
        }
      }
      if (name === 'rpc') {
        const argument = node.arguments[0];
        const value = argument ? literal(argument) : undefined;
        if (!value) throw new Error(`${file}:${node.getStart()}: unresolved dynamic .rpc() target`);
        addCall(node, 'postgrest.rpc', 'postgrest', value, 'profile-selected');
      }
      if (name === 'schema') {
        const argument = node.arguments[0];
        const value = argument ? literal(argument) : undefined;
        if (!value)
          throw new Error(`${file}:${node.getStart()}: unresolved dynamic .schema() target`);
        addCall(node, 'postgrest.schema', 'postgrest', value, value);
      }
      if (name === 'resolveDataApiCapability') {
        const argument = node.arguments[0];
        if (argument && ts.isObjectLiteralExpression(argument)) {
          const kindProperty = argument.properties.find(
            (item): item is ts.PropertyAssignment =>
              ts.isPropertyAssignment(item) &&
              item.name.getText(sourceFile).replace(/["']/gu, '') === 'kind',
          );
          const nameProperty = argument.properties.find(
            (item): item is ts.PropertyAssignment =>
              ts.isPropertyAssignment(item) &&
              item.name.getText(sourceFile).replace(/["']/gu, '') === 'name',
          );
          const capabilityKind = kindProperty ? literal(kindProperty.initializer) : undefined;
          const capabilityName = nameProperty ? literal(nameProperty.initializer) : undefined;
          if (capabilityKind === 'relation') {
            if (capabilityName)
              addCall(node, 'postgrest.relation', 'postgrest', capabilityName, 'public');
            else
              for (const relation of declaredRelations)
                addCall(node, 'postgrest.relation', 'postgrest', relation, 'public');
          }
        }
      }
      if (name === 'signInWithPassword' || name === 'refreshSession') {
        addCall(node, `auth.${name}`, 'auth', name, 'auth', 'publishable-key');
      }
      if (name === 'createClient') {
        addCall(node, 'client.create', 'auth', 'supabase-project', 'client', 'publishable-key');
      }
      if (name === 'channel')
        addCall(node, 'realtime.channel', 'realtime', '<dynamic-channel>', 'realtime');
      if (
        ['upload', 'download', 'createSignedUrl', 'createSignedUrls', 'remove'].includes(
          name ?? '',
        ) &&
        /storage|bucket/u.test(receiver)
      ) {
        addCall(node, `storage.${name}`, 'storage', '<dynamic-object>', 'storage');
      }
      if (name === 'invoke' && /functions/u.test(receiver)) {
        const argument = node.arguments[0];
        const value = argument ? literal(argument) : undefined;
        if (!value)
          throw new Error(`${file}:${node.getStart()}: unresolved dynamic Edge Function name`);
        addCall(node, 'edge-function.invoke', 'edge-function', value, 'functions');
      }
      if (name === 'on' && node.arguments[0] && literal(node.arguments[0]) === 'postgres_changes') {
        addCall(node, 'realtime.postgres_changes', 'realtime', 'postgres_changes', 'realtime');
      }
      if (
        ['spawn', 'spawnSync', 'exec', 'execFile', 'execFileSync'].includes(name ?? '') &&
        /(?:supabase|\/rest\/v1|\/auth\/v1|\/functions\/v1|\/storage\/v1)/iu.test(
          node.getText(sourceFile),
        )
      ) {
        throw new Error(
          `${file}:${node.getStart()}: unresolved subprocess Supabase transport bypass`,
        );
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile).replace(/["']/gu, '') === 'rpc'
    ) {
      const value = literal(node.initializer);
      if (value) {
        occurrences.push(
          makeOccurrence({
            file,
            sourceFile,
            node,
            operation: 'postgrest.rpc',
            transport: 'postgrest',
            credential: 'authenticated-user-session',
            schema: 'profile-selected',
            object: value,
            signature: node.getText(sourceFile),
            acl: 'authenticated-only; anon-deny; service-role-deny',
            semantics: 'capability-specific',
            upstream: ['tiangong-lca/database-engine#357'],
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const routeNodes: ts.Node[] = [];
  const findRoutes = (node: ts.Node): void => {
    const routeText = ts.isStringLiteralLike(node) ? node.text : node.getText(sourceFile);
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
      SUPABASE_ROUTE.test(routeText)
    )
      routeNodes.push(node);
    ts.forEachChild(node, findRoutes);
  };
  findRoutes(sourceFile);
  for (const node of routeNodes) {
    const text = node.getText(sourceFile);
    const transport: ConsumerOccurrence['transport'] = text.includes('/auth/v1')
      ? 'auth'
      : text.includes('/functions/v1')
        ? 'edge-function'
        : text.includes('/storage/v1')
          ? 'storage'
          : 'postgrest';
    occurrences.push(
      makeOccurrence({
        file,
        sourceFile,
        node,
        operation: `${transport}.route`,
        transport,
        credential: 'authenticated-user-session',
        schema: transport === 'postgrest' ? 'profile-selected' : transport,
        object: text,
        signature: text,
        acl: 'authenticated user token plus publishable key; no service-role',
        semantics: transport === 'auth' ? 'session-validation' : 'route-construction',
        upstream:
          transport === 'edge-function' ? ['Edge Function lifecycle joint verification'] : [],
      }),
    );
  }

  return occurrences.sort((left, right) =>
    `${left.file}\0${String(left.span.startOffset).padStart(12, '0')}\0${left.object}`.localeCompare(
      `${right.file}\0${String(right.span.startOffset).padStart(12, '0')}\0${right.object}`,
    ),
  );
}

export function deriveManifest(root: string, revision: string): ConsumerManifest {
  canonicalOrigin(root);
  const sourceCommit = fullCommit(root, revision);
  const entries = treeEntries(root, sourceCommit);
  const occurrences = entries.flatMap((entry) =>
    deriveOccurrences(entry.path, blob(root, sourceCommit, entry.path)),
  );
  const ids = new Set(occurrences.map((item) => item.id));
  if (ids.size !== occurrences.length)
    throw new Error('derived occurrence IDs are not globally unique');
  const relations = occurrences
    .filter((item) => item.operation === 'postgrest.relation')
    .map((item) => item.object)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  const rpcs = occurrences
    .filter((item) => item.operation === 'postgrest.rpc')
    .map((item) => item.object)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  return {
    schema: MANIFEST_SCHEMA,
    version: 3,
    repository: REPOSITORY,
    baseCommit: sourceCommit,
    headCommit: sourceCommit,
    authority: {
      status: 'candidate',
      authorizesDatabaseFreeze: false,
      authorizesHostedMutation: false,
    },
    source: {
      derivation: 'typescript-compiler-ast-v1',
      governedPatterns: GOVERNED_PATTERNS,
      exactExemptions: [AUDIT_TOOL_PATH],
      treeDigestAlgorithm: 'sha256(mode\\0path\\0blobOid\\0)',
      treeDigest: treeDigest(entries),
      fileCount: entries.length,
    },
    occurrences,
    publicResidue: { relations, rpcs, views: [] },
    pending: [
      {
        capability: 'rpc:cmd_dataset_alias_plan_guarded',
        reason:
          'Pinned database inventory moves the current signature to private; authenticated api replacement is not frozen.',
        upstream: ['tiangong-lca/database-engine#357', 'tiangong-lca/database-engine#358'],
      },
    ],
    absenceProofs: [
      {
        surface: 'direct-postgres-sql',
        result: 'absent',
        evidence: 'AST statement scan over every governed Git blob',
      },
      {
        surface: 'pgmq-cron',
        result: 'absent',
        evidence: 'AST statement scan over every governed Git blob',
      },
      { surface: 'realtime', result: 'absent', evidence: 'zero derived realtime occurrences' },
      {
        surface: 'service-role-credential',
        result: 'absent',
        evidence: 'credential policy and governed AST scan',
      },
      { surface: 'views', result: 'absent', evidence: 'zero derived view occurrences' },
    ],
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertManifestShape(value: unknown): asserts value is ConsumerManifest {
  if (!value || typeof value !== 'object') throw new Error('manifest must be an object');
  const manifest = value as Partial<ConsumerManifest>;
  if (
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.version !== 3 ||
    manifest.repository !== REPOSITORY
  ) {
    throw new Error('manifest schema/version/repository mismatch');
  }
  if (
    manifest.authority?.status !== 'candidate' ||
    manifest.authority.authorizesDatabaseFreeze !== false ||
    manifest.authority.authorizesHostedMutation !== false
  ) {
    throw new Error('consumer manifest is permanently candidate and non-authorizing');
  }
  if (!Array.isArray(manifest.occurrences))
    throw new Error('manifest occurrences must be an array');
}

export function verifyManifest(root: string): {
  sourceTreeCommit: string;
  deliveryHead: string;
  occurrenceCount: number;
  sourceTreeDigest: string;
  manifestSha256: string;
  schemaSha256: string;
} {
  canonicalOrigin(root);
  const raw = readFileSync(path.join(root, MANIFEST_PATH), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  assertManifestShape(parsed);
  if (raw !== canonicalJson(parsed))
    throw new Error('manifest bytes are not canonical pretty JSON plus LF');
  const schemaRaw = readFileSync(path.join(root, SCHEMA_PATH), 'utf8');
  const schema: unknown = JSON.parse(schemaRaw);
  if (schemaRaw !== canonicalJson(schema))
    throw new Error('schema bytes are not canonical pretty JSON plus LF');
  if (
    !schema ||
    typeof schema !== 'object' ||
    (schema as { properties?: { schema?: { const?: unknown } } }).properties?.schema?.const !==
      MANIFEST_SCHEMA
  ) {
    throw new Error('canonical JSON Schema does not bind the v3 manifest identifier');
  }
  const expected = deriveManifest(root, parsed.baseCommit);
  assertExactOccurrenceSet(parsed.occurrences, expected.occurrences);
  if (canonicalJson(parsed) !== canonicalJson(expected))
    throw new Error('manifest is not the exact bidirectional AST-derived occurrence set');
  const deliveryHead = fullCommit(root, 'HEAD');
  const ancestor = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', parsed.baseCommit, deliveryHead],
    { cwd: root },
  );
  if (ancestor.status !== 0)
    throw new Error('sourceTreeCommit is not an ancestor of delivery HEAD');
  const deliveryEntries = treeEntries(root, deliveryHead);
  if (treeDigest(deliveryEntries) !== parsed.source.treeDigest) {
    throw new Error('governed source drifted between sourceTreeCommit and delivery HEAD');
  }
  for (const [pathname, worktreeBytes] of [
    [MANIFEST_PATH, raw],
    [SCHEMA_PATH, schemaRaw],
  ] as const) {
    const entry = git(root, ['ls-tree', deliveryHead, '--', pathname]).toString('utf8').trim();
    if (deliveryHead !== parsed.baseCommit && !entry)
      throw new Error(`${pathname} is missing from delivery HEAD`);
    if (entry && !/^100(?:644|755) blob /u.test(entry))
      throw new Error(`${pathname} is not a regular Git blob`);
    if (entry && blob(root, deliveryHead, pathname) !== worktreeBytes)
      throw new Error(`${pathname} worktree bytes differ from delivery HEAD`);
  }
  return {
    sourceTreeCommit: parsed.baseCommit,
    deliveryHead,
    occurrenceCount: parsed.occurrences.length,
    sourceTreeDigest: parsed.source.treeDigest,
    manifestSha256: sha256(raw),
    schemaSha256: sha256(schemaRaw),
  };
}

function main(): void {
  const root = process.cwd();
  const generateIndex = process.argv.indexOf('--generate');
  if (generateIndex >= 0) {
    const revision = process.argv[generateIndex + 1] ?? 'HEAD';
    const manifest = deriveManifest(root, revision);
    writeFileSync(path.join(root, MANIFEST_PATH), canonicalJson(manifest), 'utf8');
    const schema: unknown = JSON.parse(readFileSync(path.join(root, SCHEMA_PATH), 'utf8'));
    writeFileSync(path.join(root, SCHEMA_PATH), canonicalJson(schema), 'utf8');
    process.stdout.write(
      `${JSON.stringify({ generated: MANIFEST_PATH, sourceTreeCommit: manifest.baseCommit, occurrences: manifest.occurrences.length, sourceTreeDigest: manifest.source.treeDigest })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(verifyManifest(root), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
