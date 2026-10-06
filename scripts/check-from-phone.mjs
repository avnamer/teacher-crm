#!/usr/bin/env node
// One command to check work a cloud/phone Claude session pushed:
//   node scripts/check-from-phone.mjs            -> newest origin/claude/* branch
//   node scripts/check-from-phone.mjs <branch>   -> a specific branch
//
// Run it from your normal checkout (the one that has frontend/.env.local and
// backend/.env). It fetches, checks the branch out in a SEPARATE worktree
// (../teacher-crm-phone, so your main checkout and any other session are not
// touched), copies the env files, installs packages and starts both servers.
// Ctrl+C stops both.
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wt = path.resolve(root, '..', 'teacher-crm-phone')
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const step = (msg) => console.log(`\n=== ${msg}`)

step('Fetching from GitHub')
git(root, 'fetch', 'origin', '--prune')

let branch = process.argv[2]
if (!branch) {
  branch = git(root, 'for-each-ref', '--sort=-committerdate', '--count=1',
    '--format=%(refname:short)', 'refs/remotes/origin/claude/').replace(/^origin\//, '')
  if (!branch) { console.error('No origin/claude/* branch found. Pass a branch name.'); process.exit(1) }
}
console.log(`Branch: ${branch}`)

step('Preparing worktree ' + wt)
if (existsSync(wt)) git(wt, 'checkout', '--detach', `origin/${branch}`)
else git(root, 'worktree', 'add', '--detach', wt, `origin/${branch}`)

step('What changed vs main')
console.log(git(wt, 'log', '--oneline', 'origin/main..HEAD') || '(no commits ahead of main)')
console.log(git(wt, 'diff', '--stat', 'origin/main...HEAD').split('\n').slice(-15).join('\n'))

step('Copying env files')
for (const f of ['frontend/.env.local', 'backend/.env']) {
  const src = path.join(root, f), dst = path.join(wt, f)
  if (!existsSync(src)) console.warn(`MISSING ${f} in main checkout - fill it from the .env.example`)
  else if (!existsSync(dst)) { copyFileSync(src, dst); console.log(`copied ${f}`) }
  else console.log(`${f} already present`)
}

step('Installing packages')
for (const d of ['backend', 'frontend'])
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: path.join(wt, d), stdio: 'inherit', shell: true })

step('Starting servers: frontend http://localhost:5173 (port is pinned; stop any other dev server first), backend per backend/.env PORT')
const procs = ['backend', 'frontend'].map((d) =>
  spawn('npm', ['run', 'dev'], { cwd: path.join(wt, d), stdio: 'inherit', shell: true }))
const stop = () => procs.forEach((p) => p.kill())
process.on('SIGINT', () => { stop(); process.exit(0) })
procs.forEach((p) => p.on('exit', stop))
