#!/usr/bin/env bash
# End-to-end test: create a project with the CLI from this checkout, start
# it with Docker Compose, run the template tests inside the containers and
# smoke-test the site, the admin and the API.
#
#   pnpm build && scripts/e2e.sh [directory]
#
# With LOCAL_S3=1 the project stores media in the local S3 service.
# FRONTEND picks the frontend (astro by default); every frontend must pass
# the same tests.
# Needs Docker, uv and pnpm. Leaves the project running with KEEP=1.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-$(mktemp -d)}"
project="$work/e2e-site"
cli="$repo/packages/cli/dist/bin.js"

fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  if [ "${KEEP:-0}" != "1" ] && [ -f "$project/compose.yaml" ]; then
    (cd "$project" && docker compose down --volumes --remove-orphans >/dev/null 2>&1) || true
  fi
}
trap cleanup EXIT

node "$cli" init "$project" --yes --no-git --link "$repo" --frontend "${FRONTEND:-astro}" ${LOCAL_S3:+--storage s3}
cd "$project"

docker compose build
docker compose up --detach --wait --wait-timeout 300 backend worker
docker compose up --detach frontend mailpit

echo "Waiting for the frontend"
for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)" = "200" ] && break
  sleep 2
done

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() {
  local want="$1"; shift
  local got
  got="$(status "$@")"
  # Only the URL, the last argument: the others can hold keys.
  [ "$got" = "$want" ] || fail "${*: -1} answered $got, expected $want"
  echo "ok $want ${*: -1}"
}

read_key="$(grep '^API_READ_KEY=' .env | cut -d= -f2)"
password="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2)"

expect 200 http://localhost:3000/
expect 200 http://localhost:3000/about
expect 200 http://localhost:3000/about/team
expect 200 http://localhost:3000/blog
expect 200 http://localhost:3000/blog/hello-world
expect 404 http://localhost:3000/does-not-exist
expect 301 http://localhost:3000/old-about
expect 200 http://localhost:3000/sitemap.xml
expect 200 http://localhost:3000/rss.xml
expect 200 http://localhost:3000/admin/
expect 401 http://localhost:3000/api/content.page
expect 200 -H "X-Secret-Key: $read_key" http://localhost:3000/api/content.page
expect 200 http://localhost:8000/readyz
expect 201 -X POST -H "Content-Type: application/json" \
  -d '{"name":"E2E","email":"e2e@example.com","message":"Hello"}' \
  http://localhost:3000/api/content.formsubmission

image="$(curl -s http://localhost:3000/blog | grep -o 'src="[^"]*/media/[^"]*"' | head -1 | cut -d'"' -f2)"
[ -n "$image" ] || fail "the blog shows no images"
expect 200 "$image"

# Sign in to the admin and edit a page: the site shows the change.
token="$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$password\"}" \
  http://localhost:3000/admin/api/login/usernamepassword | python3 -c 'import json,sys; print(json.load(sys.stdin)["access"])')"
page_id="$(curl -s -H "X-Secret-Key: $read_key" 'http://localhost:3000/api/content.page?path=about' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])')"
expect 200 -X PATCH -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
  -d '{"title":"Edited by the end-to-end test"}' "http://localhost:3000/admin/api/content/content.page/$page_id"
curl -s http://localhost:3000/about | grep -q "Edited by the end-to-end test" || fail "the edit does not show on the site"
echo "ok the edit shows on the site"

echo "Running the template tests"
docker compose exec -T backend python manage.py check --fail-level WARNING
docker compose exec -T backend python manage.py makemigrations --check --dry-run
docker compose exec -T backend pytest -q
docker compose exec -T frontend npm run check
docker compose exec -T frontend npm test

node "$cli" doctor .
node "$cli" check --tests
echo "End-to-end test passed"
