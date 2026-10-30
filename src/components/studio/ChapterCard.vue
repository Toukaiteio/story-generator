<script setup lang="ts">
import { computed } from 'vue'
import { PenLine, ShieldCheck, Sparkles } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { translatePhrase } from '@/i18n'
import { countWords } from '@/app'
import type { Chapter } from '@/types/chapter'

const props = defineProps<{
  chapter: Chapter
  busy?: boolean
}>()

const emit = defineEmits<{
  open: []
  write: []
  proofread: []
  polish: []
  plan: []
}>()

const tr = translatePhrase

const statusLabel = computed(() => {
  const labels: Record<Chapter['status'], string> = {
    outline: 'Plan',
    writing: 'Writing',
    draft: 'Draft',
    proofreading: 'Proofread',
    proofread: 'Proofread',
    polishing: 'Polish',
    polished: 'Final',
  }
  return labels[props.chapter.status]
})

const words = computed(() => countWords(props.chapter.content || props.chapter.polishedContent))
const hasDraft = computed(() => words.value > 0)
</script>

<template>
  <button
    type="button"
    class="w-full rounded-2xl border border-surface-4 bg-surface-1 p-3 text-left transition-colors hover:border-surface-5"
    @click="emit('open')"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-2xs font-bold text-text-muted">{{ chapter.index + 1 }}</span>
      <BaseTag :variant="chapter.status === 'polished' ? 'success' : hasDraft ? 'accent' : 'default'" size="sm">
        {{ tr(statusLabel) }}
      </BaseTag>
    </div>
    <p class="mt-1.5 truncate text-sm font-semibold text-text-primary">{{ chapter.title }}</p>
    <p class="mt-0.5 truncate text-xs text-text-secondary">{{ chapter.outline.objective || tr('No plan yet') }}</p>

    <div class="mt-2.5 flex items-center justify-between gap-1" @click.stop>
      <span class="text-2xs text-text-muted">{{ words }} {{ tr('words') }}</span>
      <div class="flex items-center gap-1">
        <BaseButton v-if="!hasDraft" variant="ghost" size="sm" :disabled="busy" @click="emit('plan')">
          <Sparkles :size="13" />
        </BaseButton>
        <BaseButton v-else variant="ghost" size="sm" :disabled="busy" @click="emit('proofread')">
          <ShieldCheck :size="13" />
        </BaseButton>
        <BaseButton variant="ghost" size="sm" :disabled="busy" @click="emit('write')">
          <PenLine :size="13" />
        </BaseButton>
      </div>
    </div>
  </button>
</template>
