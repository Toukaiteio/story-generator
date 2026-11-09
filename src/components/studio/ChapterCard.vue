<script setup lang="ts">
import { computed } from 'vue'
import { PenLine, RefreshCw, ShieldCheck, Sparkles, Wand2 } from 'lucide-vue-next'
import BaseTag from '@/components/ui/BaseTag.vue'
import { translatePhrase } from '@/i18n'
import { countWords } from '@/app'
import type { Chapter } from '@/types/chapter'

const props = defineProps<{
  chapter: Chapter
  busy?: boolean
  active?: boolean
}>()

const emit = defineEmits<{
  open: []
  plan: []
  proofread: []
  polish: []
  syncElements: []
}>()

const tr = translatePhrase

const statusLabel = computed(() => {
  const labels: Record<Chapter['status'], string> = {
    outline: 'Idea',
    writing: 'Writing',
    draft: 'Draft',
    proofreading: 'Proofread',
    proofread: 'Proofread',
    polishing: 'Polish',
    polished: 'Final',
  }
  return labels[props.chapter.status]
})

const statusVariant = computed(() => {
  if (props.chapter.status === 'polished') return 'success'
  if (['proofreading', 'proofread', 'polishing'].includes(props.chapter.status)) return 'warning'
  if (['writing', 'draft'].includes(props.chapter.status)) return 'accent'
  return 'default'
})

const words = computed(() => countWords(props.chapter.content || props.chapter.polishedContent))
const hasDraft = computed(() => words.value > 0)
</script>

<template>
  <article
    class="group rounded-ios border border-transparent bg-surface-1 p-3.5 shadow-ios-pill transition-colors hover:border-accent/40"
    :class="active ? 'ring-2 ring-inset ring-accent/40' : ''"
  >
    <button type="button" class="block w-full text-left" @click="emit('open')">
      <div class="flex items-center justify-between gap-2">
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-meta font-semibold text-text-secondary">
          {{ chapter.index + 1 }}
        </span>
        <BaseTag :variant="statusVariant" size="sm">{{ tr(statusLabel) }}</BaseTag>
      </div>
      <h4 class="mt-2 truncate text-body font-semibold text-text-primary">{{ chapter.title }}</h4>
      <p class="mt-0.5 line-clamp-2 text-caption leading-relaxed text-text-secondary">
        {{ chapter.outline.objective || tr('No plan yet') }}
      </p>
    </button>

    <div class="mt-2.5 flex items-center gap-1" @click.stop>
      <button class="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-subtle hover:text-accent" :title="tr('Plan this chapter')" :disabled="busy" @click="emit('plan')">
        <Sparkles :size="15" />
      </button>
      <button class="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-subtle hover:text-accent" :title="tr('Proofread')" :disabled="busy || !hasDraft" @click="emit('proofread')">
        <ShieldCheck :size="15" />
      </button>
      <button class="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-subtle hover:text-accent" :title="tr('Polish')" :disabled="busy || !hasDraft" @click="emit('polish')">
        <Wand2 :size="15" />
      </button>
      <button class="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-subtle hover:text-accent" :title="tr('Sync elements')" :disabled="busy || !hasDraft" @click="emit('syncElements')">
        <RefreshCw :size="15" />
      </button>
      <button class="ml-auto flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-2.5 text-meta font-medium text-text-primary transition-colors hover:bg-surface-3" :disabled="busy" @click="emit('open')">
        <PenLine :size="14" />
        {{ tr('Write') }}
      </button>
    </div>
  </article>
</template>
