import { describe, expect, it } from 'bun:test'
import { buildSystemPrompt } from '../../src/agent/prompt'

describe('buildSystemPrompt', () => {
  it('allows opening a page for manual handoff in browser mode', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).toContain(
      'Use `new_page` only when the user explicitly asks to open a page/tab, or when manual handoff requires user interaction on a specific URL',
    )
    expect(prompt).toContain('<manual_handoff>')
    expect(prompt).toContain(
      'Open the relevant page with `new_page(url)` if the required site is not already visible.',
    )
    expect(prompt).toContain(
      'If a request is executable with available tools, execute it directly.',
    )
    expect(prompt).toContain(
      'When the user provides a checklist of UI steps, treat it as execution instructions for you to perform',
    )
    expect(prompt).toContain(
      'Never read `.env` files (including `.env`, `.env.*`, and local env secret files).',
    )
    expect(prompt).toContain(
      'Track prerequisites already confirmed by the user and do not ask for the same prerequisite again unless a verification check fails.',
    )
  })

  it('enforces integration-first execution for connected apps', () => {
    const prompt = buildSystemPrompt({ connectedApps: ['Supabase'] })

    expect(prompt).toContain(
      '**Connected apps** (use Strata tools for these): Supabase',
    )
    expect(prompt).toContain(
      'For connected services, proactively complete the requested operation via Strata tools',
    )
    expect(prompt).toContain(
      'For connected services like Supabase, Vercel, and GitHub, prefer Strata tools for service operations',
    )
    expect(prompt).toContain(
      'Supabase: use Strata to create/manage databases or projects, list projects, and run supported project operations.',
    )
    expect(prompt).toContain(
      'Vercel: use Strata to list apps/projects/deployments and run supported project/deploy operations.',
    )
    expect(prompt).toContain(
      'GitHub: use Strata to create/list repositories and run supported repo/issue/PR operations.',
    )
  })

  it('does not include browser-mode manual handoff section in coding mode', () => {
    const prompt = buildSystemPrompt({ codingMode: true })

    expect(prompt).not.toContain('<manual_handoff>')
    expect(prompt).toContain('<manual_handoff_when_blocked>')
    expect(prompt).toContain('http://127.0.0.1:<port>/')
    expect(prompt).toContain('rewrite host to `127.0.0.1`')
    expect(prompt).toContain('<planning_gate_before_coding>')
    expect(prompt).toContain('architecture.md')
    expect(prompt).toContain('database-schema.md')
    expect(prompt).toContain('tasks.md')
    expect(prompt).toContain(
      'For frontend-only tasks, `database-schema.md` is not required.',
    )
    expect(prompt).toContain(
      'proactively load `coding-web-applications` as the primary skill before planning or implementation.',
    )
    expect(prompt).toContain('Operational/no-code task')
    expect(prompt).toContain(
      'For operational/no-code tasks (preview/run/deploy/status), skip planning docs and execute directly after VS Code Web verification.',
    )
    expect(prompt).toContain(
      'Populate `architecture.md` like a senior engineer design brief with clear sections for: frontend architecture, backend/service architecture, system architecture, and data/database architecture',
    )
    expect(prompt).toContain(
      'For backend/full-stack tasks, populate `database-schema.md` as a project artifact with the planned schema: tables, columns/types, primary/foreign keys, indexes, relationships, constraints, and migration notes',
    )
    expect(prompt).toContain(
      'For frontend-only tasks, skip this file.',
    )
    expect(prompt).toContain(
      'Before calling `vscode_web` action "open", call `list_pages` and reuse an existing VS Code Web tab if it already matches the exact resolved folder',
    )
    expect(prompt).toContain(
      'In coding mode, do not proceed unless a repository is open in VS Code Web in the browser',
    )
    expect(prompt).toContain(
      'If an existing VS Code Web tab already points to the exact same resolved folder',
    )
    expect(prompt).toContain(
      'Call `list_pages` first and check whether a VS Code Web tab already points to the exact same resolved repo folder',
    )
    expect(prompt).toContain(
      'For JavaScript-based CLI installation (including `vercel`), use Bun global install commands',
    )
    expect(prompt).toContain('Do not use `npm install -g`')
    expect(prompt).toContain('folder=<resolved-path>')
    expect(prompt).toContain('<deployment_cicd_orchestration>')
    expect(prompt).toContain(
      'Create/link the Vercel project before asking the user to configure Vercel environment variables.',
    )
    expect(prompt).toContain(
      'Keep task-level prerequisite state (connected apps, chosen deploy path, repo name, env-var confirmation, push approval)',
    )
  })
})
