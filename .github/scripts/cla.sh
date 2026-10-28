#!/usr/bin/env bash
# CLA check for pull requests, run by .github/workflows/cla.yml.
#
# Everyone who authored a commit in a PR must have signed CLA.md. Signatures live in
# signatures/version1/cla.json on the cla-signatures branch, and only this script writes
# them. A contributor signs by commenting SIGN_PHRASE on their PR. The result is posted
# as the commit status "license/cla", which is a required check on main.
#
# It never checks out or runs PR code: everything goes through the GitHub API.
#
# Env: GH_TOKEN, REPO (owner/name), EVENT (pull_request_target, issue_comment or
# workflow_dispatch), PR (a number; empty on workflow_dispatch = every open PR into main).
# issue_comment also sets COMMENT_BODY, COMMENT_ID, COMMENT_USER, COMMENT_USER_ID and
# COMMENT_CREATED_AT. DRY_RUN=1 prints the writes instead of making them.
set -euo pipefail

SIGN_PHRASE='I have read the CLA Document and I hereby sign the CLA'
SIGN_BRANCH='cla-signatures'
SIGN_FILE='signatures/version1/cla.json'
STATUS_CONTEXT='license/cla'
CLA_URL="https://github.com/$REPO/blob/main/CLA.md"
MARKER='<!-- kalamio-cla -->'
# Don't need to sign: the maintainers, bots (any login ending in "[bot]") and web-flow,
# which commits merges made in GitHub's UI (e.g. "Update branch").
ALLOWLIST=' harishsehlangia himanshu82817 web-flow '

# Run a GitHub write, or only print it on a dry run.
write() {
    if [ -n "${DRY_RUN:-}" ]; then
        printf 'DRY RUN: gh' >&2; printf ' %q' "$@" >&2; echo >&2
    else
        gh "$@"
    fi
}

allowlisted() { [[ "$1" == *'[bot]' || "$ALLOWLIST" == *" $1 "* ]]; }

# Sets SIG_JSON (the file's contents) and SIG_SHA (its blob sha, for the next update).
load_signatures() {
    local res
    res=$(gh api "repos/$REPO/contents/$SIGN_FILE?ref=$SIGN_BRANCH")
    SIG_SHA=$(jq -r .sha <<<"$res")
    SIG_JSON=$(jq -r .content <<<"$res" | base64 -d)
}

signed() { jq -e --argjson id "$1" '.signedContributors | any(.id == $id)' <<<"$SIG_JSON" >/dev/null; }

# One line per commit: author login, author id, author name, separated by \x1f. Login and id
# are empty when the commit email isn't linked to a GitHub account. (Not tabs: `read` treats
# them as whitespace and merges empty fields, which shifts the name into the login.)
SEP=$'\x1f'
authors() {
    gh api --paginate "repos/$REPO/pulls/$1/commits?per_page=100" \
        --jq '.[] | [(.author.login // ""), ((.author.id // "") | tostring), .commit.author.name] | join("\u001f")'
}

set_status() { # sha, state, description
    write api -X POST "repos/$REPO/statuses/$1" -f state="$2" -f context="$STATUS_CONTEXT" \
        -f description="$3" -f target_url="$CLA_URL" --silent
}

# Create or update our one comment on the PR. With "edit-only", only update an existing one,
# so PRs that never needed a signature don't get a comment.
upsert_comment() { # pr, body, [edit-only]
    local id old
    id=$(gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100" \
        --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"$MARKER\"))) | .id" | sed -n 1p)
    if [ -n "$id" ]; then
        old=$(gh api "repos/$REPO/issues/comments/$id" --jq .body)
        [ "$old" = "$2" ] || write api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$2" --silent
    elif [ "${3:-}" != edit-only ]; then
        write api -X POST "repos/$REPO/issues/$1/comments" -f body="$2" --silent
    fi
}

check() {
    local pr=$1 pr_json state head commits login id name body
    pr_json=$(gh api "repos/$REPO/pulls/$pr")
    state=$(jq -r .state <<<"$pr_json")
    if [ "$state" != open ]; then echo "#$pr is $state, nothing to check."; return; fi
    if [ "$(jq -r .base.ref <<<"$pr_json")" != main ]; then echo "#$pr doesn't target main, skipping."; return; fi
    head=$(jq -r .head.sha <<<"$pr_json")
    # A separate assignment (not `local x=$(…)` or `< <(…)`), so a failed API call stops the
    # script instead of leaving an empty author list that would pass.
    commits=$(authors "$pr")

    local -a missing=() unlinked=()
    local -A seen=()
    while IFS=$SEP read -r login id name; do
        [ -n "$login$id$name" ] || continue
        if [ -z "$login" ]; then
            [ -n "${seen["?$name"]:-}" ] || unlinked+=("$name")
            seen["?$name"]=1
            continue
        fi
        [ -z "${seen[$login]:-}" ] || continue
        seen[$login]=1
        allowlisted "$login" || signed "$id" || missing+=("$login")
    done <<<"$commits"

    if [ ${#missing[@]} -eq 0 ] && [ ${#unlinked[@]} -eq 0 ]; then
        echo "#$pr: every commit author has signed (or doesn't need to)."
        set_status "$head" success 'All contributors have signed the CLA.'
        upsert_comment "$pr" "$MARKER
All contributors have signed the [CLA]($CLA_URL). Thank you!" edit-only
        return
    fi

    echo "#$pr: not signed: ${missing[*]:-none}; not linked to a GitHub account: ${unlinked[*]:-none}"
    set_status "$head" pending 'Contributor License Agreement is not signed yet.'
    body="$MARKER
Thanks for your pull request! Before it can be merged, everyone who authored a commit in it needs to sign our [Contributor License Agreement]($CLA_URL). You keep the copyright to your work; the CLA explains what you grant. You only sign once, and it covers your future pull requests too."
    if [ ${#missing[@]} -gt 0 ]; then
        body+="

**To sign**, read the [CLA]($CLA_URL), then post this exact comment on this pull request:

\`\`\`
$SIGN_PHRASE
\`\`\`

Still needs to sign: $(printf '@%s, ' "${missing[@]}" | sed 's/, $//')"
    fi
    if [ ${#unlinked[@]} -gt 0 ]; then
        body+="

Some commits are by an author whose email isn't linked to a GitHub account ($(printf '%s, ' "${unlinked[@]}" | sed 's/, $//')), so we can't tell who signed. Add that email to your GitHub account under Settings → Emails, or amend the commits to use an email that is, then push."
    fi
    body+="

Comment \`recheck\` to run this check again."
    upsert_comment "$pr" "$body"
}

# Record the commenter's signature (they must have authored a commit in the PR), then re-check.
sign() {
    local pr=$1 commits entry attempt content
    if signed "$COMMENT_USER_ID"; then
        echo "$COMMENT_USER has already signed."
        check "$pr"
        return
    fi
    commits=$(authors "$pr")
    if ! cut -d "$SEP" -f2 <<<"$commits" | grep -Fx "$COMMENT_USER_ID" >/dev/null; then
        echo "$COMMENT_USER has no commits in #$pr, so no signature is recorded here."
        check "$pr"
        return
    fi
    entry=$(jq -n --arg name "$COMMENT_USER" --argjson id "$COMMENT_USER_ID" --argjson comment_id "$COMMENT_ID" \
        --arg created_at "$COMMENT_CREATED_AT" --argjson pr "$pr" \
        '{name: $name, id: $id, comment_id: $comment_id, created_at: $created_at, pull_request: $pr}')
    # Two people can sign at the same moment on different PRs: if the file changed since we
    # read it, GitHub rejects the stale sha, so re-read and try again.
    for attempt in 1 2 3 4 5; do
        content=$(jq --argjson e "$entry" '.signedContributors += [$e]' <<<"$SIG_JSON")
        if write api -X PUT "repos/$REPO/contents/$SIGN_FILE" -f branch="$SIGN_BRANCH" -f sha="$SIG_SHA" \
            -f message="cla: $COMMENT_USER signed in #$pr" -f content="$(base64 -w0 <<<"$content")" --silent; then
            SIG_JSON=$content
            echo "Recorded $COMMENT_USER's signature."
            check "$pr"
            return
        fi
        sleep $((attempt * 2))
        load_signatures
        if signed "$COMMENT_USER_ID"; then check "$pr"; return; fi
    done
    echo "::error::Couldn't save $COMMENT_USER's signature to $SIGN_FILE on $SIGN_BRANCH."
    exit 1
}

load_signatures

case "$EVENT" in
    pull_request_target)
        check "$PR"
        ;;
    issue_comment)
        body=${COMMENT_BODY//$'\r'/}
        body=${body#"${body%%[![:space:]]*}"} # trim leading whitespace
        body=${body%"${body##*[![:space:]]}"} # trim trailing whitespace
        shopt -s nocasematch
        if [[ "$body" == "$SIGN_PHRASE" || "$body" == "$SIGN_PHRASE." ]]; then
            sign "$PR"
        elif [[ "$body" == recheck ]]; then
            check "$PR"
        fi
        ;;
    workflow_dispatch)
        if [ -n "${PR:-}" ]; then
            check "$PR"
        else
            prs=$(gh api --paginate "repos/$REPO/pulls?state=open&base=main&per_page=100" --jq '.[].number')
            # Each PR in its own process: bash ignores `set -e` inside `check … || …`, so an
            # API error there would carry on instead of stopping that PR's check.
            for pr in $prs; do
                PR=$pr bash "${BASH_SOURCE[0]}" || echo "::warning::Couldn't check #$pr."
            done
        fi
        ;;
    *)
        echo "::error::Unexpected event: $EVENT"
        exit 1
        ;;
esac
