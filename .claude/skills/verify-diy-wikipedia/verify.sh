#!/usr/bin/env bash
# Verification harness for DIY Wikipedia (Next.js). See SKILL.md next to this file.
#
#   verify.sh launch  [RUN_ID]          copy working tree, npm ci, build, npm start; prints RUN_ID
#   verify.sh doctor  RUN_ID            read-only health check of the instance this run started
#   verify.sh url     RUN_ID [PATH]     print the base URL (or URL of PATH)
#   verify.sh get     RUN_ID PATH NAME  curl PATH; save status+headers+body to evidence as NAME.*
#   verify.sh shot    RUN_ID PATH NAME  headless Firefox screenshot of PATH -> evidence/NAME.png
#   verify.sh cleanup RUN_ID            stop the server we started, delete the app copy, keep evidence
#
# Every run lives under $VERIFY_ROOT/<RUN_ID>/ (default: <repo>/.verify/):
#   app/       disposable copy of the working tree (built here, never in the user's checkout)
#   state/     pid, port, server.log, source revision
#   evidence/  proof artifacts; survives cleanup
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VERIFY_ROOT="${VERIFY_ROOT:-$REPO/.verify}"

die() { echo "verify: $*" >&2; exit 1; }
run_dir() { [[ -n "${1:-}" ]] || die "RUN_ID required"; echo "$VERIFY_ROOT/$1"; }
port_of() { cat "$(run_dir "$1")/state/port" 2>/dev/null || die "no port recorded for run $1"; }
base_url() { echo "http://127.0.0.1:$(port_of "$1")"; }

free_port() {
  local p
  for p in $(seq 3100 3199); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return; fi
  done
  die "no free port in 3100-3199"
}

cmd_launch() {
  local id="${1:-$(date +%Y%m%d-%H%M%S)-$$}"
  local d; d="$(run_dir "$id")"
  [[ -e "$d/state/pid" ]] && die "run $id already exists at $d; pick another RUN_ID"
  mkdir -p "$d/app" "$d/state" "$d/evidence"

  # Copy the working tree (uncommitted edits included) minus build output, deps, secrets, git.
  rsync -a --delete --exclude .git --exclude node_modules --exclude .next \
    --exclude '.env' --exclude '.env.*' --include '.env.example' --exclude .verify \
    "$REPO/" "$d/app/"
  ( cd "$REPO" && echo "$(git rev-parse HEAD 2>/dev/null || echo unknown)$(git diff --quiet HEAD 2>/dev/null || echo '+dirty')" ) > "$d/state/source-rev"

  # Same lifecycle Render runs (render.yaml): npm ci && npm run build, then npm start.
  ( cd "$d/app" && npm ci --no-audit --no-fund && npm run build ) > "$d/state/build.log" 2>&1 \
    || { tail -40 "$d/state/build.log" >&2; die "install/build failed; full log: $d/state/build.log"; }

  local port; port="$(free_port)"
  echo "$port" > "$d/state/port"
  # setsid: the server gets its own process group so cleanup kills exactly what we started.
  # $! must be setsid's own pid (it becomes npm, the group leader), so background only that command.
  (
    cd "$d/app" || exit 1
    PORT="$port" PAYPAL_ENV=sandbox setsid npm start > "$d/state/server.log" 2>&1 < /dev/null &
    echo $! > "$d/state/pid"
  )

  # Ready = /healthz answers 200 {"status":"ok"} AND the home page renders the app heading.
  local i
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/healthz" 2>/dev/null | grep -q '"status":"ok"' \
       && curl -fsS "http://127.0.0.1:$port/" 2>/dev/null | grep -q '<h1>DIY Wikipedia</h1>'; then
      echo "$id"; echo "ready: http://127.0.0.1:$port  (evidence: $d/evidence)" >&2; return 0
    fi
    kill -0 "$(cat "$d/state/pid")" 2>/dev/null || { tail -40 "$d/state/server.log" >&2; die "server exited during startup"; }
    sleep 0.5
  done
  tail -40 "$d/state/server.log" >&2; die "not ready after 30s"
}

cmd_doctor() {
  local d; d="$(run_dir "$1")"; local ok=1
  local pid port; pid="$(cat "$d/state/pid" 2>/dev/null || true)"; port="$(cat "$d/state/port" 2>/dev/null || true)"
  [[ -n "$pid" && -n "$port" ]] || die "run $1 has no state in $d/state (not launched by verify.sh?)"
  if kill -0 "$pid" 2>/dev/null; then echo "ok   process group $pid alive"; else echo "FAIL process $pid not running"; ok=0; fi
  # The port must be held by a process in OUR process group, not some other server.
  local holder; holder="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
  if [[ -n "$holder" ]] && [[ "$(ps -o pgid= -p "$holder" | tr -d ' ')" == "$pid" ]]; then
    echo "ok   port $port held by pid $holder (pgid $pid)"
  else echo "FAIL port $port not held by our process group (holder: ${holder:-none})"; ok=0; fi
  local hz; hz="$(curl -sS -w ' %{http_code}' "http://127.0.0.1:$port/healthz" 2>&1 || true)"
  if [[ "$hz" == '{"status":"ok"} 200' ]]; then echo "ok   /healthz -> $hz"; else echo "FAIL /healthz -> $hz"; ok=0; fi
  # Build identity: the BUILD_ID on disk must be the one the server references in its HTML.
  local bid; bid="$(cat "$d/app/.next/BUILD_ID" 2>/dev/null || echo missing)"
  if curl -fsS "http://127.0.0.1:$port/" 2>/dev/null | grep -q "$bid"; then echo "ok   serving build $bid"
  else echo "FAIL served HTML does not reference build $bid"; ok=0; fi
  echo "info source $(cat "$d/state/source-rev")  url http://127.0.0.1:$port  evidence $d/evidence"
  [[ $ok == 1 ]] || exit 1
}

cmd_get() {
  local d; d="$(run_dir "$1")"; local path="$2" name="$3"
  local out="$d/evidence/$name"
  curl -sS -D "$out.headers" -o "$out.body" -w '%{http_code}\n' "$(base_url "$1")$path" > "$out.status"
  printf 'GET %s -> %s (headers %s, body %s)\n' "$path" "$(cat "$out.status")" "$out.headers" "$out.body"
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

cmd_cleanup() {
  local d; d="$(run_dir "$1")"
  [[ -d "$d" ]] || die "no run at $d"
  local pid; pid="$(cat "$d/state/pid" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.25; done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -rf "$d/app" "$d/state/pid" "$d/state"/ffprofile.*
  echo "stopped run $1; evidence kept in $d/evidence ; logs in $d/state"
}

case "${1:-}" in
  launch)  shift; cmd_launch "$@" ;;
  doctor)  shift; cmd_doctor "$@" ;;
  url)     shift; echo "$(base_url "$1")${2:-}" ;;
  get)     shift; [[ $# == 3 ]] || die "usage: get RUN_ID PATH NAME"; cmd_get "$@" ;;
  shot)    shift; [[ $# == 3 ]] || die "usage: shot RUN_ID PATH NAME"; cmd_shot "$@" ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
