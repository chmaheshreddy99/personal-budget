#!/usr/bin/env bash
#
# Personal Budget - start / stop / restart / status / logs, for Git Bash on Windows (also works on Linux / macOS).
#
#   ./app.sh start [--build] [--fg]   start the jar in the background (--build: build it first, --fg: run in this window)
#   ./app.sh stop                     stop it (gently first, then forced after STOP_TIMEOUT seconds)
#   ./app.sh restart [--build]        stop, then start
#   ./app.sh status                   running or not: PID, port, uptime, memory, health, jar, log
#   ./app.sh logs [-n N] [--no-follow] [--errors]
#                                     follow the log (last N lines first); --errors: only WARN / ERROR / exceptions
#   ./app.sh build                    build the jar with Gradle (bootJar)
#
#   ./app.sh share [--url URL] [--auth user:pass] [--takeover]
#                                     share the app on the internet through ngrok (starts the app first if needed);
#                                     prints the public address (and the mobile one) and copies it to the clipboard
#                                     --takeover: stop any other ngrok first (your address can be online only once)
#   ./app.sh unshare                  stop sharing (the app keeps running)
#   ./app.sh url                      the public address while shared
#   ./app.sh start --share            start and share in one go (restart keeps sharing if it was shared)
#   ./app.sh logs --ngrok             the ngrok log instead of the app's
#   ./app.sh help
#
# Files (all under the application root, next to this script):
#   run/app.pid          the process id (Windows PID and Git Bash PID)
#   run/ngrok.pid        the ngrok process id, run/ngrok.url its public address
#   logs/app.log         the current log; the previous runs are kept as logs/app-<date>-<time>.log (newest LOG_KEEP)
#   logs/ngrok.log       the ngrok log of the current share
#
# Settings: environment variables, or put them in app.conf next to this script (it is sourced, KEY=value lines):
#   APP_PORT        port to listen on               (default: server.port of application.yml, else 8080)
#   JAVA_OPTS       JVM options                     (default: -Xms128m -Xmx512m -XX:+UseG1GC)
#   APP_ARGS        extra Spring Boot arguments     (e.g. --budget.data-dir=D:/budget-data)
#   JAVA_HOME       the JDK / JRE to use            (default: java on the PATH)
#   START_TIMEOUT   seconds to wait for the app to answer   (default 90)
#   STOP_TIMEOUT    seconds to wait for a gentle stop       (default 20)
#   LOG_KEEP        old log files to keep                   (default 10)
#   NGROK           path to ngrok                           (default: ngrok/ngrok.exe or ngrok.exe here, else on the PATH)
#   NGROK_URL       a fixed address you own on ngrok, e.g. https://my-budget.ngrok-free.app (default: a new one)
#   NGROK_AUTH      user:password asked by ngrok before anyone reaches the app (optional, extra protection)
#   NGROK_AUTHTOKEN your ngrok token, if it is not saved yet (ngrok config add-authtoken <token>)

set -u

# ---------------------------------------------------------------- where things are
APP_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_HOME" || exit 1
APP_NAME="personal-budget"
RUN_DIR="$APP_HOME/run"
LOG_DIR="$APP_HOME/logs"
PID_FILE="$RUN_DIR/app.pid"
LOG_FILE="$LOG_DIR/app.log"
NGROK_PID_FILE="$RUN_DIR/ngrok.pid"
NGROK_URL_FILE="$RUN_DIR/ngrok.url"
NGROK_LOG="$LOG_DIR/ngrok.log"
NGROK_POLICY="$RUN_DIR/ngrok-policy.yml"

[ -f "$APP_HOME/app.conf" ] && . "$APP_HOME/app.conf"

JAVA_OPTS="${JAVA_OPTS:--Xms128m -Xmx512m -XX:+UseG1GC}"
APP_ARGS="${APP_ARGS:-}"
START_TIMEOUT="${START_TIMEOUT:-90}"
STOP_TIMEOUT="${STOP_TIMEOUT:-20}"
LOG_KEEP="${LOG_KEEP:-10}"
NGROK_URL="${NGROK_URL:-}"
NGROK_AUTH="${NGROK_AUTH:-}"

IS_WINDOWS=false
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=true ;; esac

# ---------------------------------------------------------------- output
if [ -t 1 ]; then
    C_RED=$'\e[31m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_BLUE=$'\e[36m'; C_DIM=$'\e[2m'; C_BOLD=$'\e[1m'; C_OFF=$'\e[0m'
else
    C_RED=; C_GREEN=; C_YELLOW=; C_BLUE=; C_DIM=; C_BOLD=; C_OFF=
fi
info()  { printf '%s\n' "${C_BLUE}•${C_OFF} $*"; }
ok()    { printf '%s\n' "${C_GREEN}✔${C_OFF} $*"; }
warn()  { printf '%s\n' "${C_YELLOW}!${C_OFF} $*"; }
fail()  { printf '%s\n' "${C_RED}✘${C_OFF} $*" >&2; }
die()   { fail "$*"; exit 1; }

# ---------------------------------------------------------------- settings worked out
java_cmd() {
    if [ -n "${JAVA_HOME:-}" ]; then
        local home="$JAVA_HOME"
        $IS_WINDOWS && command -v cygpath >/dev/null && home="$(cygpath -u "$JAVA_HOME")"
        if [ -x "$home/bin/java" ] || [ -x "$home/bin/java.exe" ]; then echo "$home/bin/java"; return; fi
    fi
    command -v java >/dev/null 2>&1 && { echo java; return; }
    die "Java not found: install JDK 21 or set JAVA_HOME"
}

app_port() {
    if [ -n "${APP_PORT:-}" ]; then echo "$APP_PORT"; return; fi
    local yml="$APP_HOME/src/main/resources/application.yml" port=""
    # server:\n  port: 8080  (the first "port:" right under "server:")
    [ -f "$yml" ] && port="$(awk '/^server:/{s=1;next} s&&/^[^ ]/{s=0} s&&/^[ ]+port:/{gsub(/[^0-9]/,"",$2);print $2;exit}' "$yml")"
    echo "${port:-8080}"
}

find_jar() {
    ls -t "$APP_HOME"/build/libs/"$APP_NAME"-*.jar 2>/dev/null | grep -v -- '-plain\.jar$' | head -n 1
}

# ---------------------------------------------------------------- the process
# The PID file holds "<windows pid> <bash pid>". On Windows the Windows PID is the reliable one: it survives
# closing this terminal, and taskkill / tasklist understand it.
read_pids() {
    WIN_PID=""; SH_PID=""
    [ -f "$PID_FILE" ] || return 1
    read -r WIN_PID SH_PID < "$PID_FILE" || true
    [ -n "$WIN_PID" ]
}

alive() {   # $1: pid (Windows pid on Windows), $2: program name to expect (java)
    [ -n "${1:-}" ] || return 1
    if $IS_WINDOWS; then
        tasklist //FI "PID eq $1" //NH 2>/dev/null | grep -qi "${2:-java}"
    else
        kill -0 "$1" 2>/dev/null
    fi
}

running_pid() {   # prints the pid when running, cleans up a stale PID file otherwise
    if read_pids && alive "$WIN_PID"; then echo "$WIN_PID"; return 0; fi
    [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
    return 1
}

port_owner() {   # the pid listening on the port, if any
    local port="$1"
    if $IS_WINDOWS; then
        netstat -ano 2>/dev/null | awk -v p=":$port" '$2 ~ p"$" && $4 == "LISTENING" {print $5; exit}'
    elif command -v lsof >/dev/null; then
        lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
    fi
}

http_ok() {   # the app answers on the port
    local port="$1"
    if command -v curl >/dev/null; then
        curl -s -o /dev/null -m 3 -w '%{http_code}' "http://localhost:$port/" 2>/dev/null | grep -q '^[23]'
    else
        [ -n "$(port_owner "$port")" ]
    fi
}

rotate_logs() {
    mkdir -p "$LOG_DIR"
    if [ -s "$LOG_FILE" ]; then
        mv "$LOG_FILE" "$LOG_DIR/app-$(date +%Y%m%d-%H%M%S).log"
    fi
    # keep the newest LOG_KEEP old logs
    ls -t "$LOG_DIR"/app-*.log 2>/dev/null | tail -n +"$((LOG_KEEP + 1))" | while read -r old; do rm -f "$old"; done
}

# ---------------------------------------------------------------- commands
cmd_build() {
    info "Building the jar (gradlew bootJar)…"
    local gradle="./gradlew"
    [ -x "$gradle" ] || gradle="sh ./gradlew"
    $gradle bootJar -q || die "Build failed"
    ok "Built $(basename "$(find_jar)")"
}

cmd_start() {
    local build=false fg=false share=false
    for a in "$@"; do
        case "$a" in --build) build=true ;; --fg|--foreground) fg=true ;; --share) share=true ;; *) die "Unknown option for start: $a" ;; esac
    done
    local pid
    if pid="$(running_pid)"; then
        warn "Already running (PID $pid) on port $(app_port)"
        $share && cmd_share
        return 0
    fi

    local jar
    jar="$(find_jar)"
    if $build || [ -z "$jar" ]; then cmd_build; jar="$(find_jar)"; fi
    [ -n "$jar" ] || die "No jar in build/libs: run ./app.sh build"
    # warn when the sources are newer than the jar
    if [ -n "$(find "$APP_HOME/src" -newer "$jar" -type f -print -quit 2>/dev/null)" ]; then
        warn "Sources changed after $(basename "$jar") was built: use ./app.sh restart --build to include them"
    fi

    local port java owner
    port="$(app_port)"
    java="$(java_cmd)"
    owner="$(port_owner "$port")"
    [ -n "$owner" ] && die "Port $port is already in use by PID $owner (another copy? see: tasklist //FI \"PID eq $owner\")"

    mkdir -p "$RUN_DIR" "$LOG_DIR"
    local jar_arg="$jar"
    $IS_WINDOWS && command -v cygpath >/dev/null && jar_arg="$(cygpath -w "$jar")"
    # shellcheck disable=SC2086
    local cmd=("$java" $JAVA_OPTS -Dfile.encoding=UTF-8 -jar "$jar_arg" --server.port="$port" $APP_ARGS)

    if $fg; then
        info "Running in this window on port $port (Ctrl+C stops it)"
        exec "${cmd[@]}"
    fi

    rotate_logs
    {
        echo "==== $(date '+%Y-%m-%d %H:%M:%S') starting $(basename "$jar") on port $port"
        echo "==== ${cmd[*]}"
    } > "$LOG_FILE"
    nohup "${cmd[@]}" >> "$LOG_FILE" 2>&1 < /dev/null &
    local sh_pid=$! win_pid=$!
    if $IS_WINDOWS; then
        # Git Bash forks first and becomes java.exe a moment later: wait until the Windows PID is java's
        local tries=0
        while [ "$tries" -lt 100 ]; do
            [ -r "/proc/$sh_pid/winpid" ] && win_pid="$(cat "/proc/$sh_pid/winpid" 2>/dev/null)"
            alive "$win_pid" && break
            kill -0 "$sh_pid" 2>/dev/null || break   # it ended already: reported below
            sleep 0.1
            tries=$((tries + 1))
        done
    fi
    disown "$sh_pid" 2>/dev/null || true
    echo "$win_pid $sh_pid" > "$PID_FILE"

    info "Starting $(basename "$jar") on port $port (PID $win_pid), log: logs/app.log"
    local waited=0
    while [ "$waited" -lt "$START_TIMEOUT" ]; do
        if ! alive "$win_pid" && ! kill -0 "$sh_pid" 2>/dev/null; then
            fail "It stopped while starting. Last lines of the log:"
            tail -n 25 "$LOG_FILE" | sed 's/^/    /'
            rm -f "$PID_FILE"
            exit 1
        fi
        if http_ok "$port"; then
            echo
            ok "Running: ${C_BOLD}http://localhost:$port${C_OFF} (PID $win_pid, ready in ${waited}s)"
            $share && cmd_share
            return 0
        fi
        printf '.'
        sleep 1
        waited=$((waited + 1))
    done
    echo
    warn "Still not answering after ${START_TIMEOUT}s; it may need longer. Check: ./app.sh logs"
}

cmd_stop() {
    local pid
    ngrok_pid >/dev/null && cmd_unshare   # nothing to share without the app
    if ! pid="$(running_pid)"; then info "Not running"; return 0; fi
    read_pids
    info "Stopping PID $pid…"
    # gently first: lets Spring finish requests and close the data files
    if [ -n "$SH_PID" ] && kill -0 "$SH_PID" 2>/dev/null; then kill -TERM "$SH_PID" 2>/dev/null; fi
    $IS_WINDOWS || kill -TERM "$pid" 2>/dev/null
    local waited=0
    while alive "$pid" && [ "$waited" -lt "$STOP_TIMEOUT" ]; do sleep 1; waited=$((waited + 1)); printf '.'; done
    [ "$waited" -gt 0 ] && echo
    if alive "$pid"; then
        warn "Did not stop within ${STOP_TIMEOUT}s: forcing it"
        if $IS_WINDOWS; then taskkill //F //T //PID "$pid" > /dev/null 2>&1; else kill -KILL "$pid" 2>/dev/null; fi
        sleep 1
    fi
    if alive "$pid"; then die "Could not stop PID $pid"; fi
    rm -f "$PID_FILE"
    echo "==== $(date '+%Y-%m-%d %H:%M:%S') stopped" >> "$LOG_FILE" 2>/dev/null
    ok "Stopped"
}

cmd_restart() {
    local build=false
    for a in "$@"; do case "$a" in --build) build=true ;; *) die "Unknown option for restart: $a" ;; esac; done
    $build && cmd_build    # build before stopping: a failed build keeps the running app up
    local was_shared=false
    ngrok_pid >/dev/null && was_shared=true
    cmd_stop
    if $was_shared; then cmd_start --share; else cmd_start; fi
}

cmd_status() {
    local port pid jar
    port="$(app_port)"
    jar="$(find_jar)"
    if pid="$(running_pid)"; then
        local started="" mem=""
        if $IS_WINDOWS; then
            mem="$(tasklist //FI "PID eq $pid" //FO CSV //NH 2>/dev/null | awk -F'","' '{gsub(/"/,"",$5); print $5}' | head -n 1)"
            started="$(powershell.exe -NoProfile -Command "(Get-Process -Id $pid).StartTime.ToString('yyyy-MM-dd HH:mm:ss')" 2>/dev/null | tr -d '\r')"
        else
            mem="$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.0f MB", $1/1024}')"
            started="$(ps -o lstart= -p "$pid" 2>/dev/null)"
        fi
        local health="${C_YELLOW}not answering yet${C_OFF}"
        http_ok "$port" && health="${C_GREEN}answering${C_OFF}"
        printf '%s\n' "${C_GREEN}●${C_OFF} ${C_BOLD}$APP_NAME is running${C_OFF}"
        printf '  %-9s %s\n' "PID" "$pid" "URL" "http://localhost:$port" "Health" "$health" \
            "Started" "${started:-?}" "Memory" "${mem:-?}" "Jar" "$(basename "${jar:-?}")" "Log" "logs/app.log ($(du -h "$LOG_FILE" 2>/dev/null | cut -f1))"
        local npid
        if npid="$(ngrok_pid)"; then
            printf '  %-9s %s\n' "Shared" "${C_GREEN}$(cat "$NGROK_URL_FILE" 2>/dev/null || echo '?')${C_OFF} (ngrok PID $npid)"
        else
            printf '  %-9s %s\n' "Shared" "${C_DIM}no (./app.sh share)${C_OFF}"
        fi
        return 0
    fi
    printf '%s\n' "${C_RED}●${C_OFF} ${C_BOLD}$APP_NAME is stopped${C_OFF}"
    local owner
    owner="$(port_owner "$port")"
    [ -n "$owner" ] && warn "Port $port is in use by another process (PID $owner)"
    [ -f "$LOG_FILE" ] && printf '  %-9s %s\n' "Last log" "$(tail -n 1 "$LOG_FILE" | cut -c1-140)"
    return 3
}

cmd_logs() {
    local lines=200 follow=true errors=false file="$LOG_FILE"
    while [ $# -gt 0 ]; do
        case "$1" in
            --ngrok) file="$NGROK_LOG" ;;
            -n) lines="${2:?-n needs a number}"; shift ;;
            -n*) lines="${1#-n}" ;;
            --no-follow|-N) follow=false ;;
            --errors|-e) errors=true ;;
            *) die "Unknown option for logs: $1" ;;
        esac
        shift
    done
    [ -f "$file" ] || die "No log yet (logs/$(basename "$file"))"
    local filter='WARN|ERROR|Exception|Caused by|^\s+at |lvl=(warn|eror|crit)'
    if $errors; then
        if $follow; then tail -n "$lines" -F "$file" | grep --line-buffered -E "$filter"
        else grep -E "$filter" "$file" | tail -n "$lines"; fi
    elif $follow; then
        info "Following logs/$(basename "$file") (Ctrl+C to stop)"
        tail -n "$lines" -F "$file"
    else
        tail -n "$lines" "$file"
    fi
}

# ---------------------------------------------------------------- sharing through ngrok
ngrok_cmd() {
    if [ -n "${NGROK:-}" ]; then echo "$NGROK"; return; fi
    local c
    for c in "$APP_HOME/ngrok/ngrok.exe" "$APP_HOME/ngrok.exe" "$APP_HOME/ngrok/ngrok" "$APP_HOME/ngrok"; do
        [ -f "$c" ] && [ -x "$c" ] && { echo "$c"; return; }
    done
    command -v ngrok >/dev/null 2>&1 && { echo ngrok; return; }
    die "ngrok not found: put ngrok.exe in the ngrok folder (or set NGROK=path)"
}

ngrok_pid() {   # prints the ngrok pid when it runs, cleans up otherwise
    local pid=""
    [ -f "$NGROK_PID_FILE" ] && read -r pid _ < "$NGROK_PID_FILE"
    if [ -n "$pid" ] && alive "$pid" ngrok; then echo "$pid"; return 0; fi
    rm -f "$NGROK_PID_FILE" "$NGROK_URL_FILE"
    return 1
}

mobile_path() {   # the address of the mobile version, as set in the app (Settings), default m
    local f="$APP_HOME/data/app-settings.properties" m=""
    [ -f "$f" ] && m="$(sed -n 's/^mobile\.path=//p' "$f" | tr -d '\r' | head -n 1)"
    echo "${m:-m}"
}

cmd_share() {
    local url="$NGROK_URL" auth="$NGROK_AUTH" takeover=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --takeover) takeover=true ;;
            --url) url="${2:?--url needs an address}"; shift ;;
            --auth) auth="${2:?--auth needs user:password}"; shift ;;
            *) die "Unknown option for share: $1" ;;
        esac
        shift
    done
    local npid
    if npid="$(ngrok_pid)"; then ok "Already shared: ${C_BOLD}$(cat "$NGROK_URL_FILE" 2>/dev/null)${C_OFF} (ngrok PID $npid)"; return 0; fi
    running_pid >/dev/null || { info "The app is not running: starting it first"; cmd_start; }
    running_pid >/dev/null || die "The app did not start, nothing to share"

    # another ngrok (started by hand) holds the address: say so, or stop it with --takeover
    local others=""
    $IS_WINDOWS && others="$(tasklist //FI "IMAGENAME eq ngrok.exe" //NH 2>/dev/null | awk '/ngrok/ {print $2}' | tr '
' ' ')"
    if [ -n "${others// /}" ]; then
        if $takeover; then
            warn "Stopping the other ngrok (PID ${others% })"
            for o in $others; do taskkill //F //T //PID "$o" > /dev/null 2>&1; done
            sleep 2
        else
            warn "ngrok is already running (PID ${others% }), not started by this script: it may hold your address"
        fi
    fi

    local ngrok port
    ngrok="$(ngrok_cmd)"
    port="$(app_port)"
    mkdir -p "$RUN_DIR" "$LOG_DIR"
    : > "$NGROK_LOG"
    local args=(http "$port" --log "$(cygpath -w "$NGROK_LOG" 2>/dev/null || echo "$NGROK_LOG")" --log-format logfmt)
    [ -n "$url" ] && args+=(--url "$url")
    [ -n "${NGROK_AUTHTOKEN:-}" ] && args+=(--authtoken "$NGROK_AUTHTOKEN")
    if [ -n "$auth" ]; then
        case "$auth" in *:*) ;; *) die "--auth needs user:password" ;; esac
        # ngrok asks for this user and password before anything reaches the app
        printf 'on_http_request:\n  - actions:\n      - type: basic-auth\n        config:\n          credentials:\n            - "%s"\n' "$auth" > "$NGROK_POLICY"
        args+=(--traffic-policy-file "$(cygpath -w "$NGROK_POLICY" 2>/dev/null || echo "$NGROK_POLICY")")
    fi

    nohup "$ngrok" "${args[@]}" > /dev/null 2>&1 < /dev/null &
    local sh_pid=$! win_pid=$!
    if $IS_WINDOWS; then
        local tries=0
        while [ "$tries" -lt 100 ]; do
            [ -r "/proc/$sh_pid/winpid" ] && win_pid="$(cat "/proc/$sh_pid/winpid" 2>/dev/null)"
            alive "$win_pid" ngrok && break
            kill -0 "$sh_pid" 2>/dev/null || break
            sleep 0.1
            tries=$((tries + 1))
        done
    fi
    disown "$sh_pid" 2>/dev/null || true
    echo "$win_pid $sh_pid" > "$NGROK_PID_FILE"

    info "Opening a tunnel to port $port with ngrok…"
    local waited=0 public=""
    while [ "$waited" -lt 30 ]; do
        public="$(grep -o 'url=https://[^ ]*' "$NGROK_LOG" 2>/dev/null | head -n 1 | cut -d= -f2)"
        [ -n "$public" ] && break
        if grep -qE 'lvl=(eror|crit)|ERR_NGROK' "$NGROK_LOG" 2>/dev/null || ! { alive "$win_pid" ngrok || kill -0 "$sh_pid" 2>/dev/null; }; then
            local err
            err="$(grep -oE 'ERR_NGROK_[0-9]+' "$NGROK_LOG" | sort -u | head -n 1)"
            fail "ngrok could not open the tunnel ${err%% *}"
            grep -qE 'ERR_NGROK_(4018|105)|authtoken' "$NGROK_LOG" && warn "Save your token once: ./ngrok/ngrok.exe config add-authtoken <token> (from dashboard.ngrok.com)"
            grep -q 'ERR_NGROK_108' "$NGROK_LOG" && warn "Another ngrok is already running on this account: stop it, or use ./app.sh unshare"
            grep -qE 'ERR_NGROK_(313|15002|320)' "$NGROK_LOG" && warn "That address is not yours: drop --url, or reserve it on dashboard.ngrok.com"
            grep -q 'ERR_NGROK_334' "$NGROK_LOG" && warn "Your ngrok address is already online in another ngrok${others:+ (PID ${others% })}: close that one, or run ./app.sh share --takeover"
            taskkill //F //PID "$win_pid" > /dev/null 2>&1 || kill "$sh_pid" 2>/dev/null
            rm -f "$NGROK_PID_FILE"
            grep -E 'lvl=(eror|crit)' "$NGROK_LOG" | tail -n 2 | cut -c1-220 | sed 's/^/    /'
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done
    [ -n "$public" ] || { warn "No address after 30s; see ./app.sh logs --ngrok"; return 1; }
    echo "$public" > "$NGROK_URL_FILE"
    ok "Shared on the internet: ${C_BOLD}$public${C_OFF}"
    printf '  %-9s %s\n' "Mobile" "$public/$(mobile_path)/" "Inspect" "http://127.0.0.1:4040 (requests going through the tunnel)"
    [ -n "$auth" ] && printf '  %-9s %s\n' "Login" "ngrok asks for ${auth%%:*} / ******** first"
    if command -v clip.exe >/dev/null 2>&1; then printf '%s' "$public" | clip.exe && printf '  %-9s %s\n' "Copied" "the address is on the clipboard"; fi
    warn "Anyone with this address reaches your sign-in page: keep passwords strong, ./app.sh unshare when done"
}

cmd_unshare() {
    local pid
    if ! pid="$(ngrok_pid)"; then info "Not shared"; return 0; fi
    if $IS_WINDOWS; then taskkill //F //T //PID "$pid" > /dev/null 2>&1; else kill "$pid" 2>/dev/null; fi
    sleep 1
    alive "$pid" ngrok && die "Could not stop ngrok (PID $pid)"
    rm -f "$NGROK_PID_FILE" "$NGROK_URL_FILE" "$NGROK_POLICY"
    ok "No longer shared on the internet"
}

cmd_url() {
    ngrok_pid >/dev/null || { info "Not shared (./app.sh share)" >&2; return 3; }
    cat "$NGROK_URL_FILE"
}

cmd_help() {
    sed -n '3,42p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------- main
command="${1:-help}"
[ $# -gt 0 ] && shift
case "$command" in
    start)   cmd_start "$@" ;;
    stop)    cmd_stop ;;
    restart) cmd_restart "$@" ;;
    status)  cmd_status ;;
    logs|log) cmd_logs "$@" ;;
    build)   cmd_build ;;
    share)   cmd_share "$@" ;;
    unshare) cmd_unshare ;;
    url)     cmd_url ;;
    help|-h|--help) cmd_help ;;
    *) fail "Unknown command: $command"; cmd_help; exit 2 ;;
esac
