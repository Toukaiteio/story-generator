import { describe, expect, it } from 'vitest'
import { countStyleLibrary, styleCountLabel } from '../library'
import type { WritingStyle } from '@/types/writingStyle'

function style(name: string, isBuiltIn = false): WritingStyle {
  return {
    id: name.toLowerCase(),
    name,
    description: '',
    content: 'content',
    source: 'manual',
    tags: [],
    isBuiltIn,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('writing style library counts', () => {
  it('counts the built-in default and no custom styles in an empty library', () => {
    expect(countStyleLibrary([])).toEqual({ builtIn: 1, custom: 0 })
  })

  it('counts stored built-in styles alongside the default', () => {
    expect(countStyleLibrary([style('Default', true), style('Noir')])).toEqual({ builtIn: 2, custom: 1 })
  })

  it('never reports zero built-ins while the default card is visible', () => {
    const counts = countStyleLibrary([style('Noir'), style('Plain')])
    expect(counts.builtIn).toBe(1)
    expect(counts.custom).toBe(2)
    expect(styleCountLabel(counts)).toBe('1 built-in · 2 custom')
  })

  it('matches the number of custom cards rendered', () => {
    const styles = [style('Noir'), style('Plain'), style('Lush')]
    expect(countStyleLibrary(styles).custom).toBe(styles.length)
  })
})
