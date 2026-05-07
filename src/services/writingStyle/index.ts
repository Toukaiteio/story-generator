import type { WritingStyle } from '@/types/writingStyle'
import { createWritingStyle } from './storage'

export class WritingStyleService {
  create(data: {
    name: string
    description: string
    content: string
    source: 'manual' | 'ai-generated'
    tags: string[]
  }): WritingStyle {
    return createWritingStyle(data)
  }

  getStyleContext(styleId: string, styles: WritingStyle[]): string {
    if (styleId === 'default' || !styleId) return ''
    const style = styles.find(s => s.id === styleId)
    if (!style || !style.content.trim()) return ''
    return style.content.trim()
  }
}

export const writingStyleService = new WritingStyleService()
