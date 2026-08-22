#!/usr/bin/env bash

set -Eeuo pipefail

readonly commit_sha="${1:-}"
readonly compose_profile="${2:-tunnel}"
readonly archive_path="${3:-}"
readonly release_id="${4:-}"
readonly deployment_root="${AXELYN_DEPLOYMENT_ROOT:-/opt/axelyn-signal}"
readonly incoming_dir="${deployment_root}/incoming"
readonly release_root="${deployment_root}/releases"
readonly release_dir="${release_root}/${release_id}"
readonly current_link="${deployment_root}/current"
readonly env_file="${deployment_root}/.env"

fail() {
  printf '[remote-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "The deployment commit must be a full Git SHA."
[[ "$release_id" =~ ^${commit_sha}-[0-9]+-[0-9]+$ ]] || fail "The release identifier is not valid."

readonly expected_archive="${incoming_dir}/axelyn-signal-${release_id}.tar.gz"
readonly expected_script="${incoming_dir}/axelyn-remote-deploy-${release_id}.sh"

[[ "$archive_path" == "$expected_archive" ]] || fail "The release archive path is not valid."
[[ "$0" == "$expected_script" ]] || fail "The remote deployment script path is not valid."

case "$compose_profile" in
  "" | none | tunnel)
    ;;
  *)
    fail "The Compose profile must be 'tunnel' or 'none'."
    ;;
esac

command -v tar >/dev/null 2>&1 || fail "tar is not installed on the VPS."
[[ -r "$archive_path" ]] || fail "The release archive is not readable."
[[ -r "$env_file" ]] || fail "The deployment account cannot read ${env_file}."

cleanup() {
  rm -f -- "$archive_path" "$expected_script"
}
trap cleanup EXIT

[[ ! -e "$release_dir" ]] || fail "The release directory already exists: ${release_dir}."
if [[ -e "$current_link" && ! -L "$current_link" ]]; then
  fail "The current release path exists but is not a symbolic link: ${current_link}."
fi

mkdir -p "$release_root" "$release_dir"
tar -tzf "$archive_path" >/dev/null
tar -xzf "$archive_path" -C "$release_dir"

cd "$release_dir"
[[ -f docker-compose.yml ]] || fail "The release does not contain docker-compose.yml."
[[ -f scripts/deploy-vps.sh ]] || fail "The release does not contain the VPS deployment script."

printf '[remote-deploy] Deploying validated commit %s.\n' "$commit_sha"

GITHUB_SHA="$commit_sha" \
AXELYN_ENV_FILE="$env_file" \
AXELYN_COMPOSE_PROFILE="$compose_profile" \
  bash scripts/deploy-vps.sh

ln -sfn "$release_dir" "$current_link"
printf '[remote-deploy] Current release now points to %s.\n' "$release_dir"
