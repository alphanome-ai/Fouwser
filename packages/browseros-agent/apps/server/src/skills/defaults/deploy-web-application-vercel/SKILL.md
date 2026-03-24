---
name: deploy-web-application-vercel
description: Deploy a developed web application to Vercel with production-safe checks, environment setup, database migration handling, and post-deploy verification. Use when the user asks to deploy, ship, release, or publish a web app on Vercel.
metadata:
  display-name: Deploy Web App to Vercel
  enabled: "true"
  version: "1.0"
---

# Deploy Web App to Vercel

Use this skill when the user wants to deploy an existing web app to Vercel, including preview and production readiness.

## When to Apply

Activate when the user asks to:

- deploy a web app to Vercel
- publish or ship a Next.js app
- configure Vercel environment variables
- connect a domain
- run production migrations as part of release

## Deployment Workflow

### 1. Preflight Checks

Before deploying, confirm:

- Framework/runtime and package manager (`npm`, `pnpm`, `bun`, `yarn`)
- Build command and output expectations
- Required environment variables and which are production-only
- Database migration strategy (if applicable)

Run locally before deploying:

- lint (project equivalent)
- tests for touched behavior
- production build

If checks fail, fix blockers before deployment.

### 2. Vercel Project Setup

Ensure:

- App repo is connected to the correct Vercel project
- Production branch is correct (commonly `main`)
- Framework preset is detected correctly
- Build and install commands match the repo

If the project does not exist, create it first and link it to the repository.

### 3. Environment Configuration

Set environment variables by environment:

- Development
- Preview
- Production

Rules:

- Never expose secrets to client-side variables
- Keep server secrets in secure env vars
- Document each required variable and its purpose
- Validate at runtime so missing envs fail fast with actionable errors

### 4. Database and Backend Readiness

For apps with backend/data changes:

- Verify migration scripts are present
- Run migrations against production database in a controlled step
- Confirm rollback path for risky schema changes
- Smoke-test critical API routes after deploy

Prefer backward-compatible schema changes for zero-downtime rollout.

### 5. Deploy and Verify

Deploy in this order:

1. Preview deployment (feature branch or latest commit)
2. Verify key user flows, API health, and auth
3. Promote or deploy to production

After production deploy, verify:

- home page and core navigation
- login/signup (if applicable)
- critical API routes and database reads/writes
- logs show no spike in runtime errors

### 6. Domain, DNS, and Security

When custom domain is required:

- Attach domain in Vercel project settings
- Configure DNS records (A/CNAME as instructed)
- Confirm TLS certificate is issued
- Verify redirects (`www` <-> apex) and canonical host behavior

### 7. Rollback Plan

If production issues appear:

- roll back to last known good deployment
- communicate impact and status
- patch and redeploy with a small diff

Always provide the exact rollback action used.

### 8. Manual Handoff for Access/Install Blockers

If deployment cannot be completed automatically because of missing install/auth/access
(for example `vercel` CLI missing, Vercel login/org restrictions, GitHub repo permissions),
switch to a guided handoff instead of stopping.

Required handoff format:

1. Name the exact blocker and failed step
2. Provide short numbered UI steps in Vercel/GitHub
3. Provide exact follow-up CLI commands
4. Ask user to confirm completion, then resume from that checkpoint

Typical command follow-up:

- `vercel login` / `vercel link`
- `vercel env add ...`
- `vercel --prod`
- `git remote add origin ...` and `git push -u origin <branch>`

## Expected Handoff

Provide:

- deployed environment URLs (preview and/or production)
- deployment status summary
- env vars configured (names only, no secret values)
- migration status
- verification checklist results
- known risks and follow-up actions

## Quick Decision Rules

- User says "deploy this Next.js app": use Vercel-first flow
- User asks for "safe deploy": require preview validation and rollback plan
- User asks for "backend deploy too": include migration + API smoke tests
- Missing critical env vars: stop and request values before production deploy
