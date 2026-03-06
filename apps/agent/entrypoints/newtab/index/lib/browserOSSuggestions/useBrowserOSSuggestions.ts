/**
 * @public
 */
export interface BrowserOSSuggestion {
  mode: 'chat' | 'agent' | 'coding'
  message: string
}

/**
 * @public
 */
export const useBrowserOSSuggestions = ({
  query,
}: {
  query: string
}): BrowserOSSuggestion[] => {
  return [
    {
      mode: 'agent',
      message: query,
    },
  ]
}
