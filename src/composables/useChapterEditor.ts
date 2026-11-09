import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useStoryProject, useStudioActions, type ChapterAuditIssue, type SelectionAction } from '@/app'
import { useChapterReview } from '@/stores/chapterReview'
import { useToast } from '@/composables/useToast'
import type { Chapter } from '@/types/chapter'

const SELECTION_LABELS: Record<SelectionAction, string> = {
  deepen: 'Deepen',
  trim: 'Trim',
  show: 'Show, don\'t tell',
  dialogue: 'Dialogue',
  fix: 'Grammar fix',
  custom: 'Custom rewrite',
}

/**
 * Owns the chapter draft, session actions and diff reviews so the view only
 * renders. Every AI result becomes a review first; only an accept writes the
 * draft, so no entry point can silently rewrite saved prose.
 */
export function useChapterEditor(chapter: () => Chapter | null) {
  const projectStore = useStoryProject()
  const actions = useStudioActions()
  const reviewStore = useChapterReview()
  const toast = useToast()

  const title = ref('')
  const content = ref('')
  const savedContent = ref('')
  const saving = ref(false)
  const dirty = computed(() => content.value !== savedContent.value)

  const selStart = ref(0)
  const selEnd = ref(0)
  const selection = computed(() => content.value.slice(selStart.value, selEnd.value))
  const hasSelection = computed(() => selEnd.value > selStart.value)

  const working = ref(false)
  const humanizing = ref(false)
  const streaming = ref(false)
  const recapText = ref('')
  const askOpen = ref(false)
  const askDraft = ref('')
  const reviewOpen = ref(false)
  const textarea = ref<HTMLTextAreaElement | null>(null)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let continueController: AbortController | null = null

  watch(chapter, target => {
    flushSave()
    if (reviewStore.active && reviewStore.active.chapterId !== (target?.id ?? '')) reviewStore.clear()
    hydrate()
    recapText.value = ''
    reviewOpen.value = false
    selStart.value = 0
    selEnd.value = 0
  }, { immediate: true })

  watch(chapter, target => {
    if (!target) return
    if (!content.value && !savedContent.value && target.content) hydrate()
  })

  function hydrate() {
    title.value = chapter()?.title ?? ''
    content.value = chapter()?.content ?? ''
    savedContent.value = content.value
  }

  watch([title, content], () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void save(), 900)
  })

  async function save() {
    const project = projectStore.activeProject
    const target = chapter()
    if (!project || !target) return
    if (title.value === target.title && content.value === target.content) return

    saving.value = true
    try {
      const chapters = project.chapters.map(item => item.id === target.id
        ? {
            ...item,
            title: title.value.trim() || item.title,
            content: content.value,
            status: item.status === 'outline' && content.value.trim() ? ('draft' as const) : item.status,
            proofreadingIssuesStale: item.content !== content.value ? true : item.proofreadingIssuesStale,
            updatedAt: new Date().toISOString(),
          }
        : item)
      const saved = await projectStore.updateProject(project.id, { chapters })
      if (saved) savedContent.value = content.value
    } finally {
      saving.value = false
    }
  }

  function flushSave() {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
    void save()
  }

  function syncSelection() {
    const node = textarea.value
    if (!node) return
    selStart.value = node.selectionStart
    selEnd.value = node.selectionEnd
  }

  function syncSelectionFromOffsets(start: number, end: number) {
    selStart.value = Math.max(0, Math.min(start, content.value.length))
    selEnd.value = Math.max(selStart.value, Math.min(end, content.value.length))
  }

  function selectionContext() {
    return {
      chapterTitle: title.value || chapter()?.title || '',
      chapterNumber: (chapter()?.index ?? 0) + 1,
      before: content.value.slice(Math.max(0, selStart.value - 600), selStart.value),
      after: content.value.slice(selEnd.value, selEnd.value + 600),
    }
  }

  /** Finds the reviewed passage even if the draft moved while the AI ran. */
  function resolveRange(base: string, original: string, range: { start: number; end: number }) {
    if (base.slice(range.start, range.end) === original) return range
    const found = original ? base.indexOf(original) : base.length
    if (found < 0) return null
    return { start: found, end: found + original.length }
  }

  /** Presents an AI result as a review. Returns false when nothing changed. */
  function proposeReview(
    label: string,
    original: string,
    revised: string,
    range: { start: number; end: number },
    options: { base?: string; inline?: boolean } = {},
  ): boolean {
    const target = chapter()
    if (!target) return false
    const base = options.base ?? content.value
    const resolved = resolveRange(base, original, range)
    if (!resolved) {
      toast.error('AI change unconfirmed')
      return false
    }
    const changed = reviewStore.propose({
      chapterId: target.id,
      label,
      base,
      original,
      revised,
      start: resolved.start,
      end: resolved.end,
      inline: options.inline ?? true,
    })
    if (!changed) toast.info('The rewrite returned the same text')
    return changed
  }

  function reviewPending() {
    if (!reviewStore.active) return false
    toast.info('Review the pending AI changes first')
    return true
  }

  async function runSelection(next: SelectionAction, label = '') {
    const selected = selection.value
    if (!selected || working.value || reviewPending()) return
    working.value = true
    const base = content.value
    const range = { start: selStart.value, end: selEnd.value }
    try {
      const instruction = next === 'custom' ? askDraft.value : undefined
      const revised = await actions.improveSelection(next, selected, selectionContext(), { instruction })
      if (revised) proposeReview(label || SELECTION_LABELS[next], selected, revised, range, { base })
    } catch (error: any) {
      toast.error(error?.message || 'Rewrite failed')
    } finally {
      working.value = false
      askOpen.value = false
      askDraft.value = ''
    }
  }

  /** Called by the editor with the accepted inline result. */
  function applySettledReview(settledText: string, range: { start: number; end: number }) {
    const from = Math.max(0, Math.min(range.start, content.value.length))
    const to = Math.max(from, Math.min(range.end, content.value.length))
    content.value = content.value.slice(0, from) + settledText + content.value.slice(to)
    void save()
  }

  async function runContinue() {
    const target = chapter()
    if (working.value || !target || reviewPending()) return
    flushSave()
    continueController = new AbortController()
    streaming.value = true
    const buffer = { text: '' }
    try {
      buffer.text = await actions.continueChapter(target.id, {
        signal: continueController.signal,
        onToken: token => {
          buffer.text += token
        },
      })
      const draft = buffer.text.trim()
      if (!draft) return
      const base = content.value
      const glue = base && !/\s$/.test(base) ? '\n\n' : ''
      proposeReview('Continuation', '', glue + draft, {
        start: base.length,
        end: base.length,
      }, { base })
    } catch (error: any) {
      if (error?.name !== 'AbortError') toast.error(error?.message || 'Continue failed')
    } finally {
      streaming.value = false
      continueController = null
    }
  }

  function stopContinue() {
    continueController?.abort()
  }

  async function runHumanizeSelection() {
    const selected = selection.value
    if (!selected || humanizing.value || reviewPending()) return
    const base = content.value
    const range = { start: selStart.value, end: selEnd.value }
    humanizing.value = true
    try {
      const result = await actions.humanizeText(selected, { chapterId: chapter()?.id })
      proposeReview('De-AI rewrite', selected, result.text, range, { base })
    } catch (error: any) {
      toast.error(error?.message || 'Humanize failed')
    } finally {
      humanizing.value = false
    }
  }

  async function runHumanizeChapter() {
    const target = chapter()
    if (humanizing.value || !target || !content.value.trim() || reviewPending()) return
    flushSave()
    const before = content.value
    humanizing.value = true
    try {
      const result = await actions.humanizeChapter(target.id)
      proposeReview('De-AI rewrite', before, result.text, { start: 0, end: before.length }, { base: before })
    } catch (error: any) {
      toast.error(error?.message || 'Humanize failed')
    } finally {
      humanizing.value = false
    }
  }

  async function runRecap() {
    if (working.value) return
    working.value = true
    try {
      recapText.value = await actions.recap(undefined, chapter()?.id)
    } catch (error: any) {
      toast.error(error?.message || 'Recap failed')
    } finally {
      working.value = false
    }
  }

  async function runProofread() {
    const target = chapter()
    if (!target || working.value) return
    flushSave()
    working.value = true
    try {
      await actions.proofreadChapter(target.id)
      reviewOpen.value = true
    } catch (error: any) {
      toast.error(error?.message || 'Proofreading failed')
    } finally {
      working.value = false
    }
  }

  async function polishAll() {
    const target = chapter()
    if (!target || working.value || reviewPending()) return
    flushSave()
    const before = content.value
    working.value = true
    try {
      const polished = await actions.polishChapter(target.id)
      reviewOpen.value = false
      if (!polished.trim() || polished === before) {
        toast.info('Polish produced no changes')
        return
      }
      proposeReview('Polish', before, polished, { start: 0, end: before.length }, { base: before })
    } catch (error: any) {
      toast.error(error?.message || 'Polishing failed')
    } finally {
      working.value = false
    }
  }

  function applyIssueFix(issue: ChapterAuditIssue) {
    if (!chapter() || !issue.suggestedFix || reviewPending()) return
    const target = issue.excerpt?.trim() || ''
    const start = target ? content.value.indexOf(target) : -1
    const base = content.value
    if (start >= 0) {
      proposeReview(issue.title, target, issue.suggestedFix, { start, end: start + target.length }, { base })
      return
    }
    proposeReview(issue.title, '', issue.suggestedFix, {
      start: base.length,
      end: base.length,
    }, { base })
  }

  async function ignoreIssue(issue: ChapterAuditIssue) {
    const project = projectStore.activeProject
    const target = chapter()
    if (!project || !target) return
    const chapters = project.chapters.map(item => item.id === target.id
      ? {
          ...item,
          proofreadingIssues: item.proofreadingIssues.map(existing =>
            existing.id === issue.id ? { ...existing, ignored: true, polishStatus: 'ignored' as const } : existing),
        }
      : item)
    await projectStore.updateProject(project.id, { chapters })
  }

  /** Compatibility view of the active review, shaped like the old card. */
  const suggestion = computed(() => {
    const active = reviewStore.active
    if (!active) return null
    return {
      kind: active.original ? 'rewrite' as const : 'append' as const,
      label: active.label,
      original: active.original,
      revised: active.revised,
      start: active.start,
      end: active.end,
    }
  })

  /** Compatibility alias: Accept all, still an explicit user confirmation. */
  function acceptSuggestion() {
    const active = reviewStore.active
    if (!active) return
    reviewStore.decideAll('accepted')
    content.value = reviewStore.reviewedText(active)
    reviewStore.clear()
    void save()
  }

  watch(hasSelection, value => {
    if (!value) askOpen.value = false
  })

  onBeforeUnmount(() => {
    flushSave()
    continueController?.abort()
  })

  return {
    title,
    content,
    saving,
    dirty,
    selStart,
    selEnd,
    hasSelection,
    suggestion,
    working,
    humanizing,
    streaming,
    recapText,
    askOpen,
    askDraft,
    reviewOpen,
    textarea,
    save,
    flushSave,
    syncSelection,
    syncSelectionFromOffsets,
    runSelection,
    acceptSuggestion,
    applySettledReview,
    proposeReview,
    runContinue,
    stopContinue,
    runHumanizeSelection,
    runHumanizeChapter,
    runRecap,
    runProofread,
    polishAll,
    applyIssueFix,
    ignoreIssue,
  }
}
