<script setup lang="ts">
import { computed } from 'vue'
import { translatePhrase } from '@/i18n'
import { buildIssueChangeRuns, type ChapterAuditIssue } from '@/app'

const props = defineProps<{
  issues: ChapterAuditIssue[]
  busy?: boolean
  stale?: boolean
}>()

const emit = defineEmits<{
  applyFix: [issue: ChapterAuditIssue]
  ignore: [issue: ChapterAuditIssue]
  polishAll: []
  close: []
}>()

const tr = translatePhrase

const categoryLabel: Record<ChapterAuditIssue['category'], string> = {
  chapter_plan: 'Chapter plan',
  character: 'Character',
  relationship: 'Relationship',
  continuity: 'Continuity',
  factual: 'Factual',
  logic: 'Logic',
  style: 'Style',
  grammar: 'Grammar',
  typo: 'Typo',
  pacing: 'Pacing',
  consistency: 'Consistency',
}

const severityLabel: Record<ChapterAuditIssue['severity'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const visible = computed(() =>
  props.issues
    .filter(issue => issue.polishStatus !== 'fixed' && !issue.ignored)
    .map(issue => ({
      issue,
      meta: `${tr(severityLabel[issue.severity]).toLowerCase()} · ${tr(categoryLabel[issue.category])}`,
      runs: buildIssueChangeRuns(issue),
    })),
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-proofreading-review>
    <div class="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
      <div class="min-w-0">
        <p class="text-caption font-semibold text-text-primary">{{ tr('Proofreading') }}</p>
        <p class="text-meta text-text-muted">
          {{ visible.length }} {{ tr('open issues') }}<span v-if="stale"> · {{ tr('text changed since proofread') }}</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-4">
        <button class="inline-diff-action" :disabled="busy || !visible.length" @click="emit('polishAll')">
          {{ tr('Polish all') }}
        </button>
        <button class="inline-diff-action" @click="emit('close')">
          {{ tr('Close') }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
      <ul v-if="visible.length" class="space-y-5">
        <li v-for="{ issue, meta, runs } in visible" :key="issue.id" :data-proofreading-issue="issue.id">
          <p class="text-meta text-text-muted" :data-proofreading-meta="issue.id">{{ meta }}</p>
          <h4 class="mt-0.5 text-caption font-semibold text-text-primary">{{ issue.title }}</h4>
          <p class="mt-0.5 text-caption leading-relaxed text-text-secondary">{{ issue.explanation }}</p>

          <p
            v-if="runs.length"
            class="mt-1.5 whitespace-pre-wrap text-caption leading-relaxed text-text-primary"
            :data-proofreading-change="issue.id"
          >
            <span
              v-for="(run, index) in runs"
              :key="index"
              :class="run.type === 'removed' ? 'proofreview-removed' : run.type === 'added' ? 'proofreview-added' : ''"
            >{{ run.text }}</span>
          </p>

          <div class="mt-1 flex items-center gap-4">
            <button
              class="inline-diff-action text-meta disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="busy || !issue.suggestedFix"
              :data-proofreading-apply="issue.id"
              @click="emit('applyFix', issue)"
            >
              {{ tr('Accept fix') }}
            </button>
            <button
              class="inline-diff-action text-meta disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="busy"
              :data-proofreading-ignore="issue.id"
              @click="emit('ignore', issue)"
            >
              {{ tr('Ignore') }}
            </button>
          </div>
        </li>
      </ul>

      <p v-else class="px-1 py-6 text-center text-caption text-text-muted" data-proofreading-empty>
        {{ tr('No open proofreading issues') }}
      </p>
    </div>
  </div>
</template>
