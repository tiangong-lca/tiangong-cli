import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test(
  'PowerShell bootstrap handles real HTTP and native nullable Content-Length',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const url = 'https://nodejs.org/dist/v24.19.0/SHASUMS256.txt';
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    const expected = Buffer.from(await response.arrayBuffer());
    assert.ok(expected.length > 0 && expected.length < 64 * 1024);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bootstrap-http-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const original = path.resolve('scripts/bootstrap/tiangong-runtime-bootstrap.ps1');
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    assert.ok(systemRoot);
    const shells = [
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      'pwsh',
    ];
    for (const [index, shell] of shells.entries()) {
      const output = path.join(root, `checksums-${index}.txt`);
      const mismatch = path.join(root, `mismatch-${index}.txt`);
      const probe = path.join(root, `probe-${index}.ps1`);
      fs.writeFileSync(
        probe,
        [
          'Set-StrictMode -Version Latest',
          "$ErrorActionPreference = 'Stop'",
          '$tokens = $null; $errors = $null',
          `$ast = [Management.Automation.Language.Parser]::ParseFile(${quote(original)}, [ref]$tokens, [ref]$errors)`,
          "if ($errors.Count) { throw 'Bootstrap source did not parse' }",
          '$functions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false))',
          'foreach ($function in $functions) { . ([scriptblock]::Create($function.Extent.Text)) }',
          `Download ${quote(url)} ${quote(output)} ${expected.length}`,
          '$rejected = $false',
          `try { Download ${quote(url)} ${quote(mismatch)} ${expected.length + 1} } catch { if ($_.Exception.Message -notmatch 'bootstrap_error:download_size') { throw }; $rejected = $true }`,
          "if (-not $rejected) { throw 'Mismatched download length was accepted' }",
          `if (Test-Path -LiteralPath ${quote(mismatch)}) { throw 'Header rejection created an output file' }`,
          "$download = @($functions | Where-Object Name -eq 'Download')[0]",
          "$guards = @($download.Body.FindAll({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.Contains('Content.Headers.ContentLength') }, $true))",
          "if ($guards.Count -ne 1) { throw 'Expected one original Content-Length guard' }",
          '$guard = [scriptblock]::Create("param(`$response,`$Maximum)`n" + $guards[0].Extent.Text)',
          '$known = [Net.Http.HttpResponseMessage]::new()',
          '$known.Content = [Net.Http.ByteArrayContent]::new([byte[]]@(1,2,3))',
          '$known.Content.Headers.ContentLength = 3',
          '& $guard $known 3',
          '$rejected = $false',
          "try { & $guard $known 4 } catch { if ($_.Exception.Message -notmatch 'bootstrap_error:download_size') { throw }; $rejected = $true }",
          "if (-not $rejected) { throw 'Known header mismatch was accepted' }",
          '$pipe = [IO.Pipes.AnonymousPipeServerStream]::new([IO.Pipes.PipeDirection]::In)',
          '$unknown = [Net.Http.HttpResponseMessage]::new()',
          '$unknown.Content = [Net.Http.StreamContent]::new($pipe)',
          "if ($null -ne $unknown.Content.Headers.ContentLength) { throw 'Expected genuinely absent header length' }",
          '& $guard $unknown 3',
          '$unknown.Dispose(); $known.Dispose(); $pipe.Dispose()',
          "Write-Output 'bootstrap-http-verified'",
        ].join('\n') + '\n',
      );
      const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', probe], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90_000,
        maxBuffer: 1024 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      assert.equal(result.stdout.trim(), 'bootstrap-http-verified');
      assert.deepEqual(fs.readFileSync(output), expected);
      assert.equal(
        createHash('sha256').update(fs.readFileSync(output)).digest('hex'),
        createHash('sha256').update(expected).digest('hex'),
      );
    }
  },
);
