# Vercel Deploy Playbook (Unified)

This playbook merges token-based and non-token deployment flows.

## Default Strategy (Preferred)

Use this order unless the user asks otherwise:
1. Verify project/deploy state.
2. Ensure Vercel project linkage.
3. Commit + push to GitHub (after explicit approval).
4. Let Vercel deploy from the pushed branch.
5. Report deployment URL and status.

Use direct `vercel deploy` only when:
- repository push flow is unavailable, or
- user explicitly requests CLI deploy, or
- there is no git remote.

## Guardrails

- Never push without explicit user approval.
- Never run production-targeting commands without explicit user approval.
- Never pass secrets with command flags (`--token`).
- Use `VERCEL_TOKEN` env var for token auth.
- If multiple teams exist, ask user which team slug to use.

## Step 1: Gather State

Run these checks before choosing flow:

```bash
# Git remote state
 git remote get-url origin 2>/dev/null

# Local Vercel linkage (either file means linked)
cat .vercel/project.json 2>/dev/null || cat .vercel/repo.json 2>/dev/null

# CLI availability
command -v vercel

# CLI auth status (safe check)
vercel whoami 2>/dev/null

# Token / IDs (if present)
printenv VERCEL_TOKEN
printenv VERCEL_ORG_ID
printenv VERCEL_PROJECT_ID

# Optional: discover token in .env
grep '^VERCEL_TOKEN=' .env 2>/dev/null
```

## Step 2: Resolve Authentication

### Preferred auth source order
1. `VERCEL_TOKEN` already in environment.
2. `.env` value exported into `VERCEL_TOKEN`.
3. Ask user for token (they generate it in Vercel account settings).
4. Fallback to `vercel login` only if token path is unavailable.

### Export from `.env` example

```bash
export VERCEL_TOKEN=$(grep '^VERCEL_TOKEN=' .env | cut -d= -f2-)
```

### Critical token rule

```bash
# Bad
vercel deploy --token "vca_xxx"

# Good
export VERCEL_TOKEN="vca_xxx"
vercel deploy
```

## Step 3: Resolve Team Scope

If user has multiple teams, ask for the team slug once and pass `--scope <team-slug>` in all Vercel CLI commands.

If `.vercel/project.json` or `.vercel/repo.json` already exists, trust its `orgId` unless user asks to switch.

## Step 4: Pick Execution Path

### Path A (Default): GitHub push -> Vercel CI/CD

Use when git remote exists and project can be linked/recognized.

1. Ensure linked project:

```bash
# Preferred when git remote exists
vercel link --repo --scope <team-slug> -y
```

Fallback (no remote):

```bash
vercel link --scope <team-slug> -y
```

2. Ask user approval to push.
3. Commit and push:

```bash
git add .
git commit -m "deploy: <summary>"
git push
```

4. Fetch deployment URL (if CLI can access deployments):

```bash
sleep 5
vercel ls --format json --scope <team-slug>
```

Report latest deployment `url` and status.

### Path B: Direct CLI deploy (fallback / explicitly requested)

Use when no git remote or user asks direct CLI deploy.

Preview (default direct deploy target):

```bash
vercel deploy -y --no-wait --scope <team-slug>
```

Production (only with explicit user approval):

```bash
vercel deploy --prod -y --no-wait --scope <team-slug>
```

Inspect status:

```bash
vercel inspect <deployment-url>
```

### Path C: Quick deploy with project/org IDs

When all are set (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`), deploy without link step:

```bash
vercel deploy -y --no-wait --scope <team-slug>
```

Note: `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` must be set together.

## Environment Variables Management

```bash
# Add variable for all envs
echo "value" | vercel env add VAR_NAME --scope <team-slug>

# Add variable for production only
echo "value" | vercel env add VAR_NAME production --scope <team-slug>

# List vars
vercel env ls --scope <team-slug>

# Pull vars locally
vercel env pull --scope <team-slug>

# Remove var
vercel env rm VAR_NAME --scope <team-slug> -y
```

## Sandbox Fallbacks

### claude.ai-style fallback

```bash
bash /mnt/skills/user/deploy-to-vercel/resources/deploy.sh [path]
```

### Codex fallback

```bash
bash "<skill_dir>/resources/deploy-codex.sh" [path]
```

In Codex sandbox, check CLI availability first (no escalation required):

```bash
command -v vercel
```

Escalate only the actual network deployment command if sandbox blocks network access.

## Output Requirements

Always report:
- deployment method used (CI/CD push or direct CLI)
- branch pushed (if CI/CD)
- deployment URL
- deployment status (`ready`, `building`, `error`, etc.)
- whether production was targeted

If URL retrieval via CLI is unavailable, instruct the user to check Vercel dashboard or git provider status checks.
