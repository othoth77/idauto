#!/usr/bin/env bash
# secret_scan_selftest.sh - proves the secret scanner still catches what it must and
# still lets documented placeholders through. CI runs it before scanning the repo, so a
# regex regression fails the build instead of silently weakening the gate.
#
# Every positive is assembled at run time from fragments, with clearly fake values
# (runs of one letter or digit, documentation-range addresses, example hostnames), so
# this file contains no complete token, key header, login line or public address
# and is not itself a finding when the scanner reads the repository.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SCAN=$HERE/secret_scan.sh
REAL_ALLOW=$HERE/../secret-scan-allow.txt
[[ -f $SCAN && -f $REAL_ALLOW ]] || { echo "selftest: scanner or allowlist missing" >&2; exit 2; }

W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

CHECKS=0 FAILS=0
check() { # description, then a command; passes when the command succeeds
  local desc=$1; shift
  CHECKS=$(( CHECKS + 1 ))
  if "$@"; then return 0; fi
  FAILS=$(( FAILS + 1 )); echo "selftest: FAIL - $desc" >&2
  if [[ -n ${SELFTEST_DEBUG-} ]]; then printf '%s\n' "$OUT" | head -12 | sed 's/^/    | /' >&2; fi
}

# ---- fragment helpers ------------------------------------------------------
rep()  { local n=$2 s; s=$(printf '%*s' "$n" ''); printf '%s' "${s// /$1}"; }   # rep CHAR COUNT
join() { local sep=$1; shift; local IFS=$sep; printf '%s' "$*"; }              # join SEP a b c
at()   { printf '%s@%s' "$1" "$2"; }                                           # at WORD HOST
dsn()  { printf '%s://%s:%s@%s' "$1" "$2" "$3" "$4"; }                         # dsn SCHEME USER PASS HOST

# ---- run helpers -----------------------------------------------------------
OUT="" RC=0
run() { RC=0; OUT=$("$@" 2>&1) || RC=$?; }
has_line() { [[ $OUT == *"  $1  [$2]"* ]]; }                                    # has_line LOC:LINE RULE
lacks()    { [[ $OUT != *"$1"* ]]; }

# ---- 1. positives: one file per case, a single scan, per-file rule assertions
P=$W/pos; mkdir -p "$P/.github"; cp "$REAL_ALLOW" "$P/.github/secret-scan-allow.txt"
declare -a EXPECT_FILE=() EXPECT_RULE=() PROBES=()
n=0
pos() { # rule content [probe] [filename-ext]
  n=$(( n + 1 ))
  local f; f=$(printf 'pos_%03d.%s' "$n" "${4:-txt}")
  printf '%s\n' "$2" >"$P/$f"
  EXPECT_FILE+=("$f"); EXPECT_RULE+=("$1")
  if [[ -n ${3-} ]]; then PROBES+=("$3"); fi
}

A36=$(rep A 36)
for p in p o u s r; do pos github-token "gh${p}_$A36" "$A36"; done
pos github-token "token: gh$(printf p)_$(rep Z 40)" "$(rep Z 40)" md
pos github-pat "github_pat_$(rep B 30)" "$(rep B 30)"
for c in b a p r s; do pos slack-token "xox${c}-$(rep 1 12)-$(rep 2 12)" "$(rep 1 12)"; done
pos aws-access-key "id = AKIA$(rep A 16)" "$(rep A 16)"
pos aws-access-key "ASIA$(rep Q 16)" "$(rep Q 16)"
pos google-api-key "key: AIza$(rep B 35)" "$(rep B 35)"
pos stripe-live-key "sk_live_$(rep D 24)" "$(rep D 24)"
pos stripe-live-key "rk_live_$(rep E 24)" "$(rep E 24)"
pos bearer-token "Authorization: Bearer $(rep 7 30)" "$(rep 7 30)"
pos bearer-token "authorization: BEARER $(rep 8 30)" "$(rep 8 30)" md
for hdr in "" "RSA " "EC " "DSA " "OPENSSH " "ENCRYPTED "; do
  pos private-key "$(printf -- '-----BEGIN %sPRIVATE KEY-----' "$hdr")"
done
pos private-key "$(printf -- '-----BEGIN %s-----' 'PGP PRIVATE KEY BLOCK')"
pos login-at-ipv4 "ssh -L 3999:127.0.0.1:3999 $(at user "$(join . 203 0 113 9)")" "$(join . 203 0 113 9)"
pos ssh-login     "ssh -L 3999:127.0.0.1:3999 $(at user "$(join . 203 0 113 9)")"
pos ssh-login "scp -n backup.json $(at builder db.internal.corp):/srv"      # the original [^\n] bug
pos ssh-login "rsync -avn ./out/ $(at ops files.internal.corp):/srv"
pos ssh-login "sftp $(at admin box)"
pos ssh-login "SSH $(at admin box.internal.corp)"
pos public-ipv4 "dns: $(join . 8 8 8 8)" "$(join . 8 8 8 8)"
pos public-ipv4 "dns: $(join . 172 32 0 1)"
pos public-ipv4 "dns: $(printf '%s[.]%s[.]%s[.]%s' 8 8 4 4)"                # defanged
pos public-ipv4 "re: $(printf '%s\\.%s\\.%s\\.%s' 8 8 4 4)"                 # regex-escaped
pos public-ipv4-host "host: ip-$(join - 8 8 4 4).example.invalid"
# R2: an address next to an allowed one, or behind a URL escape, must not hide
pos public-ipv4 "hosts: $(join . 127 0 0 1),$(join . 8 8 8 8)"
pos public-ipv4 "hosts: $(join . 127 0 0 1) $(join . 8 8 8 8)"
pos public-ipv4 "hosts: $(join . 10 0 0 1);$(join . 8 8 8 8)"
pos public-ipv4 "next=http://$(at u "$(join . 8 8 8 8)")/" "" txt
pos public-ipv4 "q=$(printf 'user%s%s' '%40' "$(join . 8 8 8 8)")"
pos login-at-ipv4 "q=$(printf 'user%s%s' '%40' "$(join . 203 0 113 9)")"
# F2: double and triple URL-encoding
pos public-ipv4 "q=$(printf 'user%s%s' '%2540' "$(join . 8 8 8 8)")"
pos login-at-ipv4 "q=$(printf 'user%s%s' '%2540' "$(join . 203 0 113 9)")"
pos public-ipv4 "q=$(printf '8%s8%s8%s8' '%252E' '%252e' '%252E')"
pos public-ipv4 "q=$(printf '8%s8%s8%s8' '%25252E' '%25252E' '%25252E')"
pos ssh-login "$(printf 'ssh admin%s%s' '%2540' box.internal.corp)"
pos public-ipv4 "q=$(printf 'a%s%s' '%20' "$(join . 8 8 8 8)")"
pos public-ipv4 "q=$(printf '8%s8%s8%s8' '%2E' '%2e' '%2E')"
pos ssh-login "$(printf 'ssh admin%s%s' '%40' box.internal.corp)"
pos aws-access-key "AKIAIOSFODNN7EXAMPLE AKIA$(rep Z 16)" "$(rep Z 16)"
pos aws-access-key "AKIAIOSFODNN7EXAMPLE,ASIA$(rep Y 16)" "$(rep Y 16)"
pos google-api-key "x AIza$(rep B 35) AIza$(rep C 35)" "$(rep C 35)"
pos db-url-credentials "$(dsn postgres app Xk9mPq2LrT db.internal.corp)/x" Xk9mPq2LrT
pos db-url-credentials "$(dsn postgresql app Xk9mPq2LrT db.internal.corp)/x"
pos db-url-credentials "$(dsn mysql app Xk9mPq2LrT db.internal.corp)/x"
pos db-url-credentials "$(dsn mongodb app Xk9mPq2LrT db.internal.corp)/x"
pos db-url-credentials "$(dsn 'mongodb+srv' app Xk9mPq2LrT db.internal.corp)/x"
pos db-url-credentials "$(dsn redis '' Xk9mPq2LrT cache.internal.corp)/0"
pos db-url-credentials "$(dsn rediss '' Xk9mPq2LrT cache.internal.corp)/0"
pos db-url-credentials "$(dsn amqp app Xk9mPq2LrT mq.internal.corp)/v"
pos db-url-credentials "$(dsn amqps app Xk9mPq2LrT mq.internal.corp)/v"
pos basic-auth-url "curl $(dsn https app Xk9mPq2LrT api.internal.corp)/v1"
pos env-assignment "$(printf '%s=%s' DB_PASSWORD Sup3rS3cretValue)" Sup3rS3cretValue env
pos env-assignment "export $(printf '%s=%s' API_KEY abcdef0123456789)" abcdef0123456789 env
pos env-assignment "$(printf '%s=%s' client_secret 'Zq8wLm3nVb7c')" Zq8wLm3nVb7c md
pos env-assignment "$(printf '%s="%s"' AUTH_TOKEN Zq8wLm3nVb7c)" "" sh
pos credential-literal "$(printf "%s: '%s'," db_password Sup3rS3cretValue)" "" js
pos credential-literal "$(printf '"%s": "%s"' apiKey Sup3rS3cretValue)" "" json
pos credential-literal "$(printf "var %s = '%s';" SESSION_SECRET Sup3rS3cretValue)" "" js
# F1b: a NUL must never make a file be skipped (grep -I would), early or late in the file
{ printf 'ssh \0'; at user box.internal.corp; printf '\n'; } >"$P/nul_early.txt"
EXPECT_FILE+=(nul_early.txt); EXPECT_RULE+=(ssh-login)
{ printf 'ssh '; at user box.internal.corp; printf '\n'; head -c 9000 /dev/zero | tr '\0' a; printf '\nx\0y\n'; } >"$P/nul_late.txt"
EXPECT_FILE+=(nul_late.txt); EXPECT_RULE+=(ssh-login)
# a NUL inside the address itself: only stripping the NUL reveals it
{ printf 'dns 8.8'; printf '\0'; printf '.8.8\n'; } >"$P/nul_split_ip.txt"
EXPECT_FILE+=(nul_split_ip.txt); EXPECT_RULE+=(public-ipv4)
# F3: a file NAMED after a login is a finding, and the name is never printed (a short hash is)
PNAME="$(at opsuser "$(join . 203 0 113 9)").md"
printf 'token: gh%s_%s\n' r "$A36" >"$P/$PNAME"
PHASH=$(printf '%s' "$PNAME" | git hash-object --stdin | cut -c1-8)
printf 'x\n' >"$P/.env";        EXPECT_FILE+=(.env);            EXPECT_RULE+=(secret-file)
printf 'x\n' >"$P/server.pem";  EXPECT_FILE+=(server.pem);      EXPECT_RULE+=(secret-file)
mkdir -p "$P/builder"; printf 'x\n' >"$P/builder/id_rsa"; EXPECT_FILE+=(builder/id_rsa); EXPECT_RULE+=(secret-file)
printf 'x\n' >"$P/tls.key";     EXPECT_FILE+=(tls.key);         EXPECT_RULE+=(secret-file)

run bash "$SCAN" tree --root "$P"
check "positives: scanner exits 1" test "$RC" -eq 1
for i in "${!EXPECT_FILE[@]}"; do
  check "positive ${EXPECT_FILE[i]} flagged as ${EXPECT_RULE[i]}" has_line "${EXPECT_FILE[i]}:1" "${EXPECT_RULE[i]}"
done
for pr in "${PROBES[@]}"; do check "matched text is redacted from the output" lacks "$pr"; done
check "F3 tree: a login in a file NAME is a finding (shown as a hash)" has_line "path#$PHASH:1" login-at-ipv4
check "F3 tree: a content finding in such a file also hides the name" has_line "path#$PHASH:1" github-token
check "F3 tree: the name itself is never printed" lacks "$PNAME"
check "F3 tree: the address in the name is never printed" lacks "$(join . 203 0 113 9)"

# ---- 2. negatives: placeholders and safe forms must pass --------------------
N=$W/neg; mkdir -p "$N/.github"; cp "$REAL_ALLOW" "$N/.github/secret-scan-allow.txt"
m=0
neg() { m=$(( m + 1 )); printf '%s\n' "$1" >"$N/$(printf 'neg_%03d.%s' "$m" "${2:-txt}")"; }
for safe in 127.0.0.1 10.1.2.3 172.16.5.5 172.31.255.255 192.168.0.1 0.0.0.0 169.254.1.1 224.0.0.1 \
            255.255.255.255 192.0.2.1 198.51.100.7 203.0.113.9; do
  neg "listen on $safe:3999"
done
neg "version 1.2.3.4.5 and v1.2.3"
neg "hosts: $(join . 127 0 0 1),$(join . 10 0 0 1) and $(join . 192 168 0 1):8080"
neg "discount 10%40 off, 5%20 more"
neg "AWS docs: AKIAIOSFODNN7EXAMPLE and AKIAI44QH8DHBEXAMPLE"
neg "not an address: 300.1.1.1"
neg "serial 1.2.3.4.5.6.7.8 and build 9.9.9.9.8.8.8.8"
neg "ssh -L 3999:127.0.0.1:3999 <operations-account>@<host>"
neg "ssh $(at git github.com) and ssh://$(at git github.com)/org/repo.git"
neg "ssh-keygen -C $(at you example.com)"
neg "ssh $(at builder server.example.org) and scp f $(at me host.example.net):/tmp"
neg "contact $(at security example.com) for sshd questions"
neg "postgres://user:pass@localhost:5432/db"
neg "postgres://localhost:5432/db"
neg "postgresql://<user>:<password>@host/db"
neg 'postgres://${DB_USER}:${DB_PASS}@host/db'
neg "mysql://USERNAME:PASSWORD@host/db"
neg "redis://:changeme@cache.example.org/0"
neg "$(printf '%s://%s:%s@%s' https user pass example.org)/x"
neg "PASSWORD=changeme" env
neg 'TOKEN=${TOKEN}' env
neg "SECRET=<your secret>" env
neg "API_KEY=" env
neg 'PASSWORD=$DB_PASSWORD' env
neg "DB_PASSWORD_FILE=/run/secrets/db_password" env
neg "AUTH_TOKEN=REPLACE_WITH_A_LONG_RANDOM_VALUE" env
neg "const token = process.env.TOKEN;" js
neg "var TOKEN = 'ida-' + crypto.randomBytes(18).toString('hex');" js
neg "token: 'short'" js
neg "password: 'Mot de passe oublie'" js
neg '"password": "Mot de passe"' json
neg "AWS docs example: AKIAIOSFODNN7EXAMPLE"
neg "Authorization: Bearer <token>"
neg 'Authorization: Bearer ${TOKEN}'
neg "Bearer authentication-scheme-description-text"
neg "$(printf -- '-----BEGIN %s-----' 'PUBLIC KEY')"
neg "$(printf -- '-----BEGIN %s-----' 'CERTIFICATE')"
neg "ghp_ prefix with no body, github_pat_ and xoxb- are only prefixes here"
neg "sk_live_ alone is not a key"
printf 'PLACEHOLDER\n' >"$N/.env.example"
printf 'x\n' >"$N/keyboard.txt"
run bash "$SCAN" tree --root "$N"
check "negatives: scanner exits 0" test "$RC" -eq 0
if [[ $RC -ne 0 ]]; then printf '%s\n' "$OUT" >&2; fi

# ---- 3. allowlist semantics -------------------------------------------------
PUB=$(join . 8 8 8 8)
mkdir -p "$W/al/docs" "$W/al/src" "$W/al/.github"
{ echo "ipv4 10.0.0.0/8"; echo "ipv4 $PUB docs/"; echo "skip credential-literal src/fixture.js"; } >"$W/al/.github/secret-scan-allow.txt"
printf 'dns %s\n' "$PUB" >"$W/al/docs/a.md"
printf 'dns %s\n' "$PUB" >"$W/al/src/b.js"
printf "%s\n" "$(printf "var %s = '%s';" PASSWORD_X Sup3rS3cretValue)" >"$W/al/src/fixture.js"
run bash "$SCAN" tree --root "$W/al"
check "allowlist: an address allowed for docs/ is flagged in src/" has_line "src/b.js:1" public-ipv4
check "allowlist: the same address in docs/ passes (and the allowlist itself is not flagged)" lacks "docs/a.md"
check "allowlist: the registry file itself is not flagged" lacks "  .github/secret-scan-allow.txt:"
check "allowlist: skip <rule> <path> works" lacks "src/fixture.js"
printf 'dns %s\n' "$PUB" >"$W/body.txt"
run bash "$SCAN" text --label "PR body" --file "$W/body.txt" --allow "$W/al/.github/secret-scan-allow.txt"
check "allowlist: path-scoped entries do not apply to PR/commit text" has_line "PR body:1" public-ipv4

# ---- 4. text and commit-message modes ---------------------------------------
printf 'Please review.\nledger token: gh%s_%s\n' r "$A36" >"$W/body.txt"
run bash "$SCAN" text --label "PR body" --file "$W/body.txt" --allow "$REAL_ALLOW"
check "text: token on line 2 of the PR body is located" has_line "PR body:2" github-token
check "text: token is redacted" lacks "$A36"
printf 'see %s\n' "$(printf 'user%s%s' '%2540' "$(join . 8 8 8 8)")" >"$W/body.txt"
run bash "$SCAN" text --label "PR body" --file "$W/body.txt" --allow "$REAL_ALLOW"
check "F2 text: a double-encoded login in the PR body is found" has_line "PR body:1" public-ipv4
{ printf 'a b 8.8'; printf '\0'; printf '.8.8\n'; } >"$W/body.txt"
run bash "$SCAN" text --label "PR body" --file "$W/body.txt" --allow "$REAL_ALLOW"
check "F1 text: a NUL in the text does not hide a finding" has_line "PR body:1" public-ipv4
printf 'Please review.\nNo secrets here.\n' >"$W/body.txt"
run bash "$SCAN" text --label "PR body" --file "$W/body.txt" --allow "$REAL_ALLOW"
check "text: a clean PR body passes" test "$RC" -eq 0

G=$W/repo; mkdir -p "$G"
gitc() { git -C "$G" -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false "$@"; }
git init -q "$G"
mkdir -p "$G/.github"; cp "$REAL_ALLOW" "$G/.github/secret-scan-allow.txt"
gitc add -A; gitc commit -q -m "base commit"
BASE=$(git -C "$G" rev-parse HEAD)
gitc commit -q --allow-empty -m "clean change"
MID=$(git -C "$G" rev-parse HEAD)
gitc commit -q --allow-empty -m "fix the doc" -m "was: ssh -L 3999:127.0.0.1:3999 $(at user "$(join . 203 0 113 9)")"
BAD=$(git -C "$G" rev-parse HEAD)
run bash "$SCAN" commits --root "$G" -- "$BASE..$MID"
check "commits: a clean range passes" test "$RC" -eq 0
run bash "$SCAN" commits --root "$G" -- "$BASE..$BAD"
check "commits: a login line in a commit body is located by short sha" has_line "commit ${BAD:0:12} message:3" ssh-login
check "commits: the clean commit in the range is not blamed" lacks "${MID:0:12}"
check "commits: the address is redacted" lacks "$(join . 203 0 113 9)"

# github mode, as the workflow drives it: the scanner reads the PR title/body and the SHAs from
# the event payload FILE. They must never come from step env (the runner prints those values in
# the public job log), so env-supplied PR text is ignored.
mkpr() { # file title body base-sha head-sha base-ref [head-ref]
  python3 -I -c 'import json,sys
t, b, bs, hs, br = sys.argv[2:7]
hr = sys.argv[7] if len(sys.argv) > 7 else "feature"
json.dump({"pull_request": {"title": t, "body": b, "base": {"sha": bs, "ref": br}, "head": {"sha": hs, "ref": hr}}}, open(sys.argv[1], "w"))' "$@"
}
mkpush() { # file before after ref default-branch
  python3 -I -c 'import json,sys
bf, af, rf, df = sys.argv[2:6]
json.dump({"before": bf, "after": af, "ref": rf, "repository": {"default_branch": df}}, open(sys.argv[1], "w"))' "$@"
}
gh_pr()   { GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH="$1" bash "$SCAN" github --root "$2"; }
gh_push() { GITHUB_EVENT_NAME=push GITHUB_EVENT_PATH="$1" bash "$SCAN" github --root "$2"; }
EV=$W/ev.json

mkpr "$EV" clean fine "$BASE" "$MID" main
run gh_pr "$EV" "$G"
check "github/pull_request: clean title, body and commits pass" test "$RC" -eq 0
mkpr "$EV" clean "$(printf 'ok\nkey: AKIA%s' "$(rep A 16)")" "$BASE" "$MID" main
run gh_pr "$EV" "$G"
check "github/pull_request: the PR body is scanned (from the event file)" has_line "PR body:2" aws-access-key
check "github/pull_request: PR body match is redacted" lacks "$(rep A 16)"
mkpr "$EV" "$(at u "$(join . 8 8 8 8)")" x "$BASE" "$MID" main
run gh_pr "$EV" "$G"
check "github/pull_request: the PR title is scanned" has_line "PR title:1" login-at-ipv4
mkpr "$EV" t b "$BASE" "$BAD" main
run gh_pr "$EV" "$G"
check "github/pull_request: commit messages in base..head are scanned" has_line "commit ${BAD:0:12} message:3" ssh-login
mkpr "$EV" clean fine "$BASE" "$MID" main
run env PR_TITLE="$(at u "$(join . 8 8 8 8)")" PR_BODY="AKIA$(rep A 16)" GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH="$EV" bash "$SCAN" github --root "$G"
check "github/pull_request: PR text from the environment is not read" test "$RC" -eq 0
run env -u GITHUB_EVENT_PATH GITHUB_EVENT_NAME=pull_request bash "$SCAN" github --root "$G"
check "github/pull_request: no event file is a scanner error" test "$RC" -eq 2
printf '{not json' >"$W/bad.json"
run gh_pr "$W/bad.json" "$G"
check "github/pull_request: an unparsable event file is a scanner error" test "$RC" -eq 2
mkpr "$EV" t b "$(rep a 40)" "$BAD" main
run gh_pr "$EV" "$G"
check "github: an unknown base commit is a scanner error, not a pass" test "$RC" -eq 2
mkpr "$EV" t b "not-a-sha" "$BAD" main
run gh_pr "$EV" "$G"
check "github: a malformed commit id in the event is a scanner error" test "$RC" -eq 2
mkpush "$EV" "$MID" "$BAD" refs/heads/main main
run gh_push "$EV" "$G"
check "github/push: before..after commit messages are scanned" has_line "commit ${BAD:0:12} message:3" ssh-login
mkpush "$EV" "$(rep 0 40)" "$BAD" refs/heads/feature main
run gh_push "$EV" "$G"
check "github/push: a new branch (all-zero before) scans its commits" test "$RC" -eq 1

# R3: commits that are already on the default branch are not this branch's (a merged-in main),
# and the PR range excludes the CURRENT base branch, not only the event's possibly stale base.
H=$W/repo2; mkdir -p "$H/.github" "$H/src" "$H/reference"
hg() { git -C "$H" -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false "$@"; }
git init -q -b main "$H"
cp "$REAL_ALLOW" "$H/.github/secret-scan-allow.txt"
hg add -A; hg commit -q -m "base"
B0=$(git -C "$H" rev-parse HEAD)
printf 'old: ssh %s\n' "$(at user "$(join . 203 0 113 9)")" >"$H/mainfile.txt"; hg add -A
hg commit -q -m "squash of an old fix" -m "was: ssh -L 3999:127.0.0.1:3999 $(at user "$(join . 203 0 113 9)")"
M1=$(git -C "$H" rev-parse HEAD)                       # a commit on main whose message is a finding
git -C "$H" update-ref refs/remotes/origin/main "$M1"
hg checkout -q -b feature "$B0"
hg commit -q --allow-empty -m "feature work"
F1=$(git -C "$H" rev-parse HEAD)
hg merge -q --no-edit "$M1" >/dev/null 2>&1 || hg merge -q -m "Merge main" "$M1" >/dev/null
MG=$(git -C "$H" rev-parse HEAD)
mkpush "$EV" "$F1" "$MG" refs/heads/feature main
run gh_push "$EV" "$H"
check "R3 push: a merged-in main is not blamed on a feature branch" test "$RC" -eq 0
mkpush "$EV" "$B0" "$M1" refs/heads/main main
run gh_push "$EV" "$H"
check "R3 push: pushes to the default branch still scan their commits" has_line "commit ${M1:0:12} message:3" ssh-login
mkpush "$EV" "$(rep 0 40)" "$MG" refs/heads/feature main
run gh_push "$EV" "$H"
check "R3 push: a new feature branch excludes what is already on the default branch" test "$RC" -eq 0
mkpr "$EV" t b "$B0" "$MG" main
run gh_pr "$EV" "$H"
check "R3 PR: a stale event base does not blame the PR for main's commits" test "$RC" -eq 0
mkpr "$EV" t b "$B0" "$MG" ""
run gh_pr "$EV" "$H"
check "R3 PR: (control) without the base branch name the stale base is the only bound" test "$RC" -eq 1

# Added lines are scanned per commit, so content added and then removed inside a PR is still seen.
hg checkout -q -b adds "$B0"
printf 'run: %s\n' "$(at u "$(join . 203 0 113 9)")" >"$H/src/n.txt"
printf 'dummy %s\n' "$(join . 1 2 3 4)" >"$H/reference/api.js"
printf 'dummy %s\n' "$(join . 1 2 3 4)" >"$H/src/z.js"
hg add -A; hg commit -q -m "add notes"
A1=$(git -C "$H" rev-parse HEAD)
hg rm -q src/n.txt; hg commit -q -m "remove notes"
A2=$(git -C "$H" rev-parse HEAD)
mkpr "$EV" t b "$B0" "$A2" main
run gh_pr "$EV" "$H"
check "added lines: a login line added then removed is located by commit, file and line" has_line "commit ${A1:0:12} added lines in src/n.txt:1" login-at-ipv4
check "added lines: path-scoped allowlist entries apply (reference/api.js)" lacks "reference/api.js"
check "added lines: the same address elsewhere is a finding" has_line "commit ${A1:0:12} added lines in src/z.js:1" public-ipv4
check "added lines: the address is redacted" lacks "$(join . 1 2 3 4)"

# F1 (github mode): a NUL, late in a text file, must not turn the whole scan into a pass
hg checkout -q -b nul "$B0"
printf 'run: ssh %s\n' "$(at u "$(join . 203 0 113 9)")" >"$H/notes.md"; hg add -A; hg commit -q -m notes
N1=$(git -C "$H" rev-parse HEAD)
{ printf 'ssh %s\n' "$(at u "$(join . 203 0 113 9)")"; head -c 9000 /dev/zero | tr '\0' a; printf '\nx\0y\n'; } >"$H/late.txt"
{ printf 'ssh \0%s\n' "$(at u "$(join . 203 0 113 9)")"; } >"$H/early.txt"
hg add -A; hg commit -q -m pad
N2=$(git -C "$H" rev-parse HEAD)
mkpr "$EV" t "see $(at u "$(join . 203 0 113 9)")" "$B0" "$N2" main
run gh_pr "$EV" "$H"
check "F1 github: the PR body is still scanned after a NUL appears" has_line "PR body:1" login-at-ipv4
check "F1 github: earlier commits are still scanned" has_line "commit ${N1:0:12} added lines in notes.md:1" ssh-login
check "F1 github: a login before a late NUL is found" has_line "commit ${N2:0:12} added lines in late.txt:1" ssh-login
check "F1 github: a login split by an early NUL is found" has_line "commit ${N2:0:12} added lines in early.txt:1" ssh-login

# F4: content that is new only in a merge commit, and later removed, is still seen; content a
# merge merely brings in from a parent is not blamed on it (that is R3's case above)
hg checkout -q -b side "$B0"; hg commit -q --allow-empty -m "side work"
S1=$(git -C "$H" rev-parse HEAD)
hg checkout -q -b evilmerge "$B0"; hg commit -q --allow-empty -m "own work"
hg merge -q --no-commit "$S1" >/dev/null 2>&1 || true
printf 'login %s\n' "$(at u "$(join . 203 0 113 9)")" >"$H/evil.txt"; hg add -A
hg commit -q -m "Merge side"
E1=$(git -C "$H" rev-parse HEAD)
hg rm -q evil.txt; hg commit -q -m "drop it"
E2=$(git -C "$H" rev-parse HEAD)
mkpr "$EV" t b "$B0" "$E2" main
run gh_pr "$EV" "$H"
check "F4 merge: content added only by a merge commit is located in it" has_line "commit ${E1:0:12} added lines in evil.txt:1" login-at-ipv4

# F3: file names, branch names and author fields
hg checkout -q -b names "$B0"
NAME="$(at u "$(join . 203 0 113 9)").md"
printf 'token: gh%s_%s\n' r "$A36" >"$H/$NAME"; hg add -A
hg -c user.name="$(at u "$(join . 203 0 113 9)")" commit -q -m "add a file" --author="$(at u "$(join . 203 0 113 9)") <x@example.invalid>"
C1=$(git -C "$H" rev-parse HEAD)
HASH=$(printf '%s' "$NAME" | git hash-object --stdin | cut -c1-8)
mkpr "$EV" t b "$B0" "$C1" main "feature/$(at u "$(join . 203 0 113 9)")"
run gh_pr "$EV" "$H"
check "F3 diff: a login in an added file's NAME is a finding (hash only)" has_line "path#$HASH:1" login-at-ipv4
check "F3 diff: a content finding in it is located by hash too" has_line "commit ${C1:0:12} added lines in path#$HASH:1" github-token
check "F3 diff: the name is never printed" lacks "$NAME"
check "F3: the author name/email is scanned" has_line "commit ${C1:0:12} author fields:1" login-at-ipv4
check "F3: the PR branch name is scanned" has_line "PR branch names:1" login-at-ipv4
mkpush "$EV" "$B0" "$C1" "refs/heads/feature/$(at u "$(join . 203 0 113 9)")" main
run gh_push "$EV" "$H"
check "F3: the pushed ref name is scanned" has_line "pushed ref name:1" login-at-ipv4

# F5: the allowlist cannot approve its own additions (judged against the base branch's copy)
hg checkout -q -b allowadd "$B0"
{ cat "$H/.github/secret-scan-allow.txt"; printf 'ipv4 %s/32 # test\n' "$(join . 8 8 8 8)"; } >"$H/al.new"; mv "$H/al.new" "$H/.github/secret-scan-allow.txt"
hg add -A; hg commit -q -m "allow something"
AL=$(git -C "$H" rev-parse HEAD)
LN=$(wc -l <"$H/.github/secret-scan-allow.txt"); LN=${LN//[[:space:]]/}
mkpr "$EV" t b "$B0" "$AL" main
run gh_pr "$EV" "$H"
check "F5 PR: a new public address in the allowlist file is a finding" has_line "commit ${AL:0:12} added lines in .github/secret-scan-allow.txt:$LN" public-ipv4
mkpush "$EV" "$B0" "$AL" refs/heads/feature main
run gh_push "$EV" "$H"
check "F5 push off the default branch: same" test "$RC" -eq 1
mkpush "$EV" "$B0" "$AL" refs/heads/main main
run gh_push "$EV" "$H"
check "F5 push to the default branch: an already-merged registry change is not re-failed" test "$RC" -eq 0
hg checkout -q -b allowok "$B0"
{ cat "$H/.github/secret-scan-allow.txt"; printf 'ipv4 10.0.0.0/8 # dup\n'; } >"$H/al.new"; mv "$H/al.new" "$H/.github/secret-scan-allow.txt"
hg add -A; hg commit -q -m "allow a reserved range"
AK=$(git -C "$H" rev-parse HEAD)
mkpr "$EV" t b "$B0" "$AK" main
run gh_pr "$EV" "$H"
check "F5 PR: a range the base allowlist already covers passes" test "$RC" -eq 0

# F6: no `before` on the default branch scans only the tip, not 200 commits of old findings
gitc commit -q --allow-empty -m "clean tip"
TIP=$(git -C "$G" rev-parse HEAD)
mkpush "$EV" "$(rep 0 40)" "$TIP" refs/heads/main main
run gh_push "$EV" "$G"
check "F6 push: default branch without a before-SHA scans the tip only" test "$RC" -eq 0

# ---- 5. a broken scanner must fail, never pass ------------------------------
run bash "$SCAN" tree --root "$W/does-not-exist"
check "error: missing root exits 2" test "$RC" -eq 2
run bash "$SCAN" tree --root "$N" --allow "$W/no-such-allowlist"
check "error: missing allowlist exits 2" test "$RC" -eq 2
printf 'bogus 1\n' >"$W/bad-allow"
run bash "$SCAN" tree --root "$N" --allow "$W/bad-allow"
check "error: unknown allowlist directive exits 2" test "$RC" -eq 2
printf '%s 1\n' "gh${p}_$A36" >"$W/secret-word-allow"
run bash "$SCAN" tree --root "$N" --allow "$W/secret-word-allow"
check "error: an unknown allowlist directive is reported by line number, not echoed" test "$RC" -eq 2
check "error: the unknown directive text is withheld" lacks "$A36"
REAL_GREP=$(command -v grep)
mkdir -p "$W/fakebin"
printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = "--null" ] && exit 2; done\nexec %s "$@"\n' "$REAL_GREP" >"$W/fakebin/grep"
chmod +x "$W/fakebin/grep"
run env PATH="$W/fakebin:$PATH" bash "$SCAN" tree --root "$N"
check "error: a grep failure other than no-match exits 2" test "$RC" -eq 2
printf '#!/bin/sh\nexit 2\n' >"$W/fakebin/grep"
run env PATH="$W/fakebin:$PATH" bash "$SCAN" tree --root "$N"
check "error: a grep that fails outright exits 2" test "$RC" -eq 2

# R1: the workflow must not hand PR text to the scanner (or anything) through step env or an
# expression; the runner prints step env values in the public job log.
WF=$HERE/../workflows/ci.yml
if [[ -f $WF ]]; then
  nogrep() { ! grep -Eq "$1" "$2"; }
  check "workflow: no PR title/body expression anywhere" nogrep 'github\.event\.pull_request\.(title|body)' "$WF"
  check "workflow: no PR_TITLE/PR_BODY step env" nogrep 'PR_(TITLE|BODY)' "$WF"
  check "workflow: no toJSON(github...) expression" nogrep 'toJSON\(github' "$WF"
  check "workflow: every action is pinned to a commit" nogrep 'uses: [^ ]+@v[0-9]' "$WF"
  check "workflow: both checkouts drop credentials" test "$(grep -c 'persist-credentials: false' "$WF")" -ge 2
  step_has_no_env() { awk '/secret_scan\.sh github/ { exit bad } /name: Commit messages/ { f = 1 } f && /^[[:space:]]+env:/ { bad = 1 }' "$1"; }
  check "workflow: the PR-text scan step has no env block" step_has_no_env "$WF"
  check "workflow: checkout is pinned to a commit and drops credentials" grep -Eq 'actions/checkout@[0-9a-f]{40}' "$WF"
  check "workflow: persist-credentials is false" grep -Eq 'persist-credentials: false' "$WF"
fi

echo "selftest: $CHECKS checks, $FAILS failed"
[[ $FAILS -eq 0 ]]
