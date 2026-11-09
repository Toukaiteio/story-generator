import type { WritingStyle } from '@/types/writingStyle'

export interface StyleLibraryCounts {
  builtIn: number
  custom: number
}

/**
 * The default style is a built-in entry that always exists in the picker but
 * is not stored as a custom style. Counts must describe the visible cards.
 */
export function countStyleLibrary(styles: WritingStyle[], includeDefault = true): StyleLibraryCounts {
  return {
    builtIn: (includeDefault ? 1 : 0) + styles.filter(style => style.isBuiltIn).length,
    custom: styles.filter(style => !style.isBuiltIn).length,
  }
}

export function styleCountLabel(counts: StyleLibraryCounts): string {
  return `${counts.builtIn} built-in · ${counts.custom} custom`
}
