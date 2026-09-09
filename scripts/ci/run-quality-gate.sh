#!/usr/bin/env bash
set -euo pipefail

gate=(pnpm run prepush:gate)
if [[ $# -gt 0 ]]; then
  [[ $# == 1 && $1 == --parallel ]] || { echo 'Unsupported quality-gate arguments.' >&2; exit 1; }
  gate=(node scripts/ci/run-parallel-quality-gate.cjs)
fi

# CodeBuild launches Actions as root; permission-denial tests need a real
# unprivileged process, just like the hosted Linux runner.
if [[ $(id -u) != 0 ]]; then
  exec "${gate[@]}"
fi
[[ ${RUNNER_OS:-} == Linux && -n ${CODEBUILD_BUILD_ID:-} ]] || {
  echo 'Refusing an unexpected root quality-gate environment.' >&2
  exit 1
}
if ! command -v hostname >/dev/null; then
  if command -v dnf >/dev/null; then
    dnf install -y hostname
  else
    apt-get update
    apt-get install -y --no-install-recommends hostname
  fi
fi
id codebuild-user >/dev/null
[[ -n ${PNPM_HOME:-} && -n ${RUNNER_TEMP:-} && -n ${GITHUB_WORKSPACE:-} ]]
case "$PNPM_HOME" in "$RUNNER_TEMP"/*) ;; *) echo 'pnpm must be installed in runner.temp.' >&2; exit 1 ;; esac
install -d -o codebuild-user -g codebuild-user /home/codebuild-user
chown -R codebuild-user:codebuild-user "$GITHUB_WORKSPACE" "$RUNNER_TEMP"
exec runuser -u codebuild-user -- env HOME=/home/codebuild-user bash -c '
  set -euo pipefail
  test "$(id -u)" != 0
  exec "$@"
' quality-gate "${gate[@]}"
