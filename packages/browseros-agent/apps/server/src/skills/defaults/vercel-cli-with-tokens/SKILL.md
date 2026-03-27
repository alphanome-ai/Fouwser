---
name: vercel-cli-with-tokens
description: Deprecated. Token-based Vercel CLI guidance has been merged into the deploy-to-vercel skill.
metadata:
  display-name: Deploy to Vercel with cli-tokens (Deprecated)
  enabled: "false"
  author: vercel
  version: "2.0.0"
---

# Deprecated Skill

This skill has been consolidated into `deploy-to-vercel`.

Use `deploy-to-vercel` for both:
- token-based CLI authentication (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`)
- interactive login/linking flows

Default deployment workflow in the canonical skill is CI/CD-first:
1. push to GitHub (with explicit approval)
2. deploy on Vercel from the pushed branch

If this deprecated skill still appears in an existing installation, disable/remove it and use `deploy-to-vercel`.
