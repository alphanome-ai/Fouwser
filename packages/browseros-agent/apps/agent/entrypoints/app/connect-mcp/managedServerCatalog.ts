/**
 * Maps a managed server's display name (e.g. "Gmail") to its Composio slug
 * (e.g. "gmail"). The Fouwser app keys managed servers by display name, but the
 * backend integrations API is slug-based (`/api/v1/integrations/{slug}/...`).
 *
 * Keep in sync with the backend catalog in
 * `app/services/integrations/catalog.py`.
 */
const NAME_TO_SLUG: Record<string, string> = {
  Gmail: 'gmail',
  'Google Calendar': 'googlecalendar',
  'Google Drive': 'googledrive',
  'Google Sheets': 'googlesheets',
  'Google Docs': 'googledocs',
  LinkedIn: 'linkedin',
  GitHub: 'github',
  GitLab: 'gitlab',
  Slack: 'slack',
  Notion: 'notion',
  Linear: 'linear',
  Jira: 'jira',
  Figma: 'figma',
  Canva: 'canva',
  Salesforce: 'salesforce',
  HubSpot: 'hubspot',
  Discord: 'discord',
  WhatsApp: 'whatsapp',
  Airtable: 'airtable',
  Supabase: 'supabase',
  Vercel: 'vercel',
  Asana: 'asana',
  ClickUp: 'clickup',
  Stripe: 'stripe',
  'Microsoft Teams': 'microsoft_teams',
  'Outlook Mail': 'microsoft_outlook',
}

/**
 * Resolve a managed server display name to its integration slug.
 * Throws if the name is not a known managed server.
 */
export function resolveIntegrationSlug(serverName: string): string {
  const slug = NAME_TO_SLUG[serverName]
  if (!slug) {
    throw new Error(`Unknown managed server: ${serverName}`)
  }
  return slug
}
