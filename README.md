# TianGong LCA CLI

Package: `@tiangong-lca/cli` Executable: `tiangong` Node: `24.x`

## Run

Use the published CLI directly:

```bash
npx -y @tiangong-lca/cli@latest --help
npx -y @tiangong-lca/cli@latest doctor
npx -y @tiangong-lca/cli@latest flow --help
```

Optional global install:

```bash
npm install --global @tiangong-lca/cli
tiangong --help
```

Run from this repository:

```bash
npm ci
npm run build
node ./bin/tiangong.js --help
```

## Env

Remote commands require:

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=
TIANGONG_LCA_REGION=us-east-1
```

Notes:

- `TIANGONG_LCA_API_BASE_URL` accepts the project root, `/functions/v1`, or `/rest/v1`.
- `TIANGONG_LCA_API_KEY` is the TianGong user API key from the account page, not a Supabase project key.
- The CLI exchanges `TIANGONG_LCA_API_KEY` for a user session, then reuses the access token for both Edge Functions and direct Supabase access.

Optional session control:

```bash
TIANGONG_LCA_SESSION_FILE=
TIANGONG_LCA_DISABLE_SESSION_CACHE=false
TIANGONG_LCA_FORCE_REAUTH=false
```

Optional LLM review env, only for `review process --enable-llm` or `review flow --enable-llm`:

```bash
TIANGONG_LCA_REVIEW_LLM_BASE_URL=
TIANGONG_LCA_REVIEW_LLM_API_KEY=
TIANGONG_LCA_REVIEW_LLM_MODEL=
```

## Search

Minimal `search flow` request:

```json
{
  "query": "soda lime glass",
  "filter": {
    "flowType": "Product flow"
  }
}
```

Run:

```bash
npx -y @tiangong-lca/cli@latest search flow --input ./search-flow.request.json --json
npx -y @tiangong-lca/cli@latest search process --input ./search-process.request.json --json
npx -y @tiangong-lca/cli@latest search lifecyclemodel --input ./search-lifecyclemodel.request.json --json
```

Empty search results should be treated as empty whether the response is `[]` or `{"data":[]}`.

## Read

```bash
npx -y @tiangong-lca/cli@latest flow get --id <flow-id> --version <version> --json
npx -y @tiangong-lca/cli@latest flow list --id <flow-id> --state-code 100 --limit 20 --json
npx -y @tiangong-lca/cli@latest process get --id <process-id> --version <version> --json
```

## Real DB Flow Review

1. Search or otherwise collect exact flow refs.
2. Materialize DB rows into local review input.
3. Review the materialized rows.
4. Materialize approved decisions into downstream artifacts.

`flow fetch-rows` input:

```json
[
  {
    "id": "7a285e9a-a9f6-4b86-ab17-6ea17367400c",
    "version": "01.01.001",
    "state_code": 100,
    "cluster_id": "cluster-0001",
    "source": "search-flow"
  }
]
```

`flow materialize-decisions` input:

```json
[
  {
    "cluster_id": "cluster-0001",
    "decision": "merge_keep_one",
    "canonical_flow": {
      "id": "7a285e9a-a9f6-4b86-ab17-6ea17367400c",
      "version": "01.01.001"
    },
    "flow_refs": [
      "7a285e9a-a9f6-4b86-ab17-6ea17367400c@01.01.001",
      "017acdd0-7fd7-44cb-a410-1d559e59c506@01.01.001"
    ],
    "reason": "approved_same_product_flow"
  }
]
```

Run:

```bash
npx -y @tiangong-lca/cli@latest flow fetch-rows \
  --refs-file ./flow-refs.json \
  --out-dir ./flow-fetch

npx -y @tiangong-lca/cli@latest review flow \
  --rows-file ./flow-fetch/review-input-rows.jsonl \
  --out-dir ./flow-review

npx -y @tiangong-lca/cli@latest flow materialize-decisions \
  --decision-file ./approved-decisions.json \
  --flow-rows-file ./flow-fetch/review-input-rows.jsonl \
  --out-dir ./flow-decisions
```

Key `flow fetch-rows` outputs:

- `review-input-rows.jsonl`
- `fetch-summary.json`
- `missing-flow-refs.jsonl`
- `ambiguous-flow-refs.jsonl`

Key `flow materialize-decisions` outputs:

- `flow-dedup-canonical-map.json`
- `flow-dedup-rewrite-plan.json`
- `manual-semantic-merge-seed.current.json`
- `decision-summary.json`
- `blocked-clusters.json`

## Other Common Commands

```bash
npx -y @tiangong-lca/cli@latest review process --run-root ./artifacts/process_from_flow/<run_id> --run-id <run_id> --out-dir ./review
npx -y @tiangong-lca/cli@latest publish run --input ./publish-request.json --dry-run
npx -y @tiangong-lca/cli@latest doctor --json
```

## More Docs

- `docs/IMPLEMENTATION_GUIDE_CN.md`: maintainer-facing command contract and implementation notes
- `--help`: the canonical command surface for `tiangong`, `tiangong flow`, `tiangong review`, `tiangong process`, `tiangong lifecyclemodel`, and `tiangong publish`
- `tiangong-lca-skills`: use the skill-specific `SKILL.md` and wrapper docs for agent workflows; the CLI README only covers the public invocation contract

## Help

```bash
npx -y @tiangong-lca/cli@latest --help
npx -y @tiangong-lca/cli@latest flow --help
npx -y @tiangong-lca/cli@latest review --help
npx -y @tiangong-lca/cli@latest process --help
npx -y @tiangong-lca/cli@latest lifecyclemodel --help
npx -y @tiangong-lca/cli@latest publish --help
```
