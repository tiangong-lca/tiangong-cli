#!/usr/bin/env bash
# Release-context decision for .github/workflows/publish.yml ("Resolve release target").
# Inputs come from the workflow environment; outputs go to GITHUB_OUTPUT. Kept as a
# standalone script so test/workflow-release-context.test.mjs executes the exact guard
# logic. See docs/agents/repo-validation.md for the version-bound source profile.
set -euo pipefail

# The workflow always provides GITHUB_STEP_SUMMARY; default it so the script can also
# run in local fixtures without changing CI behavior.
: "${GITHUB_STEP_SUMMARY:=/dev/null}"

git fetch --force origin +refs/heads/main:refs/remotes/origin/main
git fetch --force origin '+refs/tags/*:refs/tags/*'

# Canonical source binding: exact migrated repository name plus the immutable numeric
# repository and owner IDs (github.repository_id / github.repository_owner_id). A rename
# or a recreated owner account reusing the name therefore cannot release.
if [ "${EVENT_REPOSITORY}" != "${EXPECTED_REPOSITORY}" ] ||
  [ "${EVENT_REPOSITORY_ID}" != "${EXPECTED_REPOSITORY_ID}" ] ||
  [ "${EVENT_REPOSITORY_OWNER_ID}" != "${EXPECTED_REPOSITORY_OWNER_ID}" ]; then
  echo "should_release=false" >> "$GITHUB_OUTPUT"
  echo "::notice::Skipping release outside canonical repository binding: ${EVENT_REPOSITORY} (id=${EVENT_REPOSITORY_ID}, owner_id=${EVENT_REPOSITORY_OWNER_ID})."
  exit 0
fi

read_package_version() {
  git show "${1}:package.json" | node -e "const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync(0, 'utf8')); console.log(pkg.version);"
}

# Manual recovery must replay from the exact release tag ref so the OIDC identity
# (job_workflow_ref, workflow sha) matches the tag-pushed release contract; a dispatch
# from main would publish provenance the strict verifier rejects, so it fails here
# before any publish.
if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ]; then
  tag_name="${REQUESTED_TAG_NAME}"
  if [ -z "${tag_name}" ] || [[ "${tag_name}" != cli-v* ]]; then
    echo "::error::workflow_dispatch tag_name must be an existing cli-v* tag."
    exit 1
  fi
  if [ "${GITHUB_REF}" != "refs/tags/${tag_name}" ]; then
    echo "::error::workflow_dispatch must run at the release tag ref refs/tags/${tag_name} (dispatched at ${GITHUB_REF}); a main dispatch cannot produce tag-bound provenance."
    exit 1
  fi
else
  tag_name="${GITHUB_REF_NAME}"
fi

if ! release_head="$(git rev-list -n 1 "${tag_name}" 2>/dev/null)"; then
  echo "::error::Release tag ${tag_name} does not exist."
  exit 1
fi

if ! git cat-file -e "${release_head}:pnpm-lock.yaml" 2>/dev/null; then
  echo "::error::Release tag ${tag_name} predates the pnpm release contract and cannot be replayed by this workflow."
  exit 1
fi

package_version="$(read_package_version "${release_head}")"
expected_tag="cli-v${package_version}"
if [ "${tag_name}" != "${expected_tag}" ]; then
  echo "::error::Release tag ${tag_name} does not match package.json version ${package_version} at ${release_head}."
  exit 1
fi

# Publication floor (CLI #312): versions at or below the frozen legacy ceiling are bound
# to the historical source profile only and must never be released under the current
# repository identity, so an unused lower/backport version cannot become unverifiable.
# Resolve the check against this script's own checkout location, not the caller's cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/check-publication-floor.cjs" "${package_version}"

# Use the independent event and workflow-definition claims. Projecting one SHA
# into the other would erase the evidence we must verify. This also rejects a
# tag moved between the triggering event and the tag readback, before publishing.
if [ "${GITHUB_REF}" != "refs/tags/${tag_name}" ] ||
  [ "${EVENT_COMMIT_SHA}" != "${release_head}" ] ||
  [ "${EVENT_WORKFLOW_SHA}" != "${release_head}" ]; then
  echo "::error::release SHA binding failed: event=${EVENT_COMMIT_SHA} workflow=${EVENT_WORKFLOW_SHA} release_head=${release_head}."
  exit 1
fi

if ! git merge-base --is-ancestor "${release_head}" origin/main; then
  echo "should_release=false" >> "$GITHUB_OUTPUT"
  echo "tag_name=${tag_name}" >> "$GITHUB_OUTPUT"
  echo "release_head=${release_head}" >> "$GITHUB_OUTPUT"
  echo "::notice::Release target ${tag_name} points to ${release_head}, which is not on origin/main. Skipping npm publish."
  exit 0
fi

release_base="$(git rev-parse "${release_head}^")"

echo "release_base=${release_base}" >> "$GITHUB_OUTPUT"
echo "release_head=${release_head}" >> "$GITHUB_OUTPUT"
echo "should_release=true" >> "$GITHUB_OUTPUT"
echo "tag_name=${tag_name}" >> "$GITHUB_OUTPUT"

{
  echo "### Release context"
  echo "- tag: \`${tag_name}\`"
  echo "- head: \`${release_head}\`"
  echo "- base: \`${release_base}\`"
  echo "- package version: \`${package_version}\`"
} >> "$GITHUB_STEP_SUMMARY"
