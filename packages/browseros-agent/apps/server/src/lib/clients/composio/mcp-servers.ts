export interface ComposioMcpServer {
  name: string
  slug: string
  description: string
}

/**
 * Catalog for Composio-supported services.
 */
export const COMPOSIO_MCP_SERVERS: ComposioMcpServer[] = [
  { name: 'Gmail', slug: 'gmail', description: 'Send, read, and manage emails' },
  { name: 'Google Calendar', slug: 'googlecalendar', description: 'Create and manage calendar events' },
  { name: 'Google Drive', slug: 'googledrive', description: 'Manage files and folders' },
  { name: 'Google Sheets', slug: 'googlesheets', description: 'Read and write spreadsheets' },
  { name: 'Google Docs', slug: 'googledocs', description: 'Create and edit documents' },
  { name: 'LinkedIn', slug: 'linkedin', description: 'Manage professional network' },
  { name: 'GitHub', slug: 'github', description: 'Manage repos, issues, and pull requests' },
  { name: 'GitLab', slug: 'gitlab', description: 'Manage repos, issues, merge requests' },
  { name: 'Slack', slug: 'slack', description: 'Send messages and manage channels' },
  { name: 'Notion', slug: 'notion', description: 'Manage pages, databases, and notes' },
  { name: 'Linear', slug: 'linear', description: 'Track issues and projects' },
  { name: 'Jira', slug: 'jira', description: 'Manage projects and issues' },
  { name: 'Figma', slug: 'figma', description: 'Access design files and components' },
  { name: 'Canva', slug: 'canva', description: 'Create and manage designs' },
  { name: 'Salesforce', slug: 'salesforce', description: 'Manage leads, contacts, opportunities' },
  { name: 'HubSpot', slug: 'hubspot', description: 'Manage contacts and deals' },
  { name: 'Discord', slug: 'discord', description: 'Send messages and manage servers' },
  // { name: 'X', slug: 'twitter', description: 'Post and manage tweets' },
  { name: 'WhatsApp', slug: 'whatsapp', description: 'Send messages and manage conversations' },
  { name: 'Airtable', slug: 'airtable', description: 'Manage bases and records' },
  { name: 'Supabase', slug: 'supabase', description: 'Manage databases and backend services' },
  { name: 'Vercel', slug: 'vercel', description: 'Deploy and manage web applications' },
  { name: 'Asana', slug: 'asana', description: 'Manage tasks and projects' },
  { name: 'ClickUp', slug: 'clickup', description: 'Manage tasks and workflows' },
  { name: 'Stripe', slug: 'stripe', description: 'Manage payments and subscriptions' },
  { name: 'Microsoft Teams', slug: 'microsoft_teams', description: 'Chat, meet, and collaborate' },
  { name: 'Outlook Mail', slug: 'microsoft_outlook', description: 'Send, read, and manage emails' },
]
