#!/usr/bin/env bash
# secret_scan.sh - secret and estate hygiene gate for a PUBLIC repository.
#
# Deterministic, offline, dependency-free (bash, GNU grep -E, git). It never
# prints the text it matched: a hit is reported as "<location>:<line> [rule]"
# only, because a CI log on a public repository is itself a publication.
#
#   secret_scan.sh tree    [--root DIR] [--allow FILE]
#   secret_scan.sh text    --label LABEL --file FILE [--allow FILE]
#   secret_scan.sh commits [--root DIR] [--allow FILE] -- <git rev-list args>
#   secret_scan.sh github  [--root DIR] [--allow FILE]   (reads GITHUB_EVENT_NAME / GITHUB_EVENT_PATH)
#
# Notes on what is (deliberately) covered:
#   * every byte is scanned as text (grep -a, NUL bytes stripped first): a NUL must never be a
#     way to make a scan skip its input;
#   * URL escapes (%40, %20, %2E, and %25-wrapped forms) are decoded before matching;
#   * file paths, author fields and ref names are scanned too, and a path that is itself a
#     finding is never printed, only a short hash;
#   * added lines of every commit are scanned (merge commits: only lines new in the merge).
#
# Exit status: 0 clean, 1 at least one finding, 2 the scanner itself failed
# (missing tool, grep error other than "no match", bad allowlist, bad range).
# A scanner failure is never a pass.
#
# Allowlist (.github/secret-scan-allow.txt), one directive per line:
#   ipv4 <addr|addr/len> [path-or-dir/ ...]   public-looking address that is OK
#   skip <rule|*> <path-or-dir/>              exclude a path from a rule
# The IPv4 rule needs no per-host entry: any address outside the allowlisted
# ranges is a finding, so this file never has to name the estate's hosts.

set -euo pipefail
export LC_ALL=C
shopt -s nocasematch

die() { echo "secret-scan: ERROR: $*" >&2; exit 2; }

for tool in grep git sed mktemp find wc cat awk; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool not found: $tool"
done
TMP=$(mktemp -d) || die "mktemp failed"
trap 'rm -rf "$TMP"' EXIT
# Canary: if grep -E cannot match a trivial pattern (or matches a wrong one), nothing
# below can be trusted.
canary_rc=0
printf 'canary-x\n' | grep -Eq '^canary-[a-z]+$' || die "grep -E canary (positive) failed"
printf 'canary-x\n' | grep -Eq '^other$' || canary_rc=$?
[[ $canary_rc -eq 1 ]] || die "grep -E canary (negative) failed"

# ----------------------------------------------------------------------------
# Rules. kind: plain (the -o match itself is tested), ip (each token is an IPv4
# candidate checked against the allowlist), each (the whole line is selected by
# the pattern, then every token matching EACH is tested against the exclusion).
# ----------------------------------------------------------------------------
RULE_NAME=() RULE_FLAGS=() RULE_KIND=() RULE_PAT=() RULE_EACH=() RULE_EXCL=() RULE_REQ=()
add_rule() { # name flags kind pattern [each] [exclude] [require]
  RULE_NAME+=("$1"); RULE_FLAGS+=("$2"); RULE_KIND+=("$3"); RULE_PAT+=("$4")
  RULE_EACH+=("${5-}"); RULE_EXCL+=("${6-}"); RULE_REQ+=("${7-}")
}

NOQ="[:space:]\"'\`"                       # characters that end a URL/credential token
PH='change[-_ ]?me|placeholder|example|your[-_ ]|replace|redacted|dummy|fake|sample|xxxx|[*][*][*]|[.][.][.]|<[^>]*>|[{][^}]*[}]|randomBytes|urandom|%s|%[(]'
DOT='(\.|\[\.\]|\\\.|%(25)*2[Ee])'      # plain, defanged [.], regex-escaped \., %2E, %252E, %25252E...
AT='(@|%(25)*40)'                            # an @ or its URL-encoded form (%40, %2540, %252540...)

add_rule private-key        Ei plain '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----'
add_rule github-token       E  plain 'gh[pousr]_[A-Za-z0-9]{36,}'
add_rule github-pat         E  plain 'github_pat_[A-Za-z0-9_]{22,}'
add_rule slack-token        E  plain 'xox[baprs]-[A-Za-z0-9-]{10,}'
# PCRE lookarounds: the boundary must not be consumed, or a key directly after another match is missed.
add_rule aws-access-key     P  plain '(?<![A-Za-z0-9])(AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])' '' 'EXAMPLE'
add_rule google-api-key     P  plain '(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])'
add_rule stripe-live-key    E  plain '[rs]k_live_[A-Za-z0-9]{16,}'
add_rule bearer-token       Ei plain 'bearer[[:space:]]+[A-Za-z0-9._~+/=-]{24,}' '' '' '[0-9]'
add_rule db-url-credentials Ei plain "(postgres(ql)?|mysql|mariadb|mongodb(\\+srv)?|redis|rediss|amqps?)://[^${NOQ}/@:]*:[^${NOQ}/@]+@" '' \
  "$PH|://(user(name)?)?:(pass(word)?|pwd|secret|xxx+|[*]+)@"
add_rule basic-auth-url     Ei plain "https?://[^${NOQ}/@:]+:[^${NOQ}/@]+@" '' \
  "$PH|://(user(name)?)?:(pass(word)?|pwd|secret|xxx+|[*]+)@"
add_rule env-assignment     Ei plain "^[[:space:]]*(export[[:space:]]+)?[A-Za-z0-9_.-]*(password|passwd|secret|token|api_?key|access_?key|private_?key)[A-Za-z0-9_.-]*=[\"']?[^${NOQ}\$<{(]{8,}" '' \
  "$PH|_(file|path|name|env|header)=|=[\"']?(none|null|false|true|empty|unset|todo|tbd|not[-_]?set|test|secret|password|token)"
add_rule credential-literal Ei plain "(api_?key|secret|password|passwd|token|private_?key|access_?key)[A-Za-z0-9_]*[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"'\$[:space:]]{8,}[\"'][[:space:]]*([^+[:space:]]|\$)" '' \
  "$PH|_(file|path|name|env|header|field|label|prefix|url)[\"']?[[:space:]]*[:=]"
add_rule login-at-ipv4      Ei plain "[A-Za-z_][A-Za-z0-9._-]*${AT}([0-9]{1,3}${DOT}){3}[0-9]{1,3}"
add_rule ssh-login          Ei each  '(^|[^A-Za-z0-9_])(ssh|scp|rsync|sftp)([^A-Za-z0-9_@]|$).*[A-Za-z_][A-Za-z0-9._-]*(@|%(25)*40)[A-Za-z0-9]' \
  '[A-Za-z_][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*' \
  '@(localhost|([A-Za-z0-9-]+[.])*(example[.](com|org|net)|github[.]com|gitlab[.]com|bitbucket[.]org)|[A-Za-z0-9.-]*[.](example|invalid|test|localhost|local))[.]?$'
# The two address rules select whole lines and test every candidate token in bash, because a
# consumed boundary (grep -o) would hide an address that directly follows another one. For
# these rules REQ is the character class that must NOT precede a token and EXCL the one that
# must NOT follow it ("1.2.3.4.5" and "1.2.3.4567" are not addresses).
add_rule public-ipv4        E  ip    "([0-9]{1,3}${DOT}){3}[0-9]{1,3}" \
  "([0-9]{1,3}${DOT}){3}[0-9]{1,3}" '^([0-9]|[.][0-9])' '[0-9.]'
add_rule public-ipv4-host   Ei ip    'ip-[0-9]{1,3}(-[0-9]{1,3}){3}' \
  'ip-[0-9]{1,3}(-[0-9]{1,3}){3}' '^([0-9]|-[0-9])' '[A-Za-z0-9]'

# Path-only rule: files that must never be tracked in a public repository.
SECRET_FILE_RE='(^|/)(\.env(\.[^/]*)?|\.netrc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)|[^/]*\.(pem|key|p12|pfx|jks|keystore|ppk))$'
SECRET_FILE_OK_RE='(^|/)\.env\.(example|sample|template|dist)$'

# ----------------------------------------------------------------------------
# Allowlist
# ----------------------------------------------------------------------------
ALLOW_LO=() ALLOW_HI=() ALLOW_PATHS=() SKIP_RULE=() SKIP_PATH=()

ip_to_int() { # a.b.c.d -> integer in $IPINT, returns 1 if not a valid dotted quad
  local a b c d extra
  IFS=. read -r a b c d extra <<<"$1"
  [[ -z ${extra-} && -n ${d-} ]] || return 1
  local o
  for o in "$a" "$b" "$c" "$d"; do
    [[ $o =~ ^[0-9]{1,3}$ ]] || return 1
    (( 10#$o <= 255 )) || return 1
  done
  IPINT=$(( (10#$a << 24) | (10#$b << 16) | (10#$c << 8) | 10#$d ))
}

load_allow() {
  local file=$1 line kind rest arg len size lo lineno=0
  [[ -f $file ]] || die "allowlist not found: $file"
  while IFS= read -r line || [[ -n $line ]]; do
    lineno=$(( lineno + 1 ))
    line=${line%%#*}
    read -r -a parts <<<"$line" || true
    [[ ${#parts[@]} -gt 0 ]] || continue
    kind=${parts[0]}
    case "$kind" in
      ipv4)
        [[ ${#parts[@]} -ge 2 ]] || die "allowlist line $lineno: ipv4 needs an address"
        arg=${parts[1]}; len=32
        if [[ $arg == */* ]]; then len=${arg#*/}; arg=${arg%%/*}; fi
        [[ $len =~ ^[0-9]{1,2}$ ]] && (( 10#$len <= 32 )) || die "allowlist line $lineno: bad prefix length"
        ip_to_int "$arg" || die "allowlist line $lineno: bad IPv4 address"
        size=$(( 1 << (32 - 10#$len) ))
        lo=$(( IPINT - (IPINT % size) ))
        ALLOW_LO+=("$lo"); ALLOW_HI+=("$(( lo + size - 1 ))")
        ALLOW_PATHS+=("${parts[*]:2}")
        ;;
      skip)
        [[ ${#parts[@]} -eq 3 ]] || die "allowlist line $lineno: skip needs <rule|*> <path>"
        SKIP_RULE+=("${parts[1]}"); SKIP_PATH+=("${parts[2]}")
        ;;
      *) die "allowlist line $lineno: unknown directive (text withheld)" ;;
    esac
    parts=()
  done <"$file"
}

path_matches() { # path entry
  [[ $2 == */ ]] && [[ $1 == "$2"* ]] && return 0
  [[ $1 == "$2" ]]
}

skipped() { # rule path -> 0 if an allowlist skip entry covers it
  local i
  for i in "${!SKIP_RULE[@]}"; do
    if [[ ${SKIP_RULE[i]} == '*' || ${SKIP_RULE[i]} == "$1" ]] && path_matches "$2" "${SKIP_PATH[i]}"; then return 0; fi
  done
  return 1
}

IPBASE=0 STRICT_ALLOW=0 BASE_LO=() BASE_HI=() BASE_PATHS=()
ip_allowed() { # int path-or-empty; IPBASE=1 consults the trusted base allowlist instead
  local i p pfx=ALLOW
  if [[ $IPBASE == 1 ]]; then pfx=BASE; fi
  local -n LO=${pfx}_LO HI=${pfx}_HI PA=${pfx}_PATHS
  for i in "${!LO[@]}"; do
    if (( $1 >= LO[i] && $1 <= HI[i] )); then
      if [[ -z ${PA[i]} ]]; then return 0; fi
      if [[ -n $2 ]]; then
        for p in ${PA[i]}; do path_matches "$2" "$p" && return 0; done
      fi
    fi
  done
  return 1
}

# ----------------------------------------------------------------------------
# Reporting. Locations only; the matched text is never printed.
# ----------------------------------------------------------------------------
FINDINGS=0
declare -A SEEN=() BADPATH=() SANMAP=() NULCOPY=()
SEG_START=() SEG_LABEL=() SEG_PATH=()
SEG_IDX=0
MODE=tree

sanitize() { local s=$1; printf '%s' "${s//[^A-Za-z0-9._\/@+=:# -]/?}"; }

seg_lookup() { # corpus line -> SEG_IDX (last segment starting at or before it)
  local k n=${#SEG_START[@]}
  SEG_IDX=0
  for (( k = 0; k < n; k++ )); do
    if (( SEG_START[k] <= $1 )); then SEG_IDX=$k; else break; fi
  done
}

h8() { local h; h=$(printf '%s' "$1" | git hash-object --stdin) || die "git hash-object failed"; printf '%s' "${h:0:8}"; }

record() { # rule file line
  local rule=$1 f=$2 ln=$3 loc shown sp
  if [[ $MODE == paths ]]; then
    # A finding in a path NAME: remember it, and never print the path (only a short hash).
    sp=$(sed -n "${ln}p" "$PATHLIST")
    if [[ -n $sp ]]; then BADPATH["$sp"]=1; loc="path#$(h8 "$sp")"; else loc="path#empty"; fi
    ln=1
  elif [[ $MODE == text ]]; then
    seg_lookup "$ln"
    loc=${SEG_LABEL[SEG_IDX]}
    sp=${SEG_PATH[SEG_IDX]}
    if [[ -n $sp ]]; then
      if [[ -n ${BADPATH["$sp"]+x} ]]; then loc="$loc in path#$(h8 "$sp")"; else loc="$loc in $sp"; fi
    fi
    loc=$(sanitize "$loc")
    shown=$(sed -n "${ln}p" "$LNMAP")
    ln=${shown:-$ln}
  elif [[ -n ${BADPATH["$f"]+x} ]]; then
    loc="path#$(h8 "$f")"
  else
    loc=$(sanitize "$f")
  fi
  [[ -z ${SEEN["$rule|$loc|$ln"]+x} ]] || return 0
  SEEN["$rule|$loc|$ln"]=1
  FINDINGS=$(( FINDINGS + 1 ))
  echo "  $loc:$ln  [$rule]"
  if [[ ${GITHUB_ACTIONS-} == true && $MODE == tree ]]; then
    echo "::error file=${loc//:/_},line=$ln,title=secret-scan::$rule (matched text withheld)"
  fi
}

decode() { # URL-decode the escapes that hide a login or an address (%40 @, %20 space, %2E dot), repeatedly so %2540 / %252E are covered
  local s=$1 prev=
  while [[ $s != "$prev" ]]; do
    prev=$s
    s=${s//%25/%}; s=${s//%40/@}; s=${s//%20/ }; s=${s//%2[Ee]/.}
  done
  DECODED=$s
}

handle_hit() { # rule-index file line match
  local i=$1 f=$2 ln=$3 m=$4 rule=${RULE_NAME[$1]} kind=${RULE_KIND[$1]}
  local rel=""
  if [[ $MODE == tree ]]; then
    rel=$f
  elif [[ $MODE == text ]]; then
    seg_lookup "$ln"; rel=${SEG_PATH[SEG_IDX]}
  fi
  if [[ -n $rel ]] && skipped "$rule" "$rel"; then return 0; fi
  local excl=${RULE_EXCL[i]} req=${RULE_REQ[i]} each=${RULE_EACH[i]} rest tok norm pre after prev cur_prev
  case "$kind" in
    plain)
      if [[ -n $excl && $m =~ $excl ]]; then return 0; fi
      if [[ -n $req && ! $m =~ $req ]]; then return 0; fi
      record "$rule" "$f" "$ln"
      ;;
    each)
      decode "$m"; rest=$DECODED
      while [[ $rest =~ $each ]]; do
        tok=${BASH_REMATCH[0]}
        rest=${rest#*"$tok"}
        if [[ -n $excl && $tok =~ $excl ]]; then continue; fi
        record "$rule" "$f" "$ln"; return 0
      done
      ;;
    ip)
      # The allowlist file is the registry of exceptions; it is not itself scanned for them.
      IPBASE=0
      if [[ -n $rel && -n ${ALLOW_ABS-} && $ROOT/$rel == "$ALLOW_ABS" ]]; then
        # Additions to the registry are judged against the TRUSTED (base) allowlist when one is
        # available, so a change cannot approve its own address; otherwise the file is exempt.
        if [[ $MODE == text && $STRICT_ALLOW == 1 ]]; then IPBASE=1; else return 0; fi
      fi
      decode "$m"; rest=$DECODED; prev=""
      while [[ $rest =~ $each ]]; do
        tok=${BASH_REMATCH[0]}
        pre=${rest%%"$tok"*}
        after=${rest#*"$tok"}
        if [[ -n $pre ]]; then prev=${pre: -1}; fi
        cur_prev=$prev; prev=${tok: -1}; rest=$after
        # req: must not precede the token; excl: must not follow it (tested on the next 2 chars)
        if [[ -n $cur_prev && -n $req && $cur_prev =~ $req ]]; then continue; fi
        if [[ -n $after && -n $excl && ${after:0:2} =~ $excl ]]; then continue; fi
        norm=${tok//\[/}; norm=${norm//\]/}; norm=${norm//\\/}; norm=${norm//-/.}; norm=${norm#[Ii][Pp].}
        ip_to_int "$norm" || continue
        if ip_allowed "$IPINT" "$rel"; then continue; fi
        IPBASE=0; record "$rule" "$f" "$ln"; return 0
      done
      IPBASE=0
      ;;
  esac
}

# Run every content rule over FILES (arguments). One grep per rule per batch.
scan_files() {
  local i flags args rc f rest ln m
  local -a batch
  for i in "${!RULE_NAME[@]}"; do
    flags=${RULE_FLAGS[i]}
    args=(-n -H -a --null)
    if [[ $flags == *P* ]]; then args+=(-P); else args+=(-E); fi
    if [[ $flags == *i* ]]; then args+=(-i); fi
    if [[ ${RULE_KIND[i]} == plain ]]; then args+=(-o); fi
    local n=$# start=1 size=300
    while (( start <= n )); do
      batch=("${@:start:size}")
      start=$(( start + size ))
      rc=0
      grep "${args[@]}" -e "${RULE_PAT[i]}" -- "${batch[@]}" >"$TMP/out" 2>"$TMP/err" || rc=$?
      if (( rc > 1 )); then
        sed -n '1,3p' "$TMP/err" | while IFS= read -r l; do echo "secret-scan: grep: $(sanitize "$l")" >&2; done
        die "grep failed (exit $rc) while applying rule '${RULE_NAME[i]}'"
      fi
      while IFS= read -r -d '' f && IFS= read -r rest; do
        ln=${rest%%:*}; m=${rest#*:}
        f=${SANMAP["$f"]:-$f}
        handle_hit "$i" "$f" "$ln" "$m"
      done <"$TMP/out"
    done
  done
}

# Path NAMES are content too: a file named after a login line must not pass, nor leak through
# a location in the log. Scanned first so any later location can redact the path.
PATHLIST=""
scan_path_file() { # file with one path per line
  local saved=$MODE
  PATHLIST=$1; MODE=paths
  scan_files "$1"
  MODE=$saved
}

scan_secret_file_names() { # paths...
  local f
  for f in "$@"; do
    if [[ $f =~ $SECRET_FILE_RE && ! $f =~ $SECRET_FILE_OK_RE ]]; then
      skipped secret-file "$f" || { record secret-file "$f" 1; }
    fi
  done
}

# ----------------------------------------------------------------------------
# Modes
# ----------------------------------------------------------------------------
finish() {
  if (( FINDINGS > 0 )); then
    echo "secret-scan: FAIL - $FINDINGS finding(s). Matched text is deliberately not printed." >&2
    echo "secret-scan: Fix the location, or (for a reviewed exception) edit .github/secret-scan-allow.txt." >&2
    exit 1
  fi
  echo "secret-scan: OK - no findings ($1)."
}

mode_tree() {
  MODE=tree
  cd "$ROOT" || die "cannot enter root: $ROOT"
  load_allow "$ALLOW"
  local -a all=() files=()
  local top
  if top=$(git rev-parse --show-toplevel 2>/dev/null) && [[ $(cd "$top" && pwd -P) == "$(pwd -P)" ]]; then
    git ls-files -z >"$TMP/list" || die "git ls-files failed"
  else
    find . -type f -not -path './.git/*' -print0 >"$TMP/list" || die "find failed"
  fi
  mapfile -d '' all <"$TMP/list"
  local f
  for f in "${all[@]}"; do
    f=${f#./}
    [[ -f $f && ! -L $f ]] || continue
    if skipped '*' "$f"; then continue; fi
    files+=("$f")
  done
  (( ${#files[@]} > 0 )) || die "no files to scan under $ROOT"
  printf '%s\n' "${files[@]}" >"$TMP/pathlist"
  scan_path_file "$TMP/pathlist"
  scan_secret_file_names "${files[@]}"
  # Scan every byte as text. A NUL must not disable matching (git itself sniffs only the first
  # 8000 bytes), so files containing one are scanned from a NUL-stripped copy.
  local -a scan=() nulls=() batch
  local n=${#files[@]} start=0 rc k=0 nf
  while (( start < n )); do
    batch=("${files[@]:start:300}"); start=$(( start + 300 ))
    rc=0
    grep -l -a -P --null -e '\x00' -- "${batch[@]}" >"$TMP/nul" 2>"$TMP/err" || rc=$?
    if (( rc > 1 )); then die "grep failed (exit $rc) while looking for NUL bytes"; fi
    mapfile -d '' -t -O "${#nulls[@]}" nulls <"$TMP/nul"
  done
  mkdir -p "$TMP/san"
  for f in "${nulls[@]}"; do
    k=$(( k + 1 )); nf=$TMP/san/$k
    tr -d '\000' <"$f" >"$nf" || die "cannot strip NUL bytes from a file"
    SANMAP["$nf"]=$f; NULCOPY["$f"]=$nf
  done
  for f in "${files[@]}"; do scan+=("${NULCOPY["$f"]:-$f}"); done
  scan_files "${scan[@]}"
  finish "${#files[@]} files"
}

CORPUS="" CORPUS_LINES=0 LNMAP=""
add_segment() { # label file [path]: a block of text scanned as one unit, located by label
  if [[ -z $CORPUS ]]; then CORPUS=$TMP/corpus; LNMAP=$TMP/lnmap; : >"$CORPUS"; : >"$LNMAP"; fi
  local before=$CORPUS_LINES delta
  SEG_START+=("$(( before + 1 ))"); SEG_LABEL+=("$1"); SEG_PATH+=("${3-}")
  tr -d '\000' <"$2" >>"$CORPUS" || die "cannot read text segment: $1"
  printf '\n' >>"$CORPUS"
  CORPUS_LINES=$(wc -l <"$CORPUS")
  CORPUS_LINES=${CORPUS_LINES//[[:space:]]/}
  delta=$(( CORPUS_LINES - before ))
  awk -v n="$delta" 'BEGIN { for (i = 1; i <= n; i++) print i }' >>"$LNMAP" || die "awk failed"
}

# The lines a commit ADDS, per file, so content added and then removed by a later commit in
# the same range is still seen. Merge commits use the combined diff (--cc): only lines that are
# new in the merge itself, not lines it merely brings in from a parent. Every file is treated
# as text (--text) and NUL bytes are stripped. Located as
# "commit <sha> added lines in <path>:<file line>".
DIFFPATHS=""
add_commit_diff() { # sha
  local sha=$1 base st pth added
  [[ -n $DIFFPATHS ]] || { DIFFPATHS=$TMP/diffpaths; : >"$DIFFPATHS"; }
  if ! git -c core.quotePath=false diff-tree -p --cc --text -U0 --no-color --no-ext-diff --no-renames -r --root --no-commit-id "$sha" \
        2>"$TMP/err" | tr -d '\000' >"$TMP/diff"; then
    die "git diff-tree failed"
  fi
  : >"$TMP/added"; : >"$TMP/addedln"; : >"$TMP/meta"
  awk -v out="$TMP/added" -v lnm="$TMP/addedln" -v meta="$TMP/meta" '
    BEGIN { inh = 0; n = 0; last = "\001"; ncol = 1; plus = "+" }
    /^diff --(git|cc|combined) / { inh = 0; path = ""; next }
    substr($0, 1, 1) == "\\" { next }
    {
      if (!inh || substr($0, 1, 2) == "@@") {
        if (substr($0, 1, 2) == "@@") {
          inh = 1; match($0, /^@+/); ncol = RLENGTH - 1
          plus = ""; for (c = 0; c < ncol; c++) plus = plus "+"
          hdr = $0; sub(/ @@+.*$/, "", hdr); k = split(hdr, a, " "); t = a[k]; sub(/^\+/, "", t); ln = t + 0
        } else if (substr($0, 1, 6) == "+++ b/") {
          path = substr($0, 7)
        }
        next
      }
      pre = substr($0, 1, ncol)
      if (pre == plus) {
        if (path != last) { rec = (n + 1) "\t" path; print rec > meta; last = path }
        print substr($0, ncol + 1) > out; print ln > lnm; n++
      }
      if (index(pre, "-") == 0) ln++
    }' "$TMP/diff" || die "awk failed while reading a commit diff"
  added=$(wc -l <"$TMP/added"); added=${added//[[:space:]]/}
  (( added > 0 )) || return 0
  base=$CORPUS_LINES
  while IFS=$'\t' read -r st pth; do
    SEG_START+=("$(( base + st ))"); SEG_LABEL+=("commit ${sha:0:12} added lines"); SEG_PATH+=("$pth")
    printf '%s\n' "$pth" >>"$DIFFPATHS"
  done <"$TMP/meta"
  cat -- "$TMP/added" >>"$CORPUS"; cat -- "$TMP/addedln" >>"$LNMAP"
  CORPUS_LINES=$(( base + added ))
}

scan_corpus() { # description
  if [[ -z $CORPUS ]]; then finish "$1: nothing to scan"; return; fi
  if [[ -n $DIFFPATHS && -s $DIFFPATHS ]]; then
    sort -u "$DIFFPATHS" >"$TMP/diffpaths.u" || die "sort failed"
    scan_path_file "$TMP/diffpaths.u"
  fi
  MODE=text
  scan_files "$CORPUS"
  finish "$1"
}

add_commits() { # rev-list args
  local sha
  git rev-list "$@" >"$TMP/revs" 2>"$TMP/err" || die "git rev-list failed for the requested range"
  while IFS= read -r sha; do
    [[ $sha =~ ^[0-9a-f]{40,64}$ ]] || die "unexpected rev-list output"
    git log -1 --format=%B "$sha" >"$TMP/msg" || die "git log failed"
    add_segment "commit ${sha:0:12} message" "$TMP/msg"
    git log -1 --format='%an%n%ae%n%cn%n%ce' "$sha" >"$TMP/author" || die "git log failed"
    add_segment "commit ${sha:0:12} author fields" "$TMP/author"
    add_commit_diff "$sha"
    COMMITS=$(( ${COMMITS:-0} + 1 ))
  done <"$TMP/revs"
}

# Reads the CI event payload FROM FILE. PR text must never travel through step `env:` or the
# command line: the runner prints every step env value in the public job log.
read_event() {
  [[ -n ${GITHUB_EVENT_PATH-} && -f $GITHUB_EVENT_PATH ]] || die "GITHUB_EVENT_PATH is not set to a file"
  command -v python3 >/dev/null 2>&1 || die "required tool not found: python3"
  mkdir -p "$TMP/ev"
  python3 -I -c '
import json, os, sys
ev = json.load(open(sys.argv[1], encoding="utf-8", errors="replace"))
out = sys.argv[2]
pr = ev.get("pull_request") or {}
base = pr.get("base") or {}
head = pr.get("head") or {}
repo = ev.get("repository") or {}
fields = {
    "pr_title": (pr.get("title") or "") + "\n",
    "pr_body": (pr.get("body") or "") + "\n",
    "pr_base_sha": base.get("sha") or "",
    "pr_base_ref": base.get("ref") or "",
    "pr_head_ref": head.get("ref") or "",
    "pr_head_sha": head.get("sha") or "",
    "push_before": ev.get("before") or "",
    "push_after": ev.get("after") or "",
    "push_ref": ev.get("ref") or "",
    "default_branch": repo.get("default_branch") or "",
}
for k, v in fields.items():
    with open(os.path.join(out, k), "w", encoding="utf-8", errors="replace") as fh:
        fh.write(str(v))
' "$GITHUB_EVENT_PATH" "$TMP/ev" || die "cannot parse the event payload"
}
ev() { local v=; [[ -f $TMP/ev/$1 ]] && v=$(<"$TMP/ev/$1"); printf '%s' "$v"; }
need_sha() { [[ $1 =~ ^[0-9a-f]{40,64}$ ]] || die "event payload: $2 is not a commit id"; }
need_ref() { [[ -z $1 || $1 =~ ^[A-Za-z0-9._/-]+$ ]] || die "event payload: $2 is not a plain ref name"; }

# Load the allowlist as it is at <rev> into BASE_*, so additions to the registry can be judged
# against a trusted version. No registry at <rev> (or not under the root): stays non-strict.
load_base_allow() { # rev
  local rel
  [[ -n ${ALLOW_DIR-} && $ALLOW_ABS == "$ROOT"/* ]] || return 0
  rel=${ALLOW_ABS#"$ROOT"/}
  git cat-file -e "$1:$rel" 2>/dev/null || return 0
  git show "$1:$rel" >"$TMP/base-allow" 2>/dev/null || die "cannot read the base allowlist"
  local sLO=("${ALLOW_LO[@]}") sHI=("${ALLOW_HI[@]}") sPA=("${ALLOW_PATHS[@]}") sSR=("${SKIP_RULE[@]}") sSP=("${SKIP_PATH[@]}")
  ALLOW_LO=() ALLOW_HI=() ALLOW_PATHS=() SKIP_RULE=() SKIP_PATH=()
  load_allow "$TMP/base-allow"
  BASE_LO=("${ALLOW_LO[@]}") BASE_HI=("${ALLOW_HI[@]}") BASE_PATHS=("${ALLOW_PATHS[@]}")
  ALLOW_LO=("${sLO[@]}") ALLOW_HI=("${sHI[@]}") ALLOW_PATHS=("${sPA[@]}") SKIP_RULE=("${sSR[@]}") SKIP_PATH=("${sSP[@]}")
  STRICT_ALLOW=1
}

mode_github() {
  cd "$ROOT" || die "cannot enter root: $ROOT"
  load_allow "$ALLOW"
  local evname=${GITHUB_EVENT_NAME-}
  COMMITS=0
  local -a excl=()
  case "$evname" in
    pull_request)
      read_event
      local base head bref
      base=$(ev pr_base_sha); head=$(ev pr_head_sha); bref=$(ev pr_base_ref)
      need_sha "$base" "PR base"; need_sha "$head" "PR head"; need_ref "$bref" "PR base ref"
      add_segment "PR title" "$TMP/ev/pr_title"
      add_segment "PR body" "$TMP/ev/pr_body"
      local href; href=$(ev pr_head_ref)   # text only: scanned, never used in a command
      add_segment "PR branch names" <(printf '%s\n%s\n' "$href" "$bref")
      git cat-file -e "${base}^{commit}" 2>/dev/null || die "PR base commit is not in the checkout (fetch-depth: 0 required)"
      git cat-file -e "${head}^{commit}" 2>/dev/null || die "PR head commit is not in the checkout (fetch-depth: 0 required)"
      # The PR's own commits: reachable from head, not from the event's base and not from the
      # CURRENT base branch (the payload base can be stale once the PR has merged the base in).
      excl=("^$base")
      if [[ -n $bref ]] && git rev-parse -q --verify "refs/remotes/origin/$bref" >/dev/null; then
        excl+=("^refs/remotes/origin/$bref")
      fi
      # Additions to the allowlist itself are judged against the base branch's version.
      if [[ -n $bref ]] && git rev-parse -q --verify "refs/remotes/origin/$bref" >/dev/null; then
        load_base_allow "refs/remotes/origin/$bref"
      else
        load_base_allow "$base"
      fi
      add_commits "$head" "${excl[@]}"
      scan_corpus "PR title, PR body and $COMMITS commit(s)"
      ;;
    push)
      read_event
      local before after ref def
      before=$(ev push_before); after=$(ev push_after); ref=$(ev push_ref); def=$(ev default_branch)
      need_sha "$after" "pushed commit"; need_ref "$def" "default branch"   # $ref is text only
      git cat-file -e "${after}^{commit}" 2>/dev/null || die "pushed commit is not in the checkout"
      add_segment "pushed ref name" <(printf '%s\n' "$ref")
      # Off the default branch, commits already on it (e.g. a merged-in main) are not this push's.
      local on_default=1
      if [[ -n $def && $ref != "refs/heads/$def" ]]; then
        on_default=0
        if git rev-parse -q --verify "refs/remotes/origin/$def" >/dev/null; then excl=("^refs/remotes/origin/$def"); fi
      fi
      if [[ $before =~ ^0+$ || -z $before ]] || ! git cat-file -e "${before}^{commit}" 2>/dev/null; then
        # New branch, or a force push whose old tip is gone. Off the default branch that is
        # everything not already on it; with no such bound only the tip is scanned, because the
        # default branch's own history holds old, known findings that must not turn every such
        # push red (the tree scan still covers the whole tree).
        if (( ${#excl[@]} )); then add_commits "$after" "${excl[@]}"; else add_commits -n 1 "$after"; fi
        if (( on_default == 0 )) && git rev-parse -q --verify "refs/remotes/origin/$def" >/dev/null; then
          load_base_allow "refs/remotes/origin/$def"
        fi
      else
        if (( on_default == 0 )); then load_base_allow "$before"; fi
        add_commits "${before}..${after}" "${excl[@]}"
      fi
      scan_corpus "$COMMITS pushed commit(s)"
      ;;
    *)
      echo "secret-scan: event '${evname:-none}' has no commit/PR text to scan; tree scan only."
      ;;
  esac
}

# ----------------------------------------------------------------------------
# Argument parsing
# ----------------------------------------------------------------------------
[[ $# -ge 1 ]] || die "usage: secret_scan.sh tree|text|commits|github [options]"
CMD=$1; shift
ROOT=. ALLOW="" LABEL="" TEXTFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)  ROOT=${2-}; shift 2 ;;
    --allow) ALLOW=${2-}; shift 2 ;;
    --label) LABEL=${2-}; shift 2 ;;
    --file)  TEXTFILE=${2-}; shift 2 ;;
    --) shift; break ;;
    *) die "unknown option: $1" ;;
  esac
done
[[ -d $ROOT ]] || die "root is not a directory: $ROOT"
ROOT=$(cd "$ROOT" && pwd -P)
[[ -n $ALLOW ]] || ALLOW=$ROOT/.github/secret-scan-allow.txt
if [[ $ALLOW != /* ]]; then ALLOW=$PWD/$ALLOW; fi
ALLOW_DIR=$(cd "$(dirname "$ALLOW")" 2>/dev/null && pwd -P) || ALLOW_DIR=""
ALLOW_ABS=$ALLOW_DIR/$(basename "$ALLOW")

case "$CMD" in
  tree)    mode_tree ;;
  github)  mode_github ;;
  text)
    [[ -n $LABEL && -f $TEXTFILE ]] || die "text mode needs --label and an existing --file"
    load_allow "$ALLOW"
    add_segment "$LABEL" "$TEXTFILE"
    scan_corpus "$LABEL"
    ;;
  commits)
    cd "$ROOT" || die "cannot enter root"
    load_allow "$ALLOW"
    COMMITS=0
    add_commits "$@"
    scan_corpus "$COMMITS commit message(s)"
    ;;
  *) die "unknown command: $CMD" ;;
esac
