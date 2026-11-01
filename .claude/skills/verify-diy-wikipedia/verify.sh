#!/usr/bin/env bash
# Verification harness for DIY Wikipedia (Next.js web + FastAPI api). See SKILL.md next to this file.
#
#   verify.sh launch  [RUN_ID]          copy working tree, build both services, start both; prints RUN_ID
#   verify.sh doctor  RUN_ID            read-only health check of the instances this run started
#   verify.sh url     RUN_ID [PATH]     print the web base URL (or URL of PATH)
#   verify.sh api-url RUN_ID [PATH]     print the API base URL (or URL of PATH)
#   verify.sh get     RUN_ID PATH NAME  curl web PATH; save status+headers+body to evidence as NAME.*
#   verify.sh api     RUN_ID METHOD PATH NAME [JSON]  call the API; save request+status+headers+body as NAME.*
#   verify.sh shot    RUN_ID PATH NAME  headless Firefox screenshot of web PATH -> evidence/NAME.png
#   verify.sh drive   RUN_ID DRIVER     run drivers/DRIVER.mjs in real Chromium (Playwright); exit 1 on FAIL
#   verify.sh cleanup RUN_ID            stop the servers we started, delete the app copy, keep evidence
#
# Every run lives under $VERIFY_ROOT/<RUN_ID>/ (default: <repo>/.verify/):
#   app/       disposable copy of the working tree (built here, never in the user's checkout)
#   state/     pid, port, api.pid, api-port, server.log, api.log, build.log, source revision
#   evidence/  proof artifacts; survives cleanup
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VERIFY_ROOT="${VERIFY_ROOT:-$REPO/.verify}"

die() { echo "verify: $*" >&2; exit 1; }
run_dir() { [[ -n "${1:-}" ]] || die "RUN_ID required"; echo "$VERIFY_ROOT/$1"; }
port_of() { cat "$(run_dir "$1")/state/port" 2>/dev/null || die "no port recorded for run $1"; }
api_port_of() { cat "$(run_dir "$1")/state/api-port" 2>/dev/null || die "no api port recorded for run $1"; }
base_url() { echo "http://127.0.0.1:$(port_of "$1")"; }
api_url() { echo "http://127.0.0.1:$(api_port_of "$1")"; }

# free_port LOW HIGH: first port in the range nothing is listening on.
free_port() {
  local p
  for p in $(seq "$1" "$2"); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return; fi
  done
  die "no free port in $1-$2"
}

cmd_launch() {
  local id="${1:-$(date +%Y%m%d-%H%M%S)-$$}"
  local d; d="$(run_dir "$id")"
  [[ -e "$d/state/pid" ]] && die "run $id already exists at $d; pick another RUN_ID"
  command -v uv >/dev/null || die "uv not found; install it (https://docs.astral.sh/uv/) to build the API"
  mkdir -p "$d/app" "$d/state" "$d/evidence"

  # Copy the working tree (uncommitted edits included) minus build output, deps, secrets, git.
  rsync -a --delete --exclude .git --exclude node_modules --exclude .next \
    --exclude .venv --exclude __pycache__ --exclude .pytest_cache \
    --exclude '.env' --exclude '.env.*' --include '.env.example' --exclude .verify \
    "$REPO/" "$d/app/"
  # +dirty when anything differs from HEAD, untracked files included (git diff alone misses those).
  ( cd "$REPO" && echo "$(git rev-parse HEAD 2>/dev/null || echo unknown)$([[ -z "$(git status --porcelain 2>/dev/null)" ]] || echo '+dirty')" ) > "$d/state/source-rev"

  # Same lifecycles Render runs (render.yaml): web = npm ci && npm run build; api = uv sync --locked.
  { ( cd "$d/app" && npm ci --no-audit --no-fund && npm run build ) \
    && ( cd "$d/app/api" && uv sync --locked --no-dev ); } > "$d/state/build.log" 2>&1 \
    || { tail -40 "$d/state/build.log" >&2; die "install/build failed; full log: $d/state/build.log"; }

  local port; port="$(free_port 3100 3199)"
  echo "$port" > "$d/state/port"
  # setsid: each server gets its own process group so cleanup kills exactly what we started.
  # $! must be setsid's own pid (it becomes the group leader), so background only that command.
  (
    cd "$d/app" || exit 1
    PORT="$port" PAYPAL_ENV=sandbox setsid npm start > "$d/state/server.log" 2>&1 < /dev/null &
    echo $! > "$d/state/pid"
  )

  local api_port; api_port="$(free_port 3200 3299)"
  echo "$api_port" > "$d/state/api-port"
  (
    cd "$d/app/api" || exit 1
    CORS_ALLOW_ORIGINS="http://127.0.0.1:$port,http://localhost:$port" PAYPAL_ENV=sandbox \
      setsid .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$api_port" > "$d/state/api.log" 2>&1 < /dev/null &
    echo $! > "$d/state/api.pid"
  )

  # Ready = web /healthz ok AND home page heading renders AND api /healthz ok.
  local i
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/healthz" 2>/dev/null | grep -q '"status":"ok"' \
       && curl -fsS "http://127.0.0.1:$port/" 2>/dev/null | grep -q '<h1>DIY Wikipedia</h1>' \
       && curl -fsS "http://127.0.0.1:$api_port/healthz" 2>/dev/null | grep -q '"status":"ok"'; then
      echo "$id"
      echo "ready: web http://127.0.0.1:$port  api http://127.0.0.1:$api_port  (evidence: $d/evidence)" >&2
      return 0
    fi
    kill -0 "$(cat "$d/state/pid")" 2>/dev/null || { tail -40 "$d/state/server.log" >&2; die "web server exited during startup"; }
    kill -0 "$(cat "$d/state/api.pid")" 2>/dev/null || { tail -40 "$d/state/api.log" >&2; die "api server exited during startup"; }
    sleep 0.5
  done
  tail -20 "$d/state/server.log" >&2; tail -20 "$d/state/api.log" >&2; die "not ready after 30s"
}

# check_service LABEL PID PORT: process alive, port held by our process group, /healthz exact.
# Prints ok/FAIL lines; returns 1 on any FAIL.
check_service() {
  local label="$1" pid="$2" port="$3" ok=0
  if kill -0 "$pid" 2>/dev/null; then echo "ok   $label process group $pid alive"; else echo "FAIL $label process $pid not running"; ok=1; fi
  local holder; holder="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
  if [[ -n "$holder" ]] && [[ "$(ps -o pgid= -p "$holder" | tr -d ' ')" == "$pid" ]]; then
    echo "ok   $label port $port held by pid $holder (pgid $pid)"
  else echo "FAIL $label port $port not held by our process group (holder: ${holder:-none})"; ok=1; fi
  local hz; hz="$(curl -sS -w ' %{http_code}' "http://127.0.0.1:$port/healthz" 2>&1 || true)"
  if [[ "$hz" == '{"status":"ok"} 200' ]]; then echo "ok   $label /healthz -> $hz"; else echo "FAIL $label /healthz -> $hz"; ok=1; fi
  return $ok
}

cmd_doctor() {
  local d; d="$(run_dir "$1")"; local ok=1
  local pid port api_pid api_port
  pid="$(cat "$d/state/pid" 2>/dev/null || true)"; port="$(cat "$d/state/port" 2>/dev/null || true)"
  api_pid="$(cat "$d/state/api.pid" 2>/dev/null || true)"; api_port="$(cat "$d/state/api-port" 2>/dev/null || true)"
  [[ -n "$pid" && -n "$port" ]] || die "run $1 has no state in $d/state (not launched by verify.sh?)"
  [[ -n "$api_pid" && -n "$api_port" ]] || die "run $1 has no api state (launched by an older verify.sh?)"

  check_service web "$pid" "$port" || ok=0
  # Build identity: the BUILD_ID on disk must be the one the server references in its HTML.
  local bid; bid="$(cat "$d/app/.next/BUILD_ID" 2>/dev/null || echo missing)"
  if curl -fsS "http://127.0.0.1:$port/" 2>/dev/null | grep -q "$bid"; then echo "ok   web serving build $bid"
  else echo "FAIL web served HTML does not reference build $bid"; ok=0; fi

  check_service api "$api_pid" "$api_port" || ok=0
  # Contract identity: the running API's schema must equal the committed contract/openapi.json
  # (compared as parsed JSON, so whitespace differences do not matter).
  if "$d/app/api/.venv/bin/python" - "$d/app/contract/openapi.json" "http://127.0.0.1:$api_port/openapi.json" <<'PY' 2>/dev/null
import json, sys, urllib.request
committed = json.load(open(sys.argv[1], encoding="utf-8"))
served = json.load(urllib.request.urlopen(sys.argv[2], timeout=5))
sys.exit(0 if committed == served else 1)
PY
  then echo "ok   api /openapi.json matches contract/openapi.json"
  else echo "FAIL api /openapi.json differs from contract/openapi.json (run: cd api && uv run python scripts/export_openapi.py)"; ok=0; fi

  echo "info source $(cat "$d/state/source-rev")  web http://127.0.0.1:$port  api http://127.0.0.1:$api_port  evidence $d/evidence"
  [[ $ok == 1 ]] || exit 1
}

cmd_get() {
  local d; d="$(run_dir "$1")"; local path="$2" name="$3"
  local out="$d/evidence/$name"
  curl -sS -D "$out.headers" -o "$out.body" -w '%{http_code}\n' "$(base_url "$1")$path" > "$out.status"
  printf 'GET %s -> %s (headers %s, body %s)\n' "$path" "$(cat "$out.status")" "$out.headers" "$out.body"
}

cmd_api() {
  local d; d="$(run_dir "$1")"; local method="$2" path="$3" name="$4" body="${5:-}"
  local out="$d/evidence/$name"
  local args=(-sS -X "$method" -D "$out.headers" -o "$out.body" -w '%{http_code}\n')
  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
    printf '%s\n' "$body" > "$out.request"
  fi
  curl "${args[@]}" "$(api_url "$1")$path" > "$out.status"
  printf 'API %s %s -> %s (headers %s, body %s)\n' "$method" "$path" "$(cat "$out.status")" "$out.headers" "$out.body"
}

cmd_shot() {
  local d; d="$(run_dir "$1")"; local path="$2" name="$3"
  command -v firefox >/dev/null || die "firefox not found; screenshots unavailable (curl evidence still works)"
  local prof; prof="$(mktemp -d "$d/state/ffprofile.XXXX")"
  # Throwaway profile + --no-remote: never attaches to or disturbs the user's own Firefox.
  timeout 60 firefox --headless --no-remote --profile "$prof" --window-size=1280,800 \
    --screenshot "$d/evidence/$name.png" "$(base_url "$1")$path" > "$d/state/firefox-$name.log" 2>&1 || true
  rm -rf "$prof"
  [[ -s "$d/evidence/$name.png" ]] || die "screenshot failed; see $d/state/firefox-$name.log"
  echo "screenshot $d/evidence/$name.png"
}

# drive RUN_ID DRIVER: interactive browser checks. Firefox --screenshot captures before React
# hydrates, so client-rendered UI (the AG Grid rows) only shows up here. Playwright lives in a user
# cache outside the repo (never in package.json, so Render installs stay unchanged); first use
# installs it plus Chromium (~120 MB).
cmd_drive() {
  local d; d="$(run_dir "$1")"; local driver="$2"
  local src="$REPO/.claude/skills/verify-diy-wikipedia/drivers/$driver.mjs"
  [[ -f "$src" ]] || die "no driver $src"
  local pw="${VERIFY_PW_DIR:-$HOME/.cache/verify-diy-wikipedia/playwright}"
  if [[ ! -d "$pw/node_modules/playwright" ]]; then
    mkdir -p "$pw"
    ( cd "$pw" && { [[ -f package.json ]] || npm init -y >/dev/null; } \
      && npm i --no-audit --no-fund playwright@1 && npx playwright install chromium ) > "$d/state/playwright-install.log" 2>&1 \
      || die "playwright install failed; see $d/state/playwright-install.log"
  fi
  # The driver must sit next to node_modules for ESM to resolve "playwright".
  cp "$src" "$pw/$driver.mjs"
  ( cd "$pw" && node "$driver.mjs" "$(base_url "$1")" "$d/evidence" )
}

cmd_cleanup() {
  local d; d="$(run_dir "$1")"
  [[ -d "$d" ]] || die "no run at $d"
  local f pid
  for f in pid api.pid; do
    pid="$(cat "$d/state/$f" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.25; done
      kill -KILL -- "-$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$d/app" "$d/state/pid" "$d/state/api.pid" "$d/state"/ffprofile.*
  echo "stopped run $1; evidence kept in $d/evidence ; logs in $d/state"
}

case "${1:-}" in
  launch)  shift; cmd_launch "$@" ;;
  doctor)  shift; cmd_doctor "$@" ;;
  url)     shift; echo "$(base_url "$1")${2:-}" ;;
  api-url) shift; echo "$(api_url "$1")${2:-}" ;;
  get)     shift; [[ $# == 3 ]] || die "usage: get RUN_ID PATH NAME"; cmd_get "$@" ;;
  api)     shift; [[ $# == 4 || $# == 5 ]] || die "usage: api RUN_ID METHOD PATH NAME [JSON]"; cmd_api "$@" ;;
  shot)    shift; [[ $# == 3 ]] || die "usage: shot RUN_ID PATH NAME"; cmd_shot "$@" ;;
  drive)   shift; [[ $# == 2 ]] || die "usage: drive RUN_ID DRIVER"; cmd_drive "$@" ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  *) sed -n '2,17p' "$0"; exit 2 ;;
esac
