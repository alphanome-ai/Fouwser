---
name: deploy-to-vercel
description: Unified Vercel deployment skill with CI/CD-first workflow. Use for Vercel deployment, linking, team scope selection, environment variable management, and token-based or interactive CLI authentication.
metadata:
  display-name: Deploy to Vercel
  enabled: "true"
  author: vercel
  version: "4.0.0"
---

# Deploy to Vercel

Use this as the single canonical Vercel deployment skill.

Default workflow is CI/CD-first:
1. Prepare and validate code.
2. Push to GitHub (only after explicit user approval).
3. Let Vercel deploy from the pushed branch.

Use direct `vercel deploy` only when CI/CD push flow is unavailable or the user explicitly asks.

## Required Behavior

- Ask before any `git push`.
- Ask before production deploy actions.
- Prefer repository linking (`vercel link --repo`) when git remote exists.
- Support both auth models:
  - Token-based (`VERCEL_TOKEN`, optional `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`)
  - Interactive (`vercel login`) when token is unavailable.
- Never pass tokens via CLI flags (`--token`). Use environment variables only.

## Load Detailed Playbook

All documentation is in `resources/`:

Before executing deployment actions, load:
- `resources/vercel-deploy-playbook.md`

This playbook contains:
- state detection commands
- CI/CD decision tree
- token and non-token auth flows
- linking and scope rules
- CLI fallback flows for sandboxed environments
- environment variable management and deployment inspection commands

## Bundled Scripts

- `resources/deploy.sh` for claude.ai-style no-auth fallback
- `resources/deploy-codex.sh` for Codex sandbox fallback
