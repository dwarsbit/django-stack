#!/usr/bin/env bash
# End-to-end test of the prod profile: create a project with the CLI from
# this checkout, write its production settings for https://site.localhost,
# start the production images behind Caddy and test the site, the security
# headers, the deploy checks, the hardening and a backup with a restore.
#
#   pnpm build && scripts/e2e-prod.sh [directory]
#
# FRONTEND picks the frontend (astro by default); every frontend must pass
# the same tests.
# Needs Docker, uv and pnpm, and ports 80 and 443. Caddy signs site.localhost
# with its own local CA. Leaves the project running with KEEP=1.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-$(mktemp -d)}"
project="$work/prod-site"
cli="$repo/packages/cli/dist/bin.js"
site="https://site.localhost"

fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  if [ "${KEEP:-0}" != "1" ] && [ -f "$project/compose.yaml" ]; then
    (cd "$project" && docker compose down --volumes --remove-orphans >/dev/null 2>&1) || true
  fi
}
trap cleanup EXIT

node "$cli" init "$project" --yes --no-git --link "$repo" --frontend "${FRONTEND:-astro}" \
  ${PACKAGE_MANAGER:+--package-manager "$PACKAGE_MANAGER"}
cd "$project"
headless=""
[ "${FRONTEND:-astro}" = "headless" ] && headless=1
node "$cli" production . --domain site.localhost --email-url smtp://mail.invalid:25 --yes
mv .env .env.development
mv .env.production .env
profiles="prod,db,analytics"
[ -n "$headless" ] && profiles="prod,db"
grep -q "^COMPOSE_PROFILES=$profiles\$" .env || fail "the production settings do not use the prod profile"

docker compose build
docker compose up --detach --wait --wait-timeout 300

# Trust Caddy's local CA, as a browser would trust Let's Encrypt.
ca="$work/caddy-root.crt"
for _ in $(seq 1 30); do
  docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt "$ca" >/dev/null 2>&1 && break
  sleep 1
done
[ -s "$ca" ] || fail "Caddy did not create its local CA"

c() {
  curl --silent --cacert "$ca" --noproxy '*' \
    --resolve site.localhost:443:127.0.0.1 --resolve site.localhost:80:127.0.0.1 "$@"
}
status() { c -o /dev/null -w '%{http_code}' "$@"; }
expect() {
  local want="$1"; shift
  local got
  got="$(status "$@")"
  # Only the URL, the last argument: the others can hold keys.
  [ "$got" = "$want" ] || fail "${*: -1} answered $got, expected $want"
  echo "ok $want ${*: -1}"
}

echo "Waiting for the site"
for _ in $(seq 1 60); do
  [ "$(status "$site/")" = "200" ] && break
  sleep 2
done

read_key="$(grep '^API_READ_KEY=' .env | cut -d= -f2)"
password="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2)"

expect 200 "$site/"
if [ -z "$headless" ]; then
  expect 200 "$site/blog"
  expect 200 "$site/blog/hello-world"
fi
expect 404 "$site/does-not-exist"
expect 308 http://site.localhost/
expect 200 "$site/admin/"
expect 200 "$site/admin/login/"
expect 200 "$site/static/admin/css/base.css"
expect 401 "$site/api/content.page"
expect 200 -H "X-Secret-Key: $read_key" "$site/api/content.page"
expect 404 "$site/readyz"
expect 404 "$site/statusz"

if [ -n "$headless" ]; then
  image="$(c -H "X-Secret-Key: $read_key" "$site/api/content.post" | grep -o '"[^"]*/media/[^"]*"' | head -1 | tr -d '"')"
  [ -n "$image" ] || fail "the posts in the API have no images"
else
  image="$(c "$site/blog" | grep -o 'src="[^"]*/media/[^"]*"' | head -1 | cut -d'"' -f2)"
  [ -n "$image" ] || fail "the blog shows no images"
fi
case "$image" in "$site/media/"*) ;; *) fail "image $image is not served from $site/media/" ;; esac
expect 200 "$image"

headers="$(c --head "$site/")"
for header in strict-transport-security content-security-policy x-content-type-options x-frame-options; do
  grep -qi "^$header:" <<<"$headers" || fail "$site/ has no $header header"
done
grep -qi '^server:' <<<"$headers" && fail "$site/ shows the server software"
echo "ok security headers"

if [ -z "$headless" ]; then
echo "Checking page analytics"
home="$(c "$site/")"
grep -q '/_a/script.js' <<<"$home" || fail "the site does not load the analytics tracker"
expect 200 "$site/_a/script.js"
expect 404 "$site/_a/api/websites"
expect 404 "$site/_a/login"
website="$(grep '^UMAMI_WEBSITE_ID=' .env | cut -d= -f2)"
expect 200 -X POST -H "Content-Type: application/json" -A "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0" \
  -d "{\"type\":\"event\",\"payload\":{\"website\":\"$website\",\"hostname\":\"site.localhost\",\"url\":\"/\",\"language\":\"en\",\"screen\":\"1x1\"}}" \
  "$site/_a/api/send"
docker compose exec -T backend-prod python manage.py shell -c "from content_studio.analytics.ranges import get_query; from django_stack.analytics import UmamiProvider; views = UmamiProvider().get_summary(None, get_query('today'))['pageviews'].value; assert views >= 1, views"
echo "ok the admin reads the page view from Umami"
fi

echo "Checking the deployment"
docker compose exec -T backend-prod python manage.py check --deploy --fail-level WARNING
docker compose exec -T backend-prod python manage.py health
# Not grep -q: it stops reading early, and with pipefail the cut-off
# `docker compose logs` fails the pipeline.
docker compose logs --no-log-prefix backend-prod | grep -F '"logger": "django_stack.access"' > /dev/null \
  || fail "the backend wrote no JSON access log"
docker compose logs --no-log-prefix proxy | grep -F '"request_id"' > /dev/null || fail "Caddy logged no request IDs"
if docker compose exec -T backend-prod touch /app/written 2>/dev/null; then
  fail "the backend can write to its code"
fi
echo "ok read-only containers"

echo "Backing up and restoring"
# The worker backs up when it starts, as there is no backup yet.
# The list is read into a variable first: grep -q stops reading at the first
# match, and with pipefail the writer's broken pipe would fail the check.
backups() { docker compose exec -T worker-prod python manage.py backup_database --list; }
for _ in $(seq 1 60); do
  grep -q '^local .*\.dump$' <<<"$(backups)" && break
  sleep 2
done
grep -q '^local .*\.dump$' <<<"$(backups)" \
  || fail "the worker made no backup when it started"
echo "ok startup backup"
docker compose exec -T worker-prod python manage.py backup_database
backup="$(backups | awk '/^local/ && /\.dump$/ {print $2}' | tail -1)"
[ -n "$backup" ] || fail "backup_database --list shows no backup"
grep -qF "${backup%.dump}.media.tar.gz" <<<"$(backups)" \
  || fail "backup_database made no media archive"
upload="$(docker compose exec -T worker-prod find /app/media -type f -print -quit)"
[ -n "$upload" ] || fail "the media volume is empty"
docker compose exec -T worker-prod rm "$upload"

token="$(c -X POST -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$password\"}" \
  "$site/admin/api/login/usernamepassword" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access"])')"
page_id="$(c -H "X-Secret-Key: $read_key" "$site/api/content.page?path=about" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])')"
title() {
  c -H "X-Secret-Key: $read_key" "$site/api/content.page/$page_id" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["title"])'
}
before="$(title)"
expect 200 -X PATCH -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
  -d '{"title":"Changed after the backup"}' "$site/admin/api/content/content.page/$page_id"
[ "$(title)" = "Changed after the backup" ] || fail "the edit was not saved"
docker compose exec -T worker-prod python manage.py restore_database "$backup" --media --yes
[ "$(title)" = "$before" ] || fail "the restore did not bring back \"$before\""
docker compose exec -T worker-prod test -f "$upload" || fail "the restore did not bring back $upload"
echo "ok restore"

if getent hosts site.localhost >/dev/null; then
  NODE_EXTRA_CA_CERTS="$ca" node "$cli" doctor .
fi
echo "Production end-to-end test passed"
