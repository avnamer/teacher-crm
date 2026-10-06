---
name: continue-from-phone
description: Use on the user's PC when they say "נמשיך מהמחשב", or want to run, check and finish work that a phone/cloud session pushed to a claude/* branch. Pulls the branch, starts the app, says exactly what to click, checks Render and Netlify, and guides the user to finish. The user has no programming background — explain in simple Hebrew, one step at a time.
---

# Continue on the PC what was started from the phone

**Never ask the user questions while running this skill** — decide, act, and report. The only
stops are: merging to `main` (only on "סיימנו כאן") and killing a program that is not ours.
Reply in Hebrew, short and concrete. The user is not a programmer: no jargon, no walls of
text, and tell them exactly what to click or type. Do the technical work yourself.
Follow CLAUDE.md (scoped `git add`, no merge to `main` without the user's word,
credits warning). Windows PowerShell: use `curl.exe`, not `curl`.

## 1. Orient (no questions asked)
- `git fetch origin`, `git status`. Uncommitted changes? Report them, don't touch them.
- List unmerged cloud work: for each `origin/claude/*`, `git log origin/main..<branch> --oneline`.
  Squash-merged branches look "ahead" falsely — check with `gh pr list --state all --head <branch>`
  (or the GitHub MCP tools) and skip ones whose PR is merged.
- Pick the branch the user named; otherwise the newest one with real unmerged work. If
  several are plausible, take the newest, start it, and mention the others at the end
  (name + one line each) so the user can say "תעבור לענף X".
- Summarize in 3-4 lines: what it changes and which pages to look at.

## 2. Run the app
- `node scripts/check-from-phone.mjs <branch>` in the background (it uses a separate
  worktree, copies `.env`, installs, starts frontend + backend).
- Frontend must be at http://localhost:5173 (port is pinned). If it fails:
  - **Port busy** (`EADDRINUSE` / strictPort): find the owner with
    `netstat -ano | findstr :5173`, if it is a `node`/`vite` process started from a teacher-crm folder (an earlier run), stop it
    and continue; if it is anything else, tell the user which program and what to close.
  - **`.env` missing**: say which variable NAMES (from `.env.example`) are missing; never print values.
  - **Backend or login can't reach Supabase**: the free project may be paused — see the
    `run-teacher-crm` skill (project ref `ltfguyjrwrcghllvrixu`).
  - **Google login bounces to the Netlify site**: Supabase → Auth → URL Configuration must
    include `http://localhost:5173/**`.
  - **npm errors**: show the last 10 lines in plain words, fix, retry once.
- Confirm both servers answer (`curl.exe -s -o NUL -w "%{http_code}" http://localhost:5173`),
  then give the user the URL.

## 3. Tell the user what to check
Write a numbered click-by-click checklist derived from the branch's diff and its PR
description (e.g. "open /schools, open a school, scroll to history — it should show only
meetings that happened"). Include the one thing most likely to be broken. Then stop and let
the user test; when they report a problem, fix it on the branch, verify locally, commit scoped files.

## 4. Check the live services (only if the branch touches the backend or is already merged)
- **Render** (backend `teacher-crm-backend`, https://teacher-crm-backend.onrender.com):
  `curl.exe -i -m 90 https://teacher-crm-backend.onrender.com/health` (first call may take
  30-50s: cold start). For a new endpoint, `curl.exe -i -X POST <url> -H "Content-Type: application/json" -d "{}"`:
  **404 = not deployed yet**, 400/401/403 = exists. If 404, the user must check in the
  Render dashboard that the service's Branch is `main`, then Manual Deploy → latest commit.
  Tell them precisely where to click.
- **Netlify** (site `comforting-pegasus-780af0`): tell the user in one line to open Deploys and see whether the top deploy is green and
  whether a "deploys paused" banner shows. You can't see it from here; don't wait for the answer.

## 5. Finish
When the user says the feature works: show a 3-line summary of what will ship and that the
merge triggers a production deploy (15 credits). Merge only on "סיימנו כאן" via the
`close-teacher-crm-feature` skill, or hand the user the PR link.
