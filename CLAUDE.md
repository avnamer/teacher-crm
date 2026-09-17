# Teacher CRM — working notes for Claude Code sessions

## Deployment costs money — read this before pushing

This project deploys to Netlify on a **credit-based Free plan (300 credits/month)**.
**Every production deploy costs 15 credits** (≈20 deploys/month before the site gets
paused). Deploy Previews (pull requests against a non-production branch) are **free**.

The team burned through an entire month's credits in about a day during a single
active development session, because every push went straight to the branch Netlify
was treating as production. The user had to pay for extra credits to recover. Do not
repeat this.

### The rule

- **`main` is the only branch Netlify deploys to production.** Confirm this hasn't
  drifted: Netlify dashboard → this project → Project configuration → Build & deploy →
  Branches and deploy contexts → "Production branch" must say `main`.
- **Never push directly to `main` for work in progress.** Do all work on a feature
  branch. Pushes to a feature branch trigger a free Deploy Preview, not a paid
  production deploy — that's exactly what you want while iterating.
- **Test locally before pushing anything.** Run the app with the `run-teacher-crm`
  skill (`npm run dev` for both frontend and backend), verify the feature actually
  works in the browser, and only then push.
- **Batch commits.** Don't push after every small fix — accumulate a feature's worth
  of changes, verify them together locally, and push once. A session that pushes 7
  times for 7 small fixes costs 7x what one batched push would (if those pushes had
  gone to `main`); even on a feature branch, fewer pushes means fewer things to verify
  and less noise in PR history.
- **Merge to `main` only when a feature is fully done and tested.** That merge is the
  one deploy that should actually cost credits — make it count. Do not merge
  half-finished work just to "check if it deploys."
- Merging a PR is a significant action on shared state — Claude Code's safety
  classifier may block agents from merging PRs directly. Merge only through the
  `close-teacher-crm-feature` skill (the user says "סיימנו כאן") or let the user merge;
  if the merge is blocked, hand the user the PR link — don't try to work around it.
- If you're mid-debugging and need multiple rounds of push-test-push (e.g. chasing a
  bug that only reproduces in production), use Netlify's **"Lock to stop auto
  publishing"** button on the Deploys page first, iterate freely, then unlock and
  push once when you're confident in the fix.

### Exception: the "סיימנו כאן" close-out
When the user invokes the `close-teacher-crm-feature` skill ("סיימנו כאן", "תעלה את
השינויים לרשת", "ship it", etc.), **all the credit-saving rules in this section are
suspended for the duration of that skill.** The user has declared the work done, so
the goal becomes a complete update of GitHub and the live Netlify site: commit all
finished work, push, open the PR, merge to `main`, and let the production deploy run —
without holding back to save credits. The concurrent-session rules below (scoped
staging, no direct push to `main`) still apply. After the skill finishes, these
credit-saving rules are back in force.

### If you're not sure whether something is actually live

Don't assume a local fix is live for the user just because it's pushed. Ask (or
check the Netlify Deploys page) whether the push actually reached a production
deploy, especially if:
- credits might be exhausted (check the Netlify dashboard banner — a paused-deploys
  banner means pushes are being silently skipped)
- the push went to a branch that isn't the current production branch

A code fix that never deployed will look identical to a bug that wasn't fixed, from
the user's side — this caused significant back-and-forth in a past session before
the real cause (paused deploys) was found.

## Project structure

- `frontend/` — React + Vite, deployed to Netlify (`comforting-pegasus-780af0.netlify.app`)
- `backend/` — Node/Express, must be reachable at whatever `VITE_BACKEND_URL` the
  Netlify frontend build is configured with (check Netlify env vars — this is not
  necessarily `localhost:3001`, that's only the local-dev default)
- Local dev: use the `run-teacher-crm` skill
- Git commits/pushes: use the `commit-teacher-crm` skill (this is its own repo,
  separate from the outer `pic_cleaner` checkout at `C:\Users\Avner`)
- Data lives in Supabase project `teacher-crm` (ref `ltfguyjrwrcghllvrixu`) — see the
  `run-teacher-crm` skill for how to check/resume it if paused (separate free-tier
  auto-pause behavior, unrelated to Netlify credits)
- Architecture, schema, endpoints, env vars, deployment: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Documentation — where things go

- **Open items** (bugs, review findings not fixed, tech debt, ideas, product questions)
  → a **GitHub Issue** (`gh issue create --repo avnamer/teacher-crm`), never a list in an
  MD file. Check `gh issue list --search` for duplicates first.
- **Current state** (schema, endpoints, env, shared modules, deploy) → `docs/ARCHITECTURE.md`.
- **What shipped when** → a row in the feature log in `docs/README.md`.
- **Why it was designed this way** → the feature's spec in `docs/superpowers/specs/` and its PR description.
- `docs/superpowers/plans/`, `docs/superpowers/specs/` and `docs/history/` are historical — don't rewrite them.
- Link, don't copy. The `close-teacher-crm-feature` skill does the docs update as part of every close-out.

## Concurrent sessions share this checkout

More than one Claude Code session may be working in this repo at the same time,
editing the same files on the same disk. Git sees a single working tree — it cannot
tell which session made which edit, so a broad stage silently ships the other
session's work under your commit message.

### The rule

- **Stage specific files. Never `git add -A` or `git commit -a` here.** Use
  `git add <path1> <path2>` or `git commit <path1> <path2>`.
- **Run `git status` and `git fetch origin` before committing** — check both what's
  uncommitted and whether `origin` has moved under you.
- **Leave unrelated uncommitted changes alone.** Don't stage, revert, stash, or
  "clean up" files you didn't touch; another session is likely mid-edit. Report them
  to the user instead of acting unilaterally.
- **Commit your own work as soon as it's verified.** The window between "it works"
  and "I committed it" is exactly when another session's broad stage can claim it.
  Don't leave a finished change uncommitted while you run dev servers, take
  screenshots, or wait for the user to look at it.
- **Don't switch branches here** (`git checkout` / `git switch`) — it changes files
  under the other session without warning, and kills any dev server they have
  running. If you need a different base, make a temporary worktree instead:
  `git worktree add <tmp-path> -b <branch> origin/main`.
- **Hebrew/UTF-8 text passed as an inline shell argument on Windows can get silently
  corrupted to `?` characters** (observed with `curl -d '{"school": "..."}'` against
  the Supabase REST API — the request went through with no error, but the stored
  value was garbled). Always write JSON payloads with non-ASCII content to a file
  (e.g. via the Write tool, which preserves UTF-8) and send them with
  `curl --data-binary @file.json` instead of an inline `-d`/`--data-raw` string.

### This has already happened, more than once

- A page-title edit to `Contacts.jsx` was swallowed by another session's broad
  commit, repeatedly.
- `Dashboard.jsx` was observed deleted mid-edit by another session.
- 2026-09-12: a finished dashboard task-counter change to `Contacts.jsx` sat
  uncommitted while a concurrent WhatsApp session ran a broad commit. It was swept
  into `588f6a2` ("Make WhatsApp messages actually sendable via click-to-chat") and
  pushed to PR #5 under a message that never mentioned it. Nothing was lost, but two
  unrelated features became coupled — reverting the WhatsApp work would also have
  reverted the counters, and the change shipped undocumented.
- 2026-09-17: a session found itself on a stale, already-merged branch
  (`docs/close-out-2026-09-16`) with new uncommitted work and switched straight to
  `main` and back out to a fresh branch to fix it — violating the no-checkout rule
  above. No harm resulted only because that stale branch happened to be idle. Use
  `git worktree add` for this, every time, even when fixing your own stale branch.

Nothing has been permanently lost in any of these, because the work was always
recoverable. The real cost is coupling: it makes review, rollback, and "what shipped
when" much harder to reason about. Scoped commits and prompt commits prevent all of
it.
