<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGenerationStore, type ChapterAuditIssue } from '@/stores/generation'
import { useToast } from '@/composables/useToast'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { AlertTriangle, CheckCircle2, FileSearch, Send, ShieldCheck, Sparkles } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  projectId?: string
  chapterId?: string
  actionMode?: 'detail' | 'workflow'
  chapterTitle: string
  chapterNumber: number
  content: string
  chapterOutline: Record<string, any>
  characters: string
  relationships: string
  storyOutline: string
  language: string
  writingFormat: string
  initialIssues?: ChapterAuditIssue[]
  isPolishing?: boolean
}>(), {
  actionMode: 'detail',
  initialIssues: () => [],
  isPolishing: false,
})

const emit = defineEmits<{
  fix: [instruction: string]
  issuesFound: [issues: ChapterAuditIssue[]]
  issueSelected: [issue: ChapterAuditIssue]
  quickSubmitPolish: []
}>()

const genStore = useGenerationStore()
const toast = useToast()

const issues = ref<ChapterAuditIssue[]>([])
const isProofereading = ref(false)
const selectedIssueId = ref<string | null>(null)
const editingAdjustmentId = ref<string | null>(null)
const adjustmentDraft = ref('')
const proofreadingTriggered = ref(false)
const currentSegment = ref<{ index: number; total: number; completed: number } | null>(null)

const hasContent = computed(() => props.content.trim().length > 0)
const selectedIssue = computed(() => issues.value.find(issue => issue.id === selectedIssueId.value) ?? null)
const isDetailMode = computed(() => props.actionMode === 'detail')
const isWorkflowMode = computed(() => props.actionMode === 'workflow')
const proofreadProgressPercent = computed(() => {
  if (!currentSegment.value?.total) return 0
  return Math.round((currentSegment.value.completed / currentSegment.value.total) * 100)
})

const severityVariant = computed(() => (severity: ChapterAuditIssue['severity']) => {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'default'
})

watch(
  () => [props.content, props.initialIssues] as const,
  () => {
    if (isProofereading.value) return
    issues.value = [...props.initialIssues]
    selectedIssueId.value = issues.value[0]?.id ?? null
    proofreadingTriggered.value = issues.value.length > 0
  },
  { immediate: true }
)

function buildProofreadContextPrompt() {
  return [
    'The application has already selected the current chapter. Proofread only this chapter; do not choose or request another chapter.',
    `Current Chapter: ${props.chapterNumber}. ${props.chapterTitle}`,
    `Language: ${props.language}`,
    `Format: ${props.writingFormat}`,
    `Story Outline:\n${props.storyOutline || 'None provided.'}`,
    `Chapter Plan:\n${JSON.stringify(props.chapterOutline, null, 2)}`,
    `Compact Character Directory:\n${props.characters || 'None provided.'}`,
    `Relationship Lookup:\n${props.relationships || 'Use relationship query tools when available.'}`,
    'Use relationship/character tools for specific facts instead of assuming full context is in this prompt.',
    'The chapter text will be submitted in small sequential segments. Process only the segment included in each request.',
  ].join('\n\n')
}

async function proofread() {
  if (!hasContent.value || isProofereading.value) return

  isProofereading.value = true
  selectedIssueId.value = null
  proofreadingTriggered.value = true
  currentSegment.value = null
  issues.value = []

  try {
    issues.value = await genStore.proofreadChapterContentWithTool(buildProofreadContextPrompt(), props.content, props.projectId, {
      onSegmentStart: ({ segmentIndex, segmentTotal }) => {
        currentSegment.value = {
          index: segmentIndex + 1,
          total: segmentTotal,
          completed: segmentIndex,
        }
      },
      onSegmentComplete: async ({ segmentIndex, segmentTotal, allIssues }) => {
        currentSegment.value = {
          index: segmentIndex + 1,
          total: segmentTotal,
          completed: segmentIndex + 1,
        }
        issues.value = allIssues
        selectedIssueId.value = selectedIssueId.value ?? issues.value[0]?.id ?? null
        emit('issuesFound', issues.value)

        if (props.projectId && props.chapterId) {
          await genStore.saveChapterProofreadingIssues(props.projectId, props.chapterId, issues.value, props.content)
        }
      },
    })
    if (props.projectId && props.chapterId) {
      await genStore.saveChapterProofreadingIssues(props.projectId, props.chapterId, issues.value, props.content)
    }
    selectedIssueId.value = issues.value[0]?.id ?? null
    emit('issuesFound', issues.value)

    if (!issues.value.length) {
      toast.success('No errors found')
    } else {
      toast.success(`Found ${issues.value.length} issue${issues.value.length === 1 ? '' : 's'}`)
    }
  } catch (error: any) {
    toast.error(error?.message || 'Proofreading failed')
  } finally {
    isProofereading.value = false
    currentSegment.value = null
  }
}

// Expose proofread method for external calls
defineExpose({ proofread })

function buildFixInstruction(items: ChapterAuditIssue[]) {
  const issueText = items.map((issue, index) => [
    `${index + 1}. ${issue.title}`,
    `Severity: ${issue.severity}`,
    `Category: ${issue.category}`,
    issue.excerpt ? `Excerpt: ${issue.excerpt}` : '',
    `Problem: ${issue.explanation}`,
    `Fix: ${issue.suggestedFix}`,
  ].filter(Boolean).join('\n')).join('\n\n')

  return [
    'Fix the following Proofreading Expert findings in the current chapter.',
    props.writingFormat === 'markdown'
      ? 'Preserve the chapter plan, characters, relationship continuity, and Markdown formatting.'
      : 'Preserve the chapter plan, characters, and relationship continuity. Output Plain Text by default; do not add Markdown headings, chapter title lines, or chapter number lines unless the Writing Style Guide explicitly requires them.',
    'Return the full revised chapter content through the replace_chapter_content tool.',
    '',
    issueText,
  ].join('\n')
}

function fixIssue(issue: ChapterAuditIssue) {
  emit('fix', buildFixInstruction([issue]))
}

function fixAll() {
  if (!issues.value.length) return
  emit('fix', buildFixInstruction(issues.value))
}

function persistIssueChanges() {
  emit('issuesFound', issues.value)
}

function selectIssue(issue: ChapterAuditIssue) {
  selectedIssueId.value = issue.id
  emit('issueSelected', issue)
}

function toggleIssueIgnored(issue: ChapterAuditIssue) {
  issue.ignored = !issue.ignored
  issue.polishStatus = issue.ignored ? 'ignored' : 'pending'
  issue.polishResult = issue.ignored ? 'Ignored by user.' : ''
  persistIssueChanges()
}

function startEditAdjustment(issue: ChapterAuditIssue) {
  editingAdjustmentId.value = issue.id
  adjustmentDraft.value = issue.adjustment || issue.suggestedFix || ''
}

function saveAdjustment(issue: ChapterAuditIssue) {
  issue.adjustment = adjustmentDraft.value.trim()
  editingAdjustmentId.value = null
  adjustmentDraft.value = ''
  persistIssueChanges()
}

function cancelAdjustment() {
  editingAdjustmentId.value = null
  adjustmentDraft.value = ''
}

function submitToPolish() {
  if (props.isPolishing || isProofereading.value) return
  emit('quickSubmitPolish')
}
</script>

<template>
  <div class="flex h-full flex-col bg-surface-1">
    <div class="flex h-[45px] shrink-0 items-center border-b border-surface-4 bg-surface-2 px-4 py-2">
      <div class="flex items-center gap-2">
        <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/10">
          <ShieldCheck :size="13" class="text-accent" />
        </div>
        <div class="min-w-0">
          <h3 class="truncate text-xs font-semibold text-text-primary">Proofreading Expert</h3>
          <p class="truncate text-[9px] font-bold uppercase tracking-widest text-text-muted">Grammar & consistency audit</p>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-3 py-4">
      <div v-if="!hasContent" class="flex h-full flex-col items-center justify-center text-center">
        <FileSearch :size="24" class="mb-3 text-text-muted" />
        <p class="text-sm font-medium text-text-primary">No chapter content</p>
        <p class="mt-1 max-w-[240px] text-xs text-text-secondary">Write or generate chapter text before running a proofread.</p>
      </div>

      <template v-else>
        <div v-if="isProofereading" class="mb-4 rounded-xl border border-accent/20 bg-accent/10 p-3">
          <div class="mb-2 flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <Sparkles :size="15" class="shrink-0 animate-pulse text-accent" />
              <div class="min-w-0">
                <p class="truncate text-xs font-semibold text-text-primary">Proofreading in progress</p>
                <p class="text-[10px] text-text-muted">
                  Segment {{ currentSegment?.index ?? 1 }}/{{ currentSegment?.total ?? '?' }} - {{ issues.length }} issue{{ issues.length === 1 ? '' : 's' }} collected
                </p>
              </div>
            </div>
            <span class="shrink-0 text-xs font-bold text-accent">{{ proofreadProgressPercent }}%</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              class="h-full rounded-full bg-accent transition-all duration-300"
              :style="{ width: `${proofreadProgressPercent}%` }"
            ></div>
          </div>
          <p class="mt-2 text-[10px] leading-relaxed text-text-secondary">
            Continuing one Proofreading session and submitting segments sequentially.
          </p>
        </div>

        <div v-if="isProofereading && !issues.length" class="flex h-[calc(100%-5rem)] flex-col items-center justify-center text-center">
          <Sparkles :size="24" class="mb-3 animate-pulse text-accent" />
          <p class="text-sm font-medium text-text-primary">Scanning current segment...</p>
          <p class="mt-1 max-w-[260px] text-xs text-text-secondary">
            Issues will appear here as soon as each segment reports results.
          </p>
        </div>

        <div v-else-if="!issues.length && !isProofereading" class="flex h-full flex-col items-center justify-center text-center">
          <CheckCircle2 :size="24" class="mb-3 text-success" />
          <p class="text-sm font-medium text-text-primary">No issues found</p>
          <p class="mt-1 max-w-[260px] text-xs text-text-secondary">
            This chapter has been proofread.
            <br class="mt-2" />
            Issues will appear below when detected.
          </p>
        </div>

        <div v-else class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs font-semibold text-text-primary">{{ issues.length }} issue{{ issues.length === 1 ? '' : 's' }} found</p>
            <p class="text-[10px] text-text-muted">
              <template v-if="isProofereading">
                Segment {{ currentSegment?.index ?? 1 }}/{{ currentSegment?.total ?? '?' }} is being scanned. More issues may appear.
              </template>
              <template v-else>
                Click an issue to inspect it.
              </template>
            </p>
          </div>
          <BaseButton v-if="isDetailMode" variant="primary" size="sm" :disabled="!issues.length" @click="fixAll">
            <Send :size="13" />
            <span>Fix all</span>
          </BaseButton>
        </div>

        <button
          v-for="issue in issues"
          :key="issue.id"
          class="w-full rounded-lg border p-3 text-left transition-colors"
          :class="selectedIssueId === issue.id ? 'border-accent/50 bg-accent-subtle/50' : 'border-surface-4 bg-surface-2 hover:border-surface-5'"
          @click="selectIssue(issue)"
        >
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <AlertTriangle :size="13" class="text-accent" />
                <p class="truncate text-xs font-semibold text-text-primary">{{ issue.title }}</p>
              </div>
              <p class="mt-1 text-[10px] uppercase tracking-wider text-text-muted">
                {{ issue.category }}
                <span v-if="issue.ignored"> · ignored</span>
                <span v-else-if="issue.polishStatus"> · {{ issue.polishStatus }}</span>
              </p>
            </div>
            <BaseTag :variant="severityVariant(issue.severity)" size="sm">{{ issue.severity }}</BaseTag>
          </div>
          <p v-if="issue.excerpt" class="rounded border border-surface-4 bg-surface-1 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
            {{ issue.excerpt }}
          </p>
          <p v-if="issue.adjustment" class="mt-2 rounded border border-accent/20 bg-accent/10 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
            Adjustment: {{ issue.adjustment }}
          </p>
          <p v-if="issue.polishResult" class="mt-2 text-[11px] leading-relaxed text-text-muted">
            Polish result: {{ issue.polishResult }}
          </p>
        </button>
        </div>
      </template>
    </div>

    <div v-if="selectedIssue" class="shrink-0 border-t border-surface-4 bg-surface-2/60 p-3">
      <p class="text-xs font-semibold text-text-primary">{{ selectedIssue.title }}</p>
      <p class="mt-2 text-xs leading-relaxed text-text-secondary">{{ selectedIssue.explanation }}</p>
      <p class="mt-2 text-xs leading-relaxed text-text-primary">{{ selectedIssue.suggestedFix }}</p>
      <div class="mt-3 flex gap-2">
        <BaseButton class="flex-1" variant="secondary" size="sm" @click="toggleIssueIgnored(selectedIssue)">
          <span>{{ selectedIssue.ignored ? 'Unignore' : 'Ignore issue' }}</span>
        </BaseButton>
        <BaseButton class="flex-1" variant="secondary" size="sm" @click="startEditAdjustment(selectedIssue)">
          <span>Edit fix</span>
        </BaseButton>
      </div>
      <div v-if="editingAdjustmentId === selectedIssue.id" class="mt-3">
        <textarea
          v-model="adjustmentDraft"
          class="min-h-20 w-full rounded-md border border-surface-4 bg-surface-1 px-2 py-2 text-xs leading-relaxed text-text-primary outline-none focus:border-accent"
          placeholder="Describe how this issue should be fixed..."
        ></textarea>
        <div class="mt-2 flex gap-2">
          <BaseButton class="flex-1" variant="primary" size="sm" @click="saveAdjustment(selectedIssue)">
            <span>Save adjustment</span>
          </BaseButton>
          <BaseButton class="flex-1" variant="secondary" size="sm" @click="cancelAdjustment">
            <span>Cancel</span>
          </BaseButton>
        </div>
      </div>
      <BaseButton v-if="isDetailMode" class="mt-3 w-full" variant="primary" size="sm" @click="fixIssue(selectedIssue)">
        <Send :size="13" />
        <span>Send this to Vibe AI</span>
      </BaseButton>
    </div>

    <div v-if="isWorkflowMode && issues.length" class="shrink-0 border-t border-surface-4 bg-surface-2/60 p-3">
      <p class="text-xs font-semibold text-text-primary mb-2">Ready to polish?</p>
      <BaseButton class="w-full" variant="primary" size="sm" :disabled="isPolishing || isProofereading" @click="submitToPolish">
        <Sparkles :size="13" :class="isPolishing ? 'animate-pulse' : ''" />
        <span>{{ isPolishing ? 'Submitting to Polish...' : 'Quick Submit to Polish' }}</span>
      </BaseButton>
    </div>
  </div>
</template>

