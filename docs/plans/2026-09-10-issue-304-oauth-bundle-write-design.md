# Issue 304 Production OAuth Bundle Write Design

## Outcome

Restore owner-draft LifecycleModel bundle writes for the bundled official Production OAuth client without widening user ownership, draft-state, raw-table, service-role, or publication authority. Make any future denial actionable by retaining the remote application's sanitized `code` and `details` in CLI failure artifacts.

## Boundaries

- The existing CLI → Edge Function → actor-bound database RPC path remains unchanged.
- `api.cmd_lifecycle_model_bundle_save(jsonb)` and delete remain classified under the dedicated `EDGE-BUNDLE-01` capability. They must not fall back to `DB-CORE-WRITE-01` or `CLI-RPC-01`.
- The Production correction is an audited runtime configuration operation against only the official CLI client. It must preserve the exact client kind, enabled state, and complete before-state capability set.
- Database migrations and Edge runtime code do not change because their checked-in contracts and focused tests already enforce the intended least-privilege behavior.
- Public evidence must not contain account identity, tokens, private payloads, or raw response bodies.

## Implementation

1. Add a CLI regression that drives a structured Edge error through `runLifecyclemodelSaveDraft` and expects the saved row failure to retain `message`, `code`, and safe `details`.
2. Extend the failure report type and serializer only for bounded `CliError` metadata. Preserve the existing message-only fallback for arbitrary errors.
3. Add a maintainer-only Production bundle-write qualification path that reuses the isolated OAuth session boundary and requires an explicitly supplied disposable canonical LifecycleModel fixture. It must perform create, exact owner/state/payload readback, update, exact readback, and authorized cleanup while publishing only a fixed pass/fail projection.
4. Use the audited Production configuration path to add `EDGE-BUNDLE-01` to the official CLI client after exact before-state verification. Reconfigure with the complete before-state plus the one new capability, then verify the atomic after-state and audit delta.

## Error handling and safety

- Only JSON-compatible, bounded remote details from `CliError` enter artifacts; credentials, headers, tokens, URLs with secrets, and raw response text remain excluded.
- Capability correction fails closed if the client identity, kind, enabled state, current grants, route manifest, or expected one-capability delta differs from durable evidence.
- The live case uses a new private directory, an explicitly authorized account, a disposable fixture, exact readback, and deterministic cleanup. Any ambiguous write or cleanup result remains a blocker rather than being retried blindly.

## Verification

- RED/GREEN focused CLI tests for structured failure artifacts.
- Existing LifecycleModel bundle/save-draft tests and the full CLI quality gate.
- Existing Edge actor-client wiring tests and database OAuth capability pgTAP remain green as unchanged dependency evidence.
- Production preflight and post-change evidence record exact capability names and fixed outcomes only.
- Production smoke proves create and update of the authenticated user's own `state_code=0` LifecycleModel and confirms cleanup.
