#!/usr/bin/env bash
# Thanks a contributor when their pull request is merged, run by .github/workflows/merged-thanks.yml.
#
# Posts one comment on the merged PR: a thank-you (with a welcome on a first contribution) and
# ready-made share links, so the contributor can post about it on LinkedIn or X and tag Kalamio
# and Harish, who like and reshare those posts. Skips unmerged PRs, maintainers, bots, and PRs
# that already have the comment, so running it again is safe.
#
# It never checks out or runs PR code: the PR's title and author come from the GitHub API.
#
# Env: GH_TOKEN, REPO (owner/name), PR (a number). DRY_RUN=1 prints the comment instead of
# posting it.
set -euo pipefail

MARKER='<!-- kalamio-merged-thanks -->'
# No thank-you for the maintainers themselves, or for bots (any login ending in "[bot]").
MAINTAINERS=' harishsehlangia himanshu82817 '
LINKEDIN_PERSON='https://linkedin.com/in/harishsehlangia'
LINKEDIN_PAGE='https://www.linkedin.com/company/kalamio'
X_PERSON='harishsehlangia'
X_PAGE='kalamiohq'
HASHTAGS='#opensource #KalamioContributor'
DISCORD='https://kalamio.com/discord'

uri() { jq -rn --arg s "$1" '$s | @uri'; }

pr_json=$(gh api "repos/$REPO/pulls/$PR")
author=$(jq -r .user.login <<<"$pr_json")
url=$(jq -r .html_url <<<"$pr_json")

if [ -z "$(jq -r '.merged_at // empty' <<<"$pr_json")" ]; then
    echo "#$PR isn't merged, nothing to do."; exit 0
fi
if [[ "$author" == *'[bot]' || "$(jq -r .user.type <<<"$pr_json")" == Bot || "$MAINTAINERS" == *" $author "* ]]; then
    echo "#$PR is by $author (maintainer or bot), no thank-you needed."; exit 0
fi
# Read all comments first: piping straight into `grep -q` can end the pipe early, which
# pipefail would turn into "not found" and a duplicate comment.
comments=$(gh api --paginate "repos/$REPO/issues/$PR/comments?per_page=100" --jq '.[].body')
if grep -qF "$MARKER" <<<"$comments"; then
    echo "#$PR already has the thank-you comment."; exit 0
fi

# This PR counts too, so 1 means it's their first merged PR here.
merged=$(gh api --paginate "repos/$REPO/pulls?state=closed&per_page=100" \
    --jq "[.[] | select(.user.login == \"$author\" and .merged_at != null)] | length" | awk '{ n += $1 } END { print n + 0 }')

# The title goes into the suggested post, so make it read like a sentence: drop the
# Conventional Commits prefix ("fix(editor): ") and capitalise. Keep it on one line, without
# backticks (they'd break the code block), and short enough for a 280-character X post.
title=$(jq -r .title <<<"$pr_json" | tr -d '`\r' | tr '\n' ' ' \
    | sed -E 's/^[a-z]+(\([^)]*\))?!?:[[:space:]]*//; s/^[[:space:]]+|[[:space:]]+$//g')
title="${title^}"
if [ "${#title}" -gt 90 ]; then title="${title:0:87}..."; fi

if [ "$merged" -le 1 ]; then
    welcome="This is your first contribution to Kalamio. Welcome aboard!"
    headline="My first pull request to Kalamio was just merged! 🚀"
else
    welcome="That's $merged merged pull requests so far. Thanks for sticking with us!"
    headline="Another pull request of mine was just merged into Kalamio! 🚀"
fi

post="$headline

\"$title\"

Kalamio is an open-source publishing platform for writers and readers.
$url

$HASHTAGS"
x_post="My pull request \"$title\" was just merged into Kalamio, an open-source publishing platform 🚀 $url @$X_PERSON @$X_PAGE $HASHTAGS"

body="$MARKER
🎉 **Merged! Thank you, @$author.** $welcome It ships to [kalamio.com](https://kalamio.com) with the next release.

### Share it with your network

We'd love to celebrate it with you. Post about it on LinkedIn or X and tag us: we like and reshare every contribution post.

| | Tag |
|---|---|
| **LinkedIn** | [Harish Sehlangia]($LINKEDIN_PERSON) and the [Kalamio page]($LINKEDIN_PAGE) |
| **X** | [\`@$X_PERSON\`](https://x.com/$X_PERSON) and [\`@$X_PAGE\`](https://x.com/$X_PAGE) |

👉 **[Post on X](https://x.com/intent/post?text=$(uri "$x_post"))** (text and tags filled in) · **[Post on LinkedIn](https://www.linkedin.com/sharing/share-offsite/?url=$(uri "$url"))**

For LinkedIn, paste the text below, then type \`@\` and pick **Harish Sehlangia** and **Kalamio** from the list. A name only becomes a tag when you pick it there.

\`\`\`text
$post
\`\`\`

Come say hi on Discord too: $DISCORD"

if [ -n "${DRY_RUN:-}" ]; then
    echo "DRY RUN: would comment on #$PR:"; echo "$body"
else
    gh api "repos/$REPO/issues/$PR/comments" -f body="$body" >/dev/null
    echo "Thanked $author on #$PR."
fi
