export type ChatMode = 'chat' | 'agent' | 'coding'

interface BaseSuggestion {
  display: string
  icon: string
}

export interface StaticSuggestion extends BaseSuggestion {
  type: 'static'
  prompt: string
}

export interface BuilderSuggestion extends BaseSuggestion {
  type: 'builder'
  dialogTitle: string
  dialogDescription: string
  inputPlaceholder: string
  submitLabel: string
  requiredInputError: string
  promptTemplate: string
}

export type Suggestion = StaticSuggestion | BuilderSuggestion

export const CHAT_SUGGESTIONS: Suggestion[] = [
  {
    type: 'static',
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
    type: 'static',
    display: 'Open amazon.com and order a GPU for me',
    prompt: 'Navigate to amazon.com and add a GPU for me to my cart.',
    icon: '🛒',
  },
]

export const CODING_SUGGESTIONS: Suggestion[] = [
  {
    type: 'builder',
    display: 'Build a web application that does ...',
    dialogTitle: 'Build a Web Application',
    dialogDescription: 'Describe your specific product idea.',
    inputPlaceholder:
      'A productivity app for me to plan track habits, and become more productive.',
    submitLabel: 'Generate',
    requiredInputError: 'Describe your app idea first.',
    promptTemplate: `Build a modern, production-ready SaaS web app tailored for this company/idea: {{input}}

Requirements:
- Use Next.js and Tailwind CSS.
- Make it fully responsive, animated, and include dark/light mode.
- Keep it Vercel zero-config deployable.
- Start the dev server and open/share the preview URL once the app is ready.`,
    icon: '📊',
  },
  {
    type: 'builder',
    display: 'Build a landing page for ...',
    dialogTitle: 'Build a Landing Page',
    dialogDescription:
      'Describe your company or idea. This will be turned into a coding prompt.',
    inputPlaceholder: 'A Browser build specifically for Founders - Fouwsers.',
    submitLabel: 'Generate',
    requiredInputError: 'Describe your company or idea first.',
    promptTemplate: `Act as a senior conversion copywriter and UX strategist.

Create a high-converting landing page for this company/idea:
{{input}}

Requirements:
- Build with React and Tailwind CSS.
- Include clear sections: hero, problem, solution, features, social proof, pricing/offer, FAQ, and CTA.
- Write compelling copy targeted to the likely ICP for this business.
- Make the design modern, responsive, and production-ready.
- Start the dev server and open/share the preview URL when complete.`,
    icon: '🛠️',
  },
]
