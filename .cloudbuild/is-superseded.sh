#!/usr/bin/env bash
# Tells a dev deploy whether a newer commit on main supersedes it. The deploy steps in
# cloudbuild-web-dev.yaml and cloudbuild-api-dev.yaml run it right before `gcloud run deploy`:
# exit 0 means skip the deploy, any other exit means deploy.
#
# Usage: .cloudbuild/is-superseded.sh <commit> <path>...
#   <commit>  the full SHA the build deploys ($COMMIT_SHA)
#   <path>    the trigger's included files as git paths, e.g. frontend/ for frontend/**.
#             Keep them in step with the trigger in GCP.
#
# Why: every merge to main that changes <path> starts a build, and the builds run in parallel.
# When PRs merge minutes apart, an older build can finish last and leave dev on an older commit.
# On 2026-11-25 the build for #127 finished a second after the build for #129, and dev served
# #127 until the trigger was rerun by hand.
#
# The check, against main on GitHub:
#   - <commit> is main's head: deploy.
#   - a later commit on main changes <path>: it starts its own build, which deploys it along
#     with this commit's changes, so skip. A commit with [skip ci] or [ci skip] in its message
#     starts no build, so it doesn't count (matched in any case, so a doubtful one means deploy).
#   - later commits change only other paths: no newer build of this trigger is coming, so deploy.
#   - <commit> isn't on main, or main can't be read: deploy, as before this check existed.
set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: $0 <commit> <path>..." >&2
    exit 2
fi
commit=$1
shift

repo=https://github.com/kalamiohq/kalamio
branch=main

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Commits and trees only, no file contents: enough to tell which paths each commit changed.
# GIT_TERMINAL_PROMPT=0 makes git fail instead of waiting for a password if the repo is private.
if ! GIT_TERMINAL_PROMPT=0 timeout 60 git clone --quiet --bare --no-tags --single-branch \
    --branch "$branch" --filter=blob:none "$repo" "$tmp/repo.git"; then
    echo "Couldn't read $branch from $repo, so deploying without the check." >&2
    exit 1
fi
cd "$tmp/repo.git"

head=$(git rev-parse "refs/heads/$branch")
if [ "$commit" = "$head" ]; then
    echo "${commit:0:7} is the head of $branch: deploying it."
    exit 1
fi

# Look for <commit> in main's history rather than asking git for it by name: in this partial
# clone, git would go back to GitHub for a commit it doesn't have.
if ! git rev-list "$head" | grep -xF "$commit" >/dev/null; then
    echo "${commit:0:7} isn't on $branch (now at ${head:0:7}), so deploying it anyway."
    exit 1
fi

newer=$(git log --format='  %h %s' --regexp-ignore-case --fixed-strings --invert-grep \
    --grep='[skip ci]' --grep='[ci skip]' "$commit..$head" -- "$@")
if [ -z "$newer" ]; then
    echo "$branch is now at ${head:0:7}, but no later commit that changes $* starts a build:" \
        "deploying ${commit:0:7}."
    exit 1
fi

echo "Not deploying ${commit:0:7}: later commits on $branch change $*, so a newer build deploys" \
    "instead:"
echo "$newer"
exit 0
