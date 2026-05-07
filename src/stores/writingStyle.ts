import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { WritingStyle } from '@/types/writingStyle'
import { writingStyleService } from '@/services/writingStyle'
import { normalizeWritingStyles } from '@/services/writingStyle/storage'
import { readJsonStorage, writeJsonStorage } from '@/lib/storage'

const STORAGE_KEY = 'story-generator.writingStyles.v1'

export const useWritingStyleStore = defineStore('writingStyle', () => {
  const styles = ref<WritingStyle[]>(
    normalizeWritingStyles(readJsonStorage<Partial<WritingStyle>[]>(STORAGE_KEY, []))
  )

  function persistState() {
    writeJsonStorage(STORAGE_KEY, styles.value)
  }

  function createStyle(data: {
    name: string
    description: string
    content: string
    source: 'manual' | 'ai-generated'
    tags: string[]
  }): WritingStyle {
    const style = writingStyleService.create(data)
    styles.value.push(style)
    return style
  }

  function updateStyle(id: string, updates: Partial<WritingStyle>) {
    const index = styles.value.findIndex(s => s.id === id)
    if (index === -1) return
    styles.value[index] = {
      ...styles.value[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    }
  }

  function deleteStyle(id: string) {
    styles.value = styles.value.filter(s => s.id !== id)
  }

  function getStyleById(id: string): WritingStyle | undefined {
    return styles.value.find(s => s.id === id)
  }

  function resolveStyleContent(styleId: string): string {
    if (styleId === 'default' || !styleId) return ''
    const style = styles.value.find(s => s.id === styleId)
    return style?.content ?? ''
  }

  persistState()
  watch(styles, persistState, { deep: true })

  return {
    styles,
    createStyle,
    updateStyle,
    deleteStyle,
    getStyleById,
    resolveStyleContent,
  }
})
