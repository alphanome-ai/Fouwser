import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSkillsDir } from '../lib/browseros-dir'
import { logger } from '../lib/logger'
import { DEFAULT_SKILLS } from './defaults'

const DEFAULT_SKILLS_TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'defaults',
)

async function hasExistingSkills(skillsDir: string): Promise<boolean> {
  try {
    const entries = await readdir(skillsDir)
    return entries.some((e) => !e.startsWith('.'))
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copySupportingFiles(
  skillId: string,
  targetDir: string,
  options?: { overwrite?: boolean },
): Promise<void> {
  const sourceDir = join(DEFAULT_SKILLS_TEMPLATES_DIR, skillId)
  if (!(await pathExists(sourceDir))) return

  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'SKILL.md' || entry.name.startsWith('.')) continue
    await cp(join(sourceDir, entry.name), join(targetDir, entry.name), {
      recursive: true,
      force: options?.overwrite ?? true,
      errorOnExist: false,
    })
  }
}

async function backfillSupportingFiles(skillsDir: string): Promise<void> {
  let updated = 0
  let added = 0
  for (const skill of DEFAULT_SKILLS) {
    try {
      const targetDir = join(skillsDir, skill.id)
      const targetSkillMd = join(targetDir, 'SKILL.md')
      if (!(await pathExists(targetSkillMd))) {
        await mkdir(targetDir, { recursive: true })
        await writeFile(targetSkillMd, skill.content)
        added++
      }

      await copySupportingFiles(skill.id, targetDir, { overwrite: false })
      updated++
    } catch (err) {
      logger.warn('Failed to backfill default skill supporting files', {
        id: skill.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (added > 0 || updated > 0) {
    logger.info(
      `Synced default skills: added ${added}, backfilled supporting files for ${updated}`,
    )
  }
}

export async function seedDefaultSkills(): Promise<void> {
  const skillsDir = getSkillsDir()
  if (await hasExistingSkills(skillsDir)) {
    await backfillSupportingFiles(skillsDir)
    return
  }

  let seeded = 0
  for (const skill of DEFAULT_SKILLS) {
    try {
      const targetDir = join(skillsDir, skill.id)
      await mkdir(targetDir, { recursive: true })
      await writeFile(join(targetDir, 'SKILL.md'), skill.content)
      await copySupportingFiles(skill.id, targetDir)
      seeded++
    } catch (err) {
      logger.warn('Failed to seed skill', {
        id: skill.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (seeded > 0) {
    logger.info(`Seeded ${seeded} default skills`)
  }
}
