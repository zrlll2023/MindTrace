import { Database } from 'sql.js'
import { PROFILE_KEYS, ProfileKey, ProfileValues } from '../types'

export interface ProfileField { value: string; source: 'manual' | 'ai' }
export type ProfileRecord = Partial<Record<ProfileKey, ProfileField>>

export class ProfileStore {
  constructor(private db: Database) {}

  get(): ProfileRecord {
    const r = this.db.exec('SELECT key, value, source FROM profile_fields')
    const out: ProfileRecord = {}
    if (!r.length) return out
    for (const [key, value, source] of r[0].values) {
      if (PROFILE_KEYS.includes(key as ProfileKey)) out[key as ProfileKey] = { value: String(value), source: source as 'manual' | 'ai' }
    }
    return out
  }

  values(): ProfileValues {
    return Object.fromEntries(Object.entries(this.get()).map(([k, v]) => [k, v?.value])) as ProfileValues
  }

  saveManual(values: ProfileValues): void {
    for (const key of PROFILE_KEYS) {
      const value = values[key]?.trim()
      if (value) this.upsert(key, value, 'manual')
      else this.db.run('DELETE FROM profile_fields WHERE key = ?', [key])
    }
  }

  confirmDraft(values: ProfileValues): void {
    const current = this.get()
    for (const key of PROFILE_KEYS) {
      const value = values[key]?.trim()
      if (value && !current[key]?.value) this.upsert(key, value, 'ai')
    }
  }

  private upsert(key: ProfileKey, value: string, source: 'manual' | 'ai'): void {
    this.db.run(`INSERT INTO profile_fields (key, value, source) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, source=excluded.source, updated_at=datetime('now','localtime')`, [key, value, source])
  }
}
