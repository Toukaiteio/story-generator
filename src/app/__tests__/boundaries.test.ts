import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const UI_DIRECTORIES = ['src/components', 'src/pages', 'src/layouts']

const FORBIDDEN_IMPORTS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /from\s+['"]@\/services(?:\/|['"])/,
    reason: 'UI must reach engine capabilities through @/app, not @/services directly.',
  },
  {
    pattern: /from\s+['"]@\/stores\/(?:project|provider|generation|knowledge|writingStyle)(?:\/|['"])/,
    reason: 'UI must use the @/app ports instead of engine stores. Only @/stores/ui is allowed.',
  },
  {
    pattern: /from\s+['"](?:\.\.\/)+(?:services|stores\/(?:project|provider|generation|knowledge|writingStyle))\//,
    reason: 'Relative imports into the engine are not allowed; use @/app.',
  },
]

function collectSourceFiles(directory: string): string[] {
  const absolute = join(ROOT, directory)
  const files: string[] = []

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(absolute, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(relative(ROOT, path)))
    } else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) {
      files.push(path)
    }
  }

  return files
}

describe('UI / engine boundary', () => {
  it('keeps UI code behind the src/app application layer', () => {
    const violations: string[] = []

    for (const directory of UI_DIRECTORIES) {
      for (const file of collectSourceFiles(directory)) {
        const source = readFileSync(file, 'utf8')
        for (const { pattern, reason } of FORBIDDEN_IMPORTS) {
          if (pattern.test(source)) {
            violations.push(`${relative(ROOT, file)}: ${reason}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})
