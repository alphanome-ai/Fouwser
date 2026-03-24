import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  getVsCodeWebUiUrlForFolder,
  openVsCodeWebUiForFolder,
} from '../lib/prerequisites/vscode-web'
import { defineTool } from './framework'

const ACTIONS = ['start', 'open'] as const

function isWithinOrEqual(basePath: string, targetPath: string): boolean {
  const rel = relative(basePath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export const vscode_web = defineTool({
  name: 'vscode_web',
  description:
    'Start/reuse VS Code Web server for local coding folders and optionally open it in a browser tab. Use this in coding tasks when you want an in-browser VS Code view for the current repo or edited folder.',
  input: z.object({
    action: z
      .enum(ACTIONS)
      .optional()
      .default('open')
      .describe(
        '"start" returns URL without opening a tab; "open" opens the URL in browser and returns it.',
      ),
    folder: z
      .string()
      .optional()
      .describe(
        'Folder path for VS Code Web. Relative paths are resolved against cwd.',
      ),
    cwd: z
      .string()
      .optional()
      .describe(
        'Base directory for resolving relative folder paths (defaults to agent working directory).',
      ),
    forceNewTab: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When action is "open", open a new tab even if this folder was already opened before.',
      ),
  }),
  handler: async (args, ctx, response) => {
    const workingDir = resolve(ctx.directories.workingDir)
    const baseDir = args.cwd ? resolve(args.cwd) : workingDir

    if (!isWithinOrEqual(workingDir, baseDir)) {
      response.error(
        `vscode_web cwd must be within working directory (${workingDir}). Received: ${baseDir}`,
      )
      return
    }

    const folderPath = args.folder ? resolve(baseDir, args.folder) : baseDir
    if (!isWithinOrEqual(workingDir, folderPath)) {
      response.error(
        `vscode_web folder must be within working directory (${workingDir}). Received: ${folderPath}`,
      )
      return
    }

    const url =
      args.action === 'start'
        ? await getVsCodeWebUiUrlForFolder(folderPath)
        : await openVsCodeWebUiForFolder(ctx.browser, folderPath, {
            forceNewTab: args.forceNewTab,
          })

    const actionText =
      args.action === 'start'
        ? 'Started/reused VS Code Web server'
        : 'Opened VS Code Web UI in browser'

    response.text(`${actionText}\nFolder: ${folderPath}\nWeb UI: ${url}`)
  },
})
