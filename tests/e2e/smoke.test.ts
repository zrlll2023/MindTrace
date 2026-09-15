import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'

describe('构建产物冒烟', () => {
  it('vite 构建产出 index.html', () => {
    expect(existsSync('dist/index.html')).toBe(true)
  })
  it('主进程编译产物存在', () => {
    expect(existsSync('dist-electron/main.js')).toBe(true)
  })
})
