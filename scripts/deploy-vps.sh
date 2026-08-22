#!/usr/bin/env bash

set -Eeuo pipefail

readonly env_file="${AXELYN_ENV_FILE:-/opt/axelyn-signal/.env}"
readonly compose_profile="${AXELYN_COMPOSE_PROFILE:-tunnel}"
readonly wait_timeout="${AXELYN_DEPLOY_WAIT_TIMEOUT:-180}"
readonly app_image="axelyn-signal-app:latest"
readonly rollback_image="axelyn-signal-app:rollback"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_setting() {
  local key="$1"

  if ! grep -Eq "^${key}=.+$" "$env_file"; then
    fail "${key} must be set in ${env_file}."
  fi
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available."
docker info >/dev/null 2>&1 || fail "The runner account cannot access the Docker daemon."

[[ -r "$env_file" ]] || fail "The runner cannot read ${env_file}."
[[ "$wait_timeout" =~ ^[1-9][0-9]*$ ]] || fail "AXELYN_DEPLOY_WAIT_TIMEOUT must be a positive integer."

require_setting POSTGRES_PASSWORD
require_setting SETTINGS_ENCRYPTION_KEY

if grep -Eq '^POSTGRES_PASSWORD=replace_me$' "$env_file"; then
  fail "Replace the default PostgreSQL password in ${env_file}."
fi

if grep -Eq '^SETTINGS_ENCRYPTION_KEY=replace_with_a_base64_32_byte_key$' "$env_file"; then
  fail "Replace the default encryption key in ${env_file}."
fi

profile_args=()
services=(db app)

case "$compose_profile" in
  "" | none)
    ;;
  tunnel)
    require_setting CLOUDFLARE_TUNNEL_TOKEN
    profile_args=(--profile tunnel)
    services+=(tunnel)
    ;;
  *)
    fail "AXELYN_COMPOSE_PROFILE must be 'tunnel' or 'none'."
    ;;
esac

compose=(docker compose --env-file "$env_file" "${profile_args[@]}")

show_diagnostics() {
  "${compose[@]}" ps || true
  "${compose[@]}" logs --no-color --tail=150 "${services[@]}" || true
}

log "Validating the production Compose configuration."
"${compose[@]}" config --quiet

previous_image_id="$(docker image inspect "$app_image" --format '{{.Id}}' 2>/dev/null || true)"
if [[ -n "$previous_image_id" ]]; then
  docker image tag "$previous_image_id" "$rollback_image"
fi

log "Building the application image for ${GITHUB_SHA:-the checked-out commit}."
if ! "${compose[@]}" build --pull app; then
  fail "The image build failed; the running release was left untouched."
fi

log "Starting the updated stack and waiting for health checks."
if ! "${compose[@]}" up -d --remove-orphans --wait --wait-timeout "$wait_timeout"; then
  log "The new release did not become healthy."
  show_diagnostics

  if [[ -n "$previous_image_id" ]]; then
    log "Restoring the previous application image."
    docker image tag "$rollback_image" "$app_image"

    if "${compose[@]}" up -d --no-build --remove-orphans --wait --wait-timeout "$wait_timeout"; then
      log "Rollback completed successfully."
    else
      log "Rollback also failed; inspect the VPS immediately."
      show_diagnostics
    fi
  else
    log "No previous application image was available for rollback."
  fi

  exit 1
fi

log "Deployment is healthy."
"${compose[@]}" ps
