import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * API Key 等机密的本机加密存储。
 * - Electron 运行时：safeStorage（Windows DPAPI）加密，落盘 secrets.bin
 * - 非 Electron 环境（单元测试）：AES-256-GCM 回退，密钥文件 .mtkey 存于数据目录
 * 任何情况下都不明文落盘。
 */

interface SecretFile {
  version: 1
  items: Record<string, string> // key -> base64(加密数据)
}

export class SecretBox {
  private file: string
  private aesKeyFile: string
  private safeStorageMod: typeof import('electron') | null = null

  constructor(private dataDir: string) {
    this.file = path.join(dataDir, 'secrets.bin')
    this.aesKeyFile = path.join(dataDir, '.mtkey')
  }

  private loadSafeStorage(): typeof import('electron') | null {
    if (this.safeStorageMod !== null) return this.safeStorageMod
    try {
      // 仅在 Electron 主进程中可 require
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.safeStorageMod = require('electron') as typeof import('electron')
      return this.safeStorageMod
    } catch {
      this.safeStorageMod = null
      return null
    }
  }

  private aesEncrypt(plain: string): string {
    let key: Buffer
    if (fs.existsSync(this.aesKeyFile)) {
      key = Buffer.from(fs.readFileSync(this.aesKeyFile, 'utf8'), 'base64')
    } else {
      key = crypto.randomBytes(32)
      fs.writeFileSync(this.aesKeyFile, key.toString('base64'), { mode: 0o600 })
    }
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, enc]).toString('base64')
  }

  private aesDecrypt(b64: string): string {
    const key = Buffer.from(fs.readFileSync(this.aesKeyFile, 'utf8'), 'base64')
    const raw = Buffer.from(b64, 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const enc = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  }

  private encrypt(plain: string): string {
    const electron = this.loadSafeStorage()
    if (electron?.safeStorage?.isEncryptionAvailable()) {
      return 'ss:' + electron.safeStorage.encryptString(plain).toString('base64')
    }
    return 'aes:' + this.aesEncrypt(plain)
  }

  private decrypt(stored: string): string {
    if (stored.startsWith('ss:')) {
      const electron = this.loadSafeStorage()
      if (!electron?.safeStorage?.isEncryptionAvailable()) {
        throw new Error('safeStorage 不可用，无法解密密钥文件')
      }
      return electron.safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64'))
    }
    if (stored.startsWith('aes:')) return this.aesDecrypt(stored.slice(4))
    throw new Error('未知的密钥存储格式')
  }

  private read(): SecretFile {
    if (!fs.existsSync(this.file)) return { version: 1, items: {} }
    return JSON.parse(fs.readFileSync(this.file, 'utf8')) as SecretFile
  }

  private write(data: SecretFile): void {
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(data), { mode: 0o600 })
  }

  set(key: string, plain: string): void {
    const data = this.read()
    data.items[key] = this.encrypt(plain)
    this.write(data)
  }

  get(key: string): string | null {
    const data = this.read()
    const stored = data.items[key]
    if (!stored) return null
    return this.decrypt(stored)
  }

  delete(key: string): void {
    const data = this.read()
    delete data.items[key]
    this.write(data)
  }
}
