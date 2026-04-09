#!/usr/bin/env bash
# =============================================================================
# sync-ad-to-localstack.sh
#
# Mirrors users and groups from Samba AD → LocalStack IAM.
# Works with both k3d (Kubernetes) and docker-compose.
# Compatible with macOS bash 3.2+.
#
# Prerequisites:  brew install openldap awscli
# Usage:
#   ./scripts/sync-ad-to-localstack.sh          # auto-detect
#   ./scripts/sync-ad-to-localstack.sh --k8s    # force k3d mode
#   ./scripts/sync-ad-to-localstack.sh --compose
# =============================================================================

NS="corp-local"
LDAP_HOST="127.0.0.1"
LDAP_PORT="3389"
LDAP_BIND_DN="CN=Administrator,CN=Users,DC=corp,DC=local"
LDAP_BIND_PASS="Admin@Corp#1234"
LDAP_BASE_DN="CN=Users,DC=corp,DC=local"
LOCALSTACK_PORT="4566"
LOCALSTACK_ENDPOINT="http://127.0.0.1:${LOCALSTACK_PORT}"

export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"
export AWS_DEFAULT_REGION="us-east-1"

PF_SAMBA_PID=""
PF_LOCALSTACK_PID=""
TMPFILE=""

log()  { echo "[+] $*"; }
warn() { echo "[!] $*"; }
lsaws() { aws --endpoint-url="$LOCALSTACK_ENDPOINT" "$@"; }

cleanup() {
  [ -n "$PF_SAMBA_PID" ]      && kill "$PF_SAMBA_PID"      2>/dev/null
  [ -n "$PF_LOCALSTACK_PID" ] && kill "$PF_LOCALSTACK_PID" 2>/dev/null
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
  return 0
}
trap cleanup EXIT

check_deps() {
  for cmd in ldapsearch aws; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "[ERROR] $cmd not found. brew install openldap awscli"; exit 1; }
  done
}

detect_mode() {
  case "${1:-}" in
    --compose) echo "compose"; return ;;
    --k8s)     echo "k8s";     return ;;
  esac
  kubectl get namespace "$NS" >/dev/null 2>&1 && echo "k8s" || echo "compose"
}

start_portforwards() {
  log "Opening port-forward: samba:389 → localhost:${LDAP_PORT}"
  kubectl port-forward -n "$NS" svc/samba "${LDAP_PORT}:389" >/dev/null 2>&1 &
  PF_SAMBA_PID=$!

  log "Opening port-forward: localstack:4566 → localhost:${LOCALSTACK_PORT}"
  kubectl port-forward -n "$NS" svc/localstack "${LOCALSTACK_PORT}:4566" >/dev/null 2>&1 &
  PF_LOCALSTACK_PID=$!

  log "Waiting for port-forwards to be ready..."
  sleep 5

  ldapsearch -x -H "ldap://${LDAP_HOST}:${LDAP_PORT}" \
    -D "$LDAP_BIND_DN" -w "$LDAP_BIND_PASS" \
    -b "$LDAP_BASE_DN" "(objectClass=*)" dn >/dev/null 2>&1 \
    || { echo "[ERROR] Cannot reach Samba AD. kubectl get pods -n $NS"; exit 1; }

  curl -sf "http://127.0.0.1:${LOCALSTACK_PORT}/_localstack/health" >/dev/null 2>&1 \
    || { echo "[ERROR] Cannot reach LocalStack. kubectl get pods -n $NS"; exit 1; }

  log "Port-forwards ready."
}

setup_compose_mode() {
  LDAP_PORT="389"
  LOCALSTACK_PORT="4566"
  LOCALSTACK_ENDPOINT="http://127.0.0.1:${LOCALSTACK_PORT}"

  ldapsearch -x -H "ldap://${LDAP_HOST}:${LDAP_PORT}" \
    -D "$LDAP_BIND_DN" -w "$LDAP_BIND_PASS" \
    -b "$LDAP_BASE_DN" "(objectClass=*)" dn >/dev/null 2>&1 \
    || { echo "[ERROR] Cannot reach Samba AD at :389. docker compose up?"; exit 1; }

  curl -sf "http://127.0.0.1:${LOCALSTACK_PORT}/_localstack/health" >/dev/null 2>&1 \
    || { echo "[ERROR] Cannot reach LocalStack at :4566. docker compose up?"; exit 1; }
}

# ── ldap query → tempfile ─────────────────────────────────────────────────────
ldap_query() {
  # Usage: ldap_query <filter> <attr> [grep_pattern_to_exclude]
  local filter="$1" attr="$2" exclude="${3:-NOMATCH_PLACEHOLDER}"
  ldapsearch -x \
    -H "ldap://${LDAP_HOST}:${LDAP_PORT}" \
    -D "$LDAP_BIND_DN" -w "$LDAP_BIND_PASS" \
    -b "$LDAP_BASE_DN" "$filter" "$attr" 2>/dev/null \
    | grep "^${attr}:" | sed "s/^${attr}: //" \
    | grep -Ev "$exclude" > "$TMPFILE"
}

# ── Sync users ────────────────────────────────────────────────────────────────
sync_users() {
  log "Fetching users from Samba AD..."
  ldap_query \
    "(&(objectClass=user)(objectCategory=person))" \
    "sAMAccountName" \
    "^(Administrator|Guest|krbtgt)$"

  local count
  count=$(wc -l < "$TMPFILE" | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    warn "No users found in AD."
    return
  fi

  log "Found $count users"

  while IFS= read -r username; do
    [ -z "$username" ] && continue
    if lsaws iam get-user --user-name "$username" >/dev/null 2>&1; then
      warn "  IAM user '$username' already exists — skipping."
    else
      log "  Creating IAM user: $username"
      lsaws iam create-user --user-name "$username" \
        --tags Key=Source,Value=SambaAD Key=Realm,Value=corp.local \
        >/dev/null
    fi
  done < "$TMPFILE"
}

# ── System groups to exclude ──────────────────────────────────────────────────
SYS_GROUPS="^(Domain Users|Domain Admins|Domain Guests|Domain Computers|Schema Admins|Enterprise Admins|Group Policy Creator Owners|DnsAdmins|DnsUpdateProxy|RAS and IAS Servers|Allowed RODC Password Replication Group|Denied RODC Password Replication Group|Read-only Domain Controllers|Enterprise Read-only Domain Controllers|Cert Publishers|Domain Controllers|Remote Desktop Users|Network Configuration Operators|Performance Monitor Users|Performance Log Users|Distributed COM Users|IIS_IUSRS|Cryptographic Operators|Event Log Readers|Certificate Service DCOM Access|Terminal Server License Servers|Windows Authorization Access Group|Cloneable Domain Controllers|Protected Users|Key Admins|Enterprise Key Admins)$"

# ── Sync groups ───────────────────────────────────────────────────────────────
sync_groups() {
  log "Fetching groups from Samba AD..."
  ldap_query "(objectClass=group)" "cn" "$SYS_GROUPS"

  local count
  count=$(wc -l < "$TMPFILE" | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    warn "No custom groups found in AD."
    return
  fi

  log "Found $count custom group(s)"

  local grouplist
  grouplist=$(cat "$TMPFILE")

  echo "$grouplist" | while IFS= read -r group; do
    [ -z "$group" ] && continue
    local iam_group
    iam_group=$(echo "$group" | tr ' ' '-')

    if lsaws iam get-group --group-name "$iam_group" >/dev/null 2>&1; then
      warn "  IAM group '$iam_group' already exists — skipping."
    else
      log "  Creating IAM group: $iam_group"
      lsaws iam create-group --group-name "$iam_group" >/dev/null
    fi

    lsaws iam attach-group-policy \
      --group-name "$iam_group" \
      --policy-arn "arn:aws:iam::aws:policy/ReadOnlyAccess" >/dev/null 2>&1 || true

    sync_group_members "$group" "$iam_group"
  done
}

# ── Sync group members ────────────────────────────────────────────────────────
sync_group_members() {
  local ad_group="$1" iam_group="$2"

  ldap_query \
    "(&(objectClass=user)(memberOf=CN=${ad_group},CN=Users,DC=corp,DC=local))" \
    "sAMAccountName"

  while IFS= read -r member; do
    [ -z "$member" ] && continue
    log "    Adding $member → $iam_group"
    lsaws iam add-user-to-group \
      --user-name "$member" \
      --group-name "$iam_group" >/dev/null 2>&1 || true
  done < "$TMPFILE"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  local mode
  mode=$(detect_mode "${1:-}")
  TMPFILE=$(mktemp)

  echo "════════════════════════════════════════════════════════"
  echo "  Samba AD → LocalStack IAM Sync  [mode: $mode]"
  echo "════════════════════════════════════════════════════════"
  echo ""

  check_deps

  if [ "$mode" = "k8s" ]; then
    start_portforwards
  else
    setup_compose_mode
  fi

  sync_users
  sync_groups

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Sync complete. Verify:"
  echo ""
  echo "  aws --endpoint-url=$LOCALSTACK_ENDPOINT iam list-users"
  echo "  aws --endpoint-url=$LOCALSTACK_ENDPOINT iam list-groups"
  echo "════════════════════════════════════════════════════════"
}

main "$@"
