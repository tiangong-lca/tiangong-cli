import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRuntimeRule,
  getRuntimeRuleset,
  isRuntimeRuleBlocker,
  listRuntimeRulesets,
  resolveRuntimeRuleId,
  runtimeRuleIds,
} from '../src/lib/runtime-rulesets.js';

test('runtime ruleset registry exposes stable metadata and local rule mappings', () => {
  const rulesets = listRuntimeRulesets();
  assert.equal(rulesets.length >= 8, true);

  const processPublish = getRuntimeRuleset('process-publish/default');
  assert.equal(processPublish.version, '1');
  assert.equal(processPublish.source_version, '2026.08.31');
  assert.equal(processPublish.rule_ids.includes('tidas.process.version.format'), true);
  assert.equal(
    processPublish.rule_ids.includes('tidas.process.exchange.same-reference-flow-input.block'),
    true,
  );
  assert.deepEqual(runtimeRuleIds('process-dedup/default'), [
    'tidas.process.identity.duplicate-fingerprint.block',
  ]);

  const flowTypeRule = getRuntimeRule('tidas.flow.type.required');
  assert.equal(flowTypeRule?.default_blocker, true);
  assert.equal(flowTypeRule?.phases.includes('publish-run'), true);
  assert.equal(getRuntimeRule('unknown.rule'), null);

  const flowAuthoring = runtimeRuleIds('flow-authoring/strict');
  assert.equal(flowAuthoring.includes('tidas.flow.classification.elementary.valid'), true);
  assert.equal(flowAuthoring.includes('tidas.flow.identity.alias-equivalence.review'), true);

  assert.equal(
    resolveRuntimeRuleId('flow-authoring/strict', 'missing_type_of_dataset'),
    'tidas.flow.type.required',
  );
  assert.equal(
    resolveRuntimeRuleId('process-authoring/strict', 'process_missing_exchange_amount'),
    'tidas.process.exchange.amount.required',
  );
  assert.equal(
    resolveRuntimeRuleId('process-authoring/strict', 'process_same_reference_flow_input'),
    'tidas.process.exchange.same-reference-flow-input.block',
  );
  assert.equal(resolveRuntimeRuleId('flow-authoring/strict', 'unknown_local_rule'), null);
  assert.equal(resolveRuntimeRuleId('flow-authoring/strict', null), null);

  assert.equal(isRuntimeRuleBlocker('tidas.process.version.format'), true);
  assert.equal(isRuntimeRuleBlocker('tidas.flow.identity.alias-equivalence.review'), false);
  assert.equal(isRuntimeRuleBlocker('unknown.rule'), false);
  assert.equal(isRuntimeRuleBlocker(undefined), false);
});
