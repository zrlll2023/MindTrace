import { Repo } from '../db/repository'
import { ResearchPlanDraft } from '../types'

const KEY_PREFIX = 'labs.research-plan.'

export function researchWeekKey(date = new Date()): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = local.getDay() || 7
  local.setDate(local.getDate() + 4 - day)
  const yearStart = new Date(local.getFullYear(), 0, 1)
  const week = Math.ceil((((local.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${local.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function cleanDraft(value: Partial<ResearchPlanDraft>, weekKey: string): ResearchPlanDraft {
  const now = new Date().toISOString()
  return {
    weekKey,
    queries: Array.isArray(value.queries)
      ? value.queries.filter((query): query is string => typeof query === 'string').map(query => query.slice(0, 300)).slice(0, 12)
      : [],
    note: typeof value.note === 'string' ? value.note.slice(0, 4000) : '',
    finding: typeof value.finding === 'string' ? value.finding.slice(0, 20000) : '',
    findingFrom: typeof value.findingFrom === 'string' ? value.findingFrom.slice(0, 2000) : '',
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    updatedAt: now
  }
}

export async function getResearchDraft(repo: Repo, weekKey: string): Promise<ResearchPlanDraft | null> {
  const raw = await repo.getSetting(`${KEY_PREFIX}${weekKey}`)
  if (!raw) return null
  try {
    return cleanDraft(JSON.parse(raw) as Partial<ResearchPlanDraft>, weekKey)
  } catch {
    return null
  }
}

export async function saveResearchDraft(
  repo: Repo,
  draft: Partial<ResearchPlanDraft> & { weekKey: string }
): Promise<ResearchPlanDraft> {
  const cleaned = cleanDraft(draft, draft.weekKey)
  await repo.setSetting(`${KEY_PREFIX}${draft.weekKey}`, JSON.stringify(cleaned))
  repo.save()
  return cleaned
}

export async function clearResearchDraft(repo: Repo, weekKey: string): Promise<void> {
  repo.getDb().run('DELETE FROM settings WHERE key = ?', [`${KEY_PREFIX}${weekKey}`])
  repo.save()
}
