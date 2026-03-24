import { mkdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

function isWithinBasePath(targetPath: string, basePath: string): boolean {
  const rel = relative(basePath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export async function resolveCodingWorkingDir(
  userWorkingDir: string,
  preferredPath: string = userWorkingDir,
): Promise<string> {
  const requestedPath = resolve(userWorkingDir)
  const resolvedPreferredPath = resolve(preferredPath)

  if (!isWithinBasePath(requestedPath, resolvedPreferredPath)) {
    throw new Error(
      `The agent tried to write outside the selected folder: (${resolvedPreferredPath}). Tried: ${requestedPath}. Restricting the action.`,
    )
  }

  await mkdir(requestedPath, { recursive: true })
  return requestedPath
}
