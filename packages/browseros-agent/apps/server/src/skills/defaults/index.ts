import codingWebApplications from './coding-web-applications/SKILL.md' with {
  type: 'text',
}
import comparePrices from './compare-prices/SKILL.md' with { type: 'text' }
import deepResearch from './deep-research/SKILL.md' with { type: 'text' }
import deployToVercel from './deploy-to-vercel/SKILL.md' with { type: 'text' }
import extractData from './extract-data/SKILL.md' with { type: 'text' }
import fillForm from './fill-form/SKILL.md' with { type: 'text' }
import findAlternatives from './find-alternatives/SKILL.md' with {
  type: 'text',
}
import manageBookmarks from './manage-bookmarks/SKILL.md' with { type: 'text' }
import monitorPage from './monitor-page/SKILL.md' with { type: 'text' }
import organizeTabs from './organize-tabs/SKILL.md' with { type: 'text' }
import readLater from './read-later/SKILL.md' with { type: 'text' }
import savePage from './save-page/SKILL.md' with { type: 'text' }
import screenshotWalkthrough from './screenshot-walkthrough/SKILL.md' with {
  type: 'text',
}
import summarizePage from './summarize-page/SKILL.md' with { type: 'text' }
import supabasePostgresBestPractices from './supabase-postgres-best-practices/SKILL.md' with {
  type: 'text',
}
import vercelCliWithTokens from './vercel-cli-with-tokens/SKILL.md' with {
  type: 'text',
}
import vercelReactBestPractices from './vercel-react-best-practices/SKILL.md' with {
  type: 'text',
}

type DefaultSkill = { id: string; content: string }

export const DEFAULT_SKILLS: DefaultSkill[] = [
  { id: 'coding-web-applications', content: codingWebApplications },
  { id: 'deploy-to-vercel', content: deployToVercel },
  { id: 'summarize-page', content: summarizePage },
  { id: 'deep-research', content: deepResearch },
  { id: 'extract-data', content: extractData },
  { id: 'fill-form', content: fillForm },
  { id: 'screenshot-walkthrough', content: screenshotWalkthrough },
  { id: 'organize-tabs', content: organizeTabs },
  { id: 'compare-prices', content: comparePrices },
  { id: 'find-alternatives', content: findAlternatives },
  { id: 'save-page', content: savePage },
  { id: 'monitor-page', content: monitorPage },
  { id: 'read-later', content: readLater },
  { id: 'manage-bookmarks', content: manageBookmarks },
  { id: 'vercel-cli-with-tokens', content: vercelCliWithTokens },
  { id: 'vercel-react-best-practices', content: vercelReactBestPractices },
  {
    id: 'supabase-postgres-best-practices',
    content: supabasePostgresBestPractices,
  },
]
