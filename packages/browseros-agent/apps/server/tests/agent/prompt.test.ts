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
  })

  it('does not include browser-mode manual handoff section in coding mode', () => {
    const prompt = buildSystemPrompt({ codingMode: true })

    expect(prompt).not.toContain('<manual_handoff>')
    expect(prompt).toContain('<manual_handoff_when_blocked>')
    expect(prompt).toContain('http://127.0.0.1:<port>/')
    expect(prompt).toContain('rewrite host to `127.0.0.1`')
    expect(prompt).toContain('<planning_gate_before_coding>')
    expect(prompt).toContain('architecture.md')
    expect(prompt).toContain('tasks.md')
    expect(prompt).toContain('Immediately call `list_pages`')
    expect(prompt).toContain('folder=<resolved-path>')
  })
})
