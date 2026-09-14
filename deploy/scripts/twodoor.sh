#!/usr/bin/env sh
# Wrapper for the two-door compose stack.
#
#   ./deploy/scripts/twodoor.sh <local|l40> <docker compose args...>
#
# e.g.  ./deploy/scripts/twodoor.sh local up -d --build
#       ./deploy/scripts/twodoor.sh local logs -f nginx
#       ./deploy/scripts/twodoor.sh local down
#
# Loads the root .env (secrets, DB creds) plus deploy/.env.twodoor.<env>
# (door hostnames/ports) and layers docker-compose.twodoor.yml over the
# base compose file.
set -eu

env_name="${1:-}"
if [ -z "$env_name" ]; then
  echo "usage: $0 <local|l40> <docker compose args...>" >&2
  exit 2
fi
shift

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
door_env="$repo_root/deploy/.env.twodoor.$env_name"

if [ ! -f "$door_env" ]; then
  echo "missing $door_env — copy deploy/.env.twodoor.$env_name.example and fill it in" >&2
  exit 1
fi
if [ ! -f "$repo_root/.env" ]; then
  echo "missing $repo_root/.env — the base stack needs it (see .env.example)" >&2
  exit 1
fi

exec docker compose \
  --project-directory "$repo_root" \
  --env-file "$repo_root/.env" \
  --env-file "$door_env" \
  -f "$repo_root/docker-compose.yml" \
  -f "$repo_root/docker-compose.twodoor.yml" \
  "$@"
