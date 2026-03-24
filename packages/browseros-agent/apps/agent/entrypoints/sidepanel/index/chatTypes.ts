export type ChatMode = 'chat' | 'agent' | 'coding'

export interface Suggestion {
  display: string
  prompt: string
  icon: string
}

export const CHAT_SUGGESTIONS: Suggestion[] = [
  {
    display: 'Summarize this page',
    prompt: 'Read the current tab and summarize it in bullet points',
    icon: '✨',
  },
  // {
  //   display: 'What topics does this page talk about?',
  //   prompt:
  //     'Read the current tab and briefly describe what it is about in 1-2 lines',
  //   icon: '🔍',
  // },
  // {
  //   display: 'Extract comments from this page',
  //   prompt: 'Read the current tab and extract comments as bullet points',
  //   icon: '💬',
  // },
]

export const AGENT_SUGGESTIONS: Suggestion[] = [
  // {
  //   display: 'Read about our vision and upvote',
  //   prompt:
  //     'Go to https://dub.sh/browseros-launch in current tab. Find and click the upvote button',
  //   icon: '❤️',
  // },
  // {
  //   display: 'Support BrowserOS on Github',
  //   prompt:
  //     'Go to http://git.new/browseros in current tab and star the repository',
  //   icon: '⭐',
  // },
  {
    display: 'Open amazon.com and order a GPU for me',
    prompt: 'Navigate to amazon.com and add a GPU for me to my cart.',
    icon: '🛒',
  },
]

export const CODING_SUGGESTIONS: Suggestion[] = [
  {
    display: 'Build a personal productivity web app',
    prompt:
      'Build a modern, production-ready personal productivity SaaS web app (Notion quality) using React.js, Tailwind CSS. Include dashboard insights, task management (priority, due dates, drag-drop, completion), habits with streaks and heatmap, goals with milestones/progress, rich notes with tags/search, and a Pomodoro timer with session tracking; make it fully responsive, animated, dark/light mode, and Vercel zero-config deployable. Make sure to start the dev server and open/share the preview URL once the app is ready.',
    icon: '📊',
  },
  {
    display: 'Build a landing page for Fouwser',
    prompt: `
      Act as a senior conversion copywriter and UX strategist. Create a high-converting landing page framework for my app-building, agentic, founder-friendly browser - Fouwser.
      Our target audience is non-technical founders, small business owners, enterprise managers who struggle with high development costs, slow time-to-market, technical complexity.
      Use React as the tech stack.
      `,
    icon: '🛠️',
  },
  // {
  //   display: 'Refactor safely',
  //   prompt:
  //     'Refactor the relevant code with minimal behavior change and run targeted checks',
  //   icon: '🧩',
  // },
]
