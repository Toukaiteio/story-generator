<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useToast } from '@/composables/useToast'
import { detectMarkdown, markdownToHtml } from '@/services/markdown'
import { sanitizeGeneratedChapterContent } from '@/services/writingFormat'
import { buildProofreadingSegments } from '@/services/proofreading/chunking'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import VibeAssistant from '@/components/workspace/VibeAssistant.vue'
import EditingAssistant from '@/components/workspace/EditingAssistant.vue'
import ProofreadingAssistant from '@/components/workspace/ProofreadingAssistant.vue'
import { Save, Eye, EyeOff, FileText, Type, CheckCircle2, Sparkles, Clock, RotateCcw, Code2, BookOpen } from 'lucide-vue-next'

const props = defineProps<{
  chapterId: string
}>()

const projectStore = useProjectStore()
const toast = useToast()

const project = computed(() => projectStore.activeProject)
const chapter = computed(() => {
  if (!project.value) return null
  return project.value.chapters.find(ch => ch.id === props.chapterId) ?? null
})

const title = ref('')
const content = ref('')
const showVersions = ref(false)
const viewMode = ref<'edit' | 'preview'>('edit')
const assistantTab = ref<'vibe' | 'editing' | 'proofreading'>('vibe')
const vibeAssistant = ref<InstanceType<typeof VibeAssistant> | null>(null)
const contentPreviewRef = ref<HTMLElement | null>(null)
const selectedProofreadingIssue = ref<any | null>(null)

watch(chapter, (ch) => {
  if (ch) {
    title.value = ch.title || ''
    content.value = ch.content || ''
  }
}, { immediate: true })

async function save() {
  if (!chapter.value || !project.value) return
  const nextContent = sanitizeGeneratedChapterContent(content.value, {
    writingFormat: project.value.writingFormat,
    writingStyle: project.value.style,
    chapterTitle: title.value,
    chapterNumber: chapter.value.index + 1,
  })
  content.value = nextContent
  const chapters = project.value.chapters.map(ch =>
    ch.id === props.chapterId ? { ...ch, title: title.value, content: nextContent } : ch
  )
  const saved = await projectStore.updateProject(project.value.id, {
    chapters,
  })
  if (!saved) {
    toast.error('Failed to save chapter')
    return
  }
  toast.success('Chapter saved')
}

async function restoreVersion(versionContent: string) {
  if (!chapter.value || !project.value) return
  content.value = versionContent
  const chapters = project.value.chapters.map(ch =>
    ch.id === props.chapterId ? { ...ch, content: versionContent } : ch
  )
  const saved = await projectStore.updateProject(project.value.id, { chapters })
  if (saved) {
    showVersions.value = false
    toast.success('Version restored to editor')
  }
}

const statusVariant = computed(() => {
  const map: Record<string, string> = {
    outline: 'default',
    writing: 'warning',
    draft: 'default',
    proofreading: 'warning',
    proofread: 'accent',
    polishing: 'warning',
    polished: 'success',
  }
  return (map[chapter.value?.status ?? ''] ?? 'default') as any
})

const wordCount = computed(() => {
  const text = content.value || ''
  return text.trim() ? text.trim().split(/\s+/).length : 0
})

const isMarkdownContent = computed(() => project.value?.writingFormat === 'markdown')

interface TextMatch {
  source: string
  start: number
  end: number
}

interface ChunkMatch {
  source: string
  start: number
  end: number
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeSearchChar(char: string) {
  return /\s/.test(char) ? '' : char.toLowerCase()
}

function buildNormalizedIndex(text: string) {
  let normalized = ''
  const map: number[] = []
  for (let offset = 0; offset < text.length;) {
    const char = Array.from(text.slice(offset))[0]
    const next = normalizeSearchChar(char)
    if (next) {
      normalized += next
      map.push(offset)
    }
    offset += char.length
  }
  return { normalized, map }
}

function findTextMatch(source: string, excerpt: string): TextMatch | null {
  const exactIndex = source.toLowerCase().indexOf(excerpt.toLowerCase())
  if (exactIndex >= 0) {
    return { source, start: exactIndex, end: exactIndex + excerpt.length }
  }

  const normalizedSource = buildNormalizedIndex(source)
  const normalizedExcerpt = buildNormalizedIndex(excerpt).normalized
  if (!normalizedExcerpt) return null

  const normalizedIndex = normalizedSource.normalized.indexOf(normalizedExcerpt)
  if (normalizedIndex < 0) return null

  const start = normalizedSource.map[normalizedIndex]
  const endStart = normalizedSource.map[normalizedIndex + normalizedExcerpt.length - 1]
  const end = endStart + Array.from(source.slice(endStart))[0].length
  return { source, start, end }
}

function findIssueMatch(issue: any): TextMatch | null {
  const excerpt = String(issue?.excerpt ?? '').trim()
  if (!excerpt) return null

  const sources = [
    content.value,
    chapter.value?.proofreadContent ?? '',
    chapter.value?.polishedContent ?? '',
    chapter.value?.content ?? '',
  ].filter(Boolean)

  for (const source of sources) {
    const match = findTextMatch(source, excerpt)
    if (match) return match
  }

  return null
}

function getIssueSegmentIndex(issue: any) {
  if (Number.isInteger(issue?.segmentIndex)) {
    return Number(issue.segmentIndex)
  }

  const idMatch = String(issue?.id ?? '').match(/(?:^|-)part-(\d+)(?:-|$)/)
  if (!idMatch) return -1

  return Number(idMatch[1]) - 1
}

function getContentSources() {
  return [
    content.value,
    chapter.value?.proofreadContent ?? '',
    chapter.value?.polishedContent ?? '',
    chapter.value?.content ?? '',
  ].filter(Boolean)
}

function findIssueChunkMatch(issue: any): ChunkMatch | null {
  const segmentIndex = getIssueSegmentIndex(issue)
  if (segmentIndex < 0) return null

  const segmentCharStart = Number(issue?.segmentCharStart)
  const segmentCharEnd = Number(issue?.segmentCharEnd)
  const sources = getContentSources()

  for (const source of sources) {
    if (
      Number.isFinite(segmentCharStart)
      && Number.isFinite(segmentCharEnd)
      && segmentCharStart >= 0
      && segmentCharEnd > segmentCharStart
      && segmentCharEnd <= source.length
    ) {
      return { source, start: segmentCharStart, end: segmentCharEnd }
    }

    const segment = buildProofreadingSegments(source)[segmentIndex]
    if (segment) {
      return { source, start: segment.charStart, end: segment.charEnd }
    }
  }

  return null
}

const highlightedContentHtml = computed(() => {
  const issue = selectedProofreadingIssue.value
  const match = issue ? findIssueMatch(issue) : null
  const chunk = issue && !match ? findIssueChunkMatch(issue) : null
  const source = match?.source ?? chunk?.source ?? content.value ?? ''
  if (!match && !chunk) return escapeHtml(source)

  if (chunk) {
    const before = escapeHtml(source.slice(0, chunk.start))
    const target = escapeHtml(source.slice(chunk.start, chunk.end))
    const after = escapeHtml(source.slice(chunk.end))
    return `${before}<span id="proofreading-chunk-current">${target}</span>${after}`
  }

  const before = escapeHtml(source.slice(0, match.start))
  const target = escapeHtml(source.slice(match.start, match.end))
  const after = escapeHtml(source.slice(match.end))
  return `${before}<mark class="proofreading-highlight" id="proofreading-highlight-current">${target}</mark>${after}`
})

const renderedContent = computed(() => {
  if (selectedProofreadingIssue.value) {
    return highlightedContentHtml.value
  }
  return markdownToHtml(content.value)
})

const vibeContext = computed(() => ({
  writingFormat: isMarkdownContent.value ? 'markdown' : 'plaintext',
  writingStyle: project.value?.style ?? '',
  outline: project.value?.outline ?? '',
  chapter: chapter.value
    ? {
        index: chapter.value.index,
        title: title.value,
        outline: chapter.value.outline,
        content: content.value,
      }
    : null,
}))

const characterContext = computed(() => {
  if (!project.value?.characters.length) return ''
  return project.value.characters
    .map(character => `- ${character.name} [id: ${character.id}] (${character.role})`)
    .join('\n')
})

const relationshipContext = computed(() => {
  if (!project.value || !chapter.value) return ''
  return `Relationship context is not inlined to reduce prompt size. Use relationship query tools for specific character pairs at chapterIndex ${Math.max(-1, chapter.value.index - 1)} when available.`
})

function applyVibeContent(nextContent: string) {
  if (!project.value || !chapter.value) {
    content.value = nextContent
    return
  }
  content.value = sanitizeGeneratedChapterContent(nextContent, {
    writingFormat: project.value.writingFormat,
    writingStyle: project.value.style,
    chapterTitle: title.value,
    chapterNumber: chapter.value.index + 1,
  })
  if (project.value.writingFormat === 'markdown' && detectMarkdown(content.value)) viewMode.value = 'preview'
}

async function sendToVibe(instruction: string) {
  assistantTab.value = 'vibe'
  await nextTick()
  vibeAssistant.value?.submitRequest(instruction)
}

async function saveProofreadingIssues(issues: any[]) {
  if (!project.value || !chapter.value) return
  const chapters = project.value.chapters.map(ch =>
    ch.id === props.chapterId
      ? {
          ...ch,
          proofreadingIssues: issues,
          proofreadContent: ch.proofreadContent || content.value,
          status: 'proofread' as const,
        }
      : ch
  )
  const saved = await projectStore.updateProject(project.value.id, { chapters })
  if (!saved) {
    toast.error('Failed to save proofreading issues')
  }
}

async function handleProofreadingIssueSelected(issue: any) {
  selectedProofreadingIssue.value = issue
  viewMode.value = 'preview'
  await nextTick()
  const target = contentPreviewRef.value?.querySelector('#proofreading-highlight-current')
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  const chunkTarget = contentPreviewRef.value?.querySelector('#proofreading-chunk-current')
  if (chunkTarget) {
    chunkTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  toast.warning('Could not locate this excerpt in the current chapter text. It may come from an older proofreading run.')
}
</script>

<template>
  <div v-if="chapter" class="h-full flex flex-col overflow-hidden bg-surface-0">
    <!-- Header Toolbar -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center justify-between px-6 py-5 border-b border-surface-4 shrink-0 bg-surface-1 shadow-sm">
      <div class="flex items-center gap-4 flex-1 min-w-0">
        <div class="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center border border-surface-3 shrink-0 shadow-sm">
          <FileText :size="22" class="text-accent" />
        </div>
        <div class="flex-1 flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-3">
            <span class="text-xs font-semibold text-text-muted uppercase tracking-wider">Chapter {{ chapter.index + 1 }}</span>
            <BaseTag :variant="statusVariant" size="sm" class="uppercase tracking-wider font-semibold text-[10px] px-2">{{ chapter.status }}</BaseTag>
          </div>
          <input 
            v-model="title" 
            class="text-xl font-bold text-text-primary bg-transparent outline-none placeholder:text-text-muted/50 truncate w-full transition-colors focus:text-accent"
            placeholder="Enter Chapter Title..."
          />
        </div>
      </div>

      <div class="flex items-center gap-3 shrink-0 sm:ml-4">
        <BaseTag :variant="isMarkdownContent ? 'accent' : 'default'" size="sm" class="hidden md:inline-flex">
          {{ isMarkdownContent ? 'Markdown' : 'Plain Text' }}
        </BaseTag>
        <div class="px-2.5 py-1.5 rounded-md bg-surface-2 border border-surface-3 text-xs text-text-secondary flex items-center gap-1.5 hidden md:flex">
          <Type :size="14" class="text-text-muted" />
          <span class="text-text-muted">Words:</span>
          <span class="text-text-primary font-medium">{{ wordCount }}</span>
        </div>
        <BaseButton variant="secondary" size="md" @click="showVersions = !showVersions" class="hover:border-surface-4">
          <Eye v-if="!showVersions" :size="16" />
          <EyeOff v-else :size="16" />
          <span>{{ showVersions ? 'Editor' : 'Versions' }}</span>
        </BaseButton>
        <div v-if="!showVersions" class="hidden lg:flex rounded-md border border-surface-4 bg-surface-2 p-0.5">
          <button
            :class="[
              'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
              viewMode === 'edit' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="viewMode = 'edit'"
          >
            <Code2 :size="13" />
            Edit
          </button>
          <button
            :class="[
              'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
              viewMode === 'preview' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="viewMode = 'preview'"
          >
            <BookOpen :size="13" />
            Preview
          </button>
        </div>
        <BaseButton variant="primary" size="md" @click="save">
          <Save :size="16" />
          <span>Save Changes</span>
        </BaseButton>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 min-h-0 flex overflow-hidden bg-surface-0">
      <div class="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 py-10 min-h-full flex flex-col border-l border-r border-surface-4 bg-surface-0 shadow-sm">
          <div v-if="!showVersions" class="flex-1 flex flex-col">
            <textarea
              v-if="viewMode === 'edit'"
              v-model="content"
              class="w-full flex-1 min-h-[60vh] bg-transparent text-text-primary resize-none outline-none font-serif selection:bg-accent/30 selection:text-text-primary"
              placeholder="Start writing your chapter here..."
              style="font-size: 1.125rem; line-height: 1.8; letter-spacing: 0.01em;"
            />

            <article
              v-else
              ref="contentPreviewRef"
              class="markdown-preview min-h-[60vh] text-text-primary"
              v-html="renderedContent || '<p class=&quot;text-text-muted&quot;>No content to preview.</p>'"
            />
          </div>

          <div v-else class="flex-1 flex flex-col">
            <div class="flex items-center justify-between mb-10 pb-4 border-b border-surface-4">
              <div>
                <h3 class="text-xl font-bold text-text-primary">Generation History</h3>
                <p class="text-xs text-text-secondary mt-1">Review and restore content from different generation stages.</p>
              </div>
            </div>

            <div class="space-y-16">
              <!-- Polished Version -->
              <div v-if="chapter.polishedContent" class="group relative">
                <div class="flex items-center gap-3 mb-6">
                  <div class="w-8 h-8 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
                    <Sparkles :size="16" />
                  </div>
                  <span class="text-xs font-black uppercase tracking-widest text-success">Polished Version</span>
                  <div class="h-px flex-1 bg-surface-4"></div>
                  <span class="text-[10px] font-bold text-text-muted uppercase">{{ (chapter.polishedContent.trim().split(/\s+/).length) }} words</span>
                  <BaseButton variant="secondary" size="sm" @click="restoreVersion(chapter.polishedContent)" class="ml-4">
                    <RotateCcw :size="14" class="mr-1.5" />
                    Restore
                  </BaseButton>
                </div>
                <div class="text-text-primary font-serif text-lg leading-relaxed whitespace-pre-wrap px-2">
                  {{ chapter.polishedContent }}
                </div>
              </div>

              <!-- Proofread Version -->
              <div v-if="chapter.proofreadContent" class="group relative">
                <div class="flex items-center gap-3 mb-6">
                  <div class="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center shrink-0">
                    <CheckCircle2 :size="16" />
                  </div>
                  <span class="text-xs font-black uppercase tracking-widest text-accent">Proofread Version</span>
                  <div class="h-px flex-1 bg-surface-4"></div>
                  <span class="text-[10px] font-bold text-text-muted uppercase">{{ (chapter.proofreadContent.trim().split(/\s+/).length) }} words</span>
                  <BaseButton variant="secondary" size="sm" @click="restoreVersion(chapter.proofreadContent)" class="ml-4">
                    <RotateCcw :size="14" class="mr-1.5" />
                    Restore
                  </BaseButton>
                </div>
                <div class="text-text-primary font-serif text-lg leading-relaxed whitespace-pre-wrap px-2">
                  {{ chapter.proofreadContent }}
                </div>
              </div>

              <!-- Draft Version -->
              <div v-if="chapter.content" class="group relative">
                <div class="flex items-center gap-3 mb-6">
                  <div class="w-8 h-8 rounded-full bg-surface-3 text-text-muted flex items-center justify-center shrink-0">
                    <Clock :size="16" />
                  </div>
                  <span class="text-xs font-black uppercase tracking-widest text-text-muted">Initial Draft</span>
                  <div class="h-px flex-1 bg-surface-4"></div>
                  <span class="text-[10px] font-bold text-text-muted uppercase">{{ (chapter.content.trim().split(/\s+/).length) }} words</span>
                  <BaseButton variant="secondary" size="sm" @click="restoreVersion(chapter.content)" class="ml-4">
                    <RotateCcw :size="14" class="mr-1.5" />
                    Restore
                  </BaseButton>
                </div>
                <div class="text-text-primary font-serif text-lg leading-relaxed whitespace-pre-wrap px-2">
                  {{ chapter.content }}
                </div>
              </div>

              <div v-if="!chapter.content && !chapter.proofreadContent && !chapter.polishedContent" class="h-[40vh] flex flex-col items-center justify-center text-center">
                <div class="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-4 border border-surface-3">
                  <FileText :size="24" class="text-text-muted" />
                </div>
                <p class="text-base font-medium text-text-primary">No content generated yet</p>
                <p class="text-sm text-text-secondary mt-1 max-w-sm">Use the generation tools to create content for this chapter.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="hidden xl:flex w-[390px] shrink-0 flex-col border-l border-surface-4 bg-surface-1">
        <div class="flex h-8 shrink-0 border-b border-surface-4 bg-surface-2/60 p-1">
          <button
            :class="[
              'flex-1 rounded text-[11px] font-medium transition-colors',
              assistantTab === 'vibe' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="assistantTab = 'vibe'"
          >
            Vibe AI
          </button>
          <button
            :class="[
              'flex-1 rounded text-[11px] font-medium transition-colors',
              assistantTab === 'editing' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="assistantTab = 'editing'"
          >
            Editing AI
          </button>
          <button
            :class="[
              'flex-1 rounded text-[11px] font-medium transition-colors',
              assistantTab === 'proofreading' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="assistantTab = 'proofreading'"
          >
            Proofreading
          </button>
        </div>

        <VibeAssistant
          v-if="assistantTab === 'vibe'"
          ref="vibeAssistant"
          stage="chapter-detail"
          mode="editor-agent"
          :context="vibeContext"
          @apply="applyVibeContent"
        />
        <EditingAssistant
          v-else-if="assistantTab === 'editing'"
          :project-id="project?.id"
          :chapter-title="title"
          :chapter-number="chapter.index + 1"
          :content="content"
          :chapter-plan="chapter.outline"
          :characters="characterContext"
          :relationships="relationshipContext"
          :story-outline="project?.outline ?? ''"
          :writing-format="isMarkdownContent ? 'markdown' : 'plaintext'"
          @fix="sendToVibe"
        />
        <ProofreadingAssistant
          v-else
          :project-id="project?.id"
          :chapter-id="chapter.id"
          :chapter-title="title"
          :chapter-number="chapter.index + 1"
          :content="content"
          :chapter-outline="chapter.outline"
          :characters="characterContext"
          :relationships="relationshipContext"
          :story-outline="project?.outline ?? ''"
          :language="project?.language ?? 'English'"
          :writing-format="isMarkdownContent ? 'markdown' : 'plaintext'"
          :initial-issues="chapter.proofreadingIssues || []"
          @fix="sendToVibe"
          @issuesFound="saveProofreadingIssues"
          @issueSelected="handleProofreadingIssueSelected"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.markdown-preview {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.0625rem;
  line-height: 1.78;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  color: #e6edf3;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  font-weight: 700;
  line-height: 1.25;
  margin: 1.6em 0 0.65em;
}

.markdown-preview :deep(h1) { font-size: 1.8rem; }
.markdown-preview :deep(h2) { font-size: 1.45rem; }
.markdown-preview :deep(h3) { font-size: 1.2rem; }

.markdown-preview :deep(p) {
  margin: 0 0 1.1em;
}

.markdown-preview :deep(.proofreading-highlight) {
  background: rgba(245, 158, 11, 0.35);
  color: inherit;
  border-radius: 0.2rem;
  padding: 0.05rem 0.12rem;
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.45);
}

.markdown-preview :deep(blockquote) {
  border-left: 3px solid #58a6ff;
  color: #b7c1cc;
  margin: 1.2em 0;
  padding: 0.1em 0 0.1em 1em;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin: 0 0 1.2em 1.3em;
  padding: 0;
}

.markdown-preview :deep(li) {
  margin: 0.35em 0;
}

.markdown-preview :deep(code) {
  background: #21262d;
  border: 1px solid #2d333b;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: 0.85em;
  padding: 0.1em 0.35em;
}

.markdown-preview :deep(pre) {
  background: #0d1117;
  border: 1px solid #2d333b;
  border-radius: 8px;
  margin: 1.25em 0;
  overflow-x: auto;
  padding: 1em;
}

.markdown-preview :deep(pre code) {
  background: transparent;
  border: 0;
  padding: 0;
}

.markdown-preview :deep(a) {
  color: #58a6ff;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.markdown-preview :deep(hr) {
  border: 0;
  border-top: 1px solid #373e47;
  margin: 2em 0;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  display: block;
  margin: 1.25em 0;
  overflow-x: auto;
  width: 100%;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid #2d333b;
  padding: 0.45em 0.65em;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: #1c2128;
}
</style>
