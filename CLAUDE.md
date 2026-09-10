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
  classifier blocks agents from merging PRs directly. The user merges PRs themselves;
  don't try to work around this.
- If you're mid-debugging and need multiple rounds of push-test-push (e.g. chasing a
  bug that only reproduces in production), use Netlify's **"Lock to stop auto
  publishing"** button on the Deploys page first, iterate freely, then unlock and
  push once when you're confident in the fix.

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
