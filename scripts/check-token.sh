#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:5100}"
TOKEN_FILE=""
declare -a TOKENS=()

usage() {
  cat <<'EOF'
Usage:
  scripts/check-token.sh [options] [token1 token2 ...]

Options:
  -u, --url <base_url>     API base URL (default: http://127.0.0.1:5100)
  -f, --file <path>        Token file path (one token per line, '#' for comments)
  -h, --help               Show this help

Env:
  BASE_URL                 Same as --url
  TOKEN_LIST               Comma-separated tokens (used when no args/file provided)
EOF
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

mask_token() {
  local token="$1"
  local n=${#token}
  if (( n <= 10 )); then
    printf '%s' '***'
    return
  fi
  printf '%s...%s' "${token:0:4}" "${token: -4}"
}

parse_live() {
  local body="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.live // empty' <<<"$body"
    return
  fi
  node -e '
    let data = "";
    process.stdin.on("data", (c) => data += c);
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (typeof parsed.live === "boolean") process.stdout.write(String(parsed.live));
      } catch (_) {}
    });
  ' <<<"$body"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url)
      BASE_URL="$2"
      shift 2
      ;;
    -f|--file)
      TOKEN_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      TOKENS+=("$1")
      shift
      ;;
  esac
done

if [[ -n "$TOKEN_FILE" ]]; then
  if [[ ! -f "$TOKEN_FILE" ]]; then
    echo "Token file not found: $TOKEN_FILE" >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    TOKENS+=("$line")
  done < "$TOKEN_FILE"
fi

if (( ${#TOKENS[@]} == 0 )) && [[ -n "${TOKEN_LIST:-}" ]]; then
  IFS=',' read -r -a from_env <<<"${TOKEN_LIST}"
  for token in "${from_env[@]}"; do
    token="${token#"${token%%[![:space:]]*}"}"
    token="${token%"${token##*[![:space:]]}"}"
    [[ -n "$token" ]] && TOKENS+=("$token")
  done
fi

if (( ${#TOKENS[@]} == 0 )); then
  echo "No tokens provided. Use args, --file, or TOKEN_LIST." >&2
  exit 1
fi

echo "Checking ${#TOKENS[@]} token(s) against ${BASE_URL%/}/token/check"

invalid=0
request_errors=0

for token in "${TOKENS[@]}"; do
  payload="{\"token\":\"$(json_escape "$token")\"}"
  response=""
  if ! response="$(curl -sS --max-time 20 \
    -X POST "${BASE_URL%/}/token/check" \
    -H "Content-Type: application/json" \
    -d "$payload")"; then
    request_errors=$((request_errors + 1))
    echo "[ERROR] $(mask_token "$token") request failed"
    continue
  fi

  live="$(parse_live "$response")"
  if [[ "$live" == "true" ]]; then
    echo "[OK]    $(mask_token "$token") live=true"
  else
    invalid=$((invalid + 1))
    echo "[FAIL]  $(mask_token "$token") live=false response=${response}"
  fi
done

echo "Summary: total=${#TOKENS[@]} invalid=${invalid} request_errors=${request_errors}"

if (( request_errors > 0 )); then
  exit 3
fi
if (( invalid > 0 )); then
  exit 2
fi
exit 0
