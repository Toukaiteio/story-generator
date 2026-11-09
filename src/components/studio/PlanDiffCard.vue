<script setup lang="ts">
import { Check, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import { translatePhrase } from '@/i18n'
import type { ChapterPlanDraft } from '@/app'

defineProps<{
  draft: ChapterPlanDraft
  existing?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ accept: []; discard: [] }>()
const tr = translatePhrase

const sections = (draft: ChapterPlanDraft) => [
  { label: 'Objective', value: draft.outline.objective },
  { label: 'Conflict', value: draft.outline.conflict },
  { label: 'Key events', value: draft.outline.keyEvents.join('\n') },
  { label: 'Character actions', value: draft.outline.characterActions.join('\n') },
  { label: 'Reveals', value: draft.outline.infoReveals.join('\n') },
  { label: 'Ending hook', value: draft.outline.endingHook },
].filter(section => section.value.trim())
</script>

<template>
  <div class="overflow-hidden rounded-ios-lg bg-surface-1 shadow-ios-lg">
    <div class="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
      <div class="min-w-0">
        <p class="text-meta font-medium text-accent">{{ tr(existing ? 'Chapter plan revision' : 'Proposed chapter') }}</p>
        <h3 class="truncate text-title font-semibold text-text-primary">{{ draft.title }}</h3>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <BaseButton variant="secondary" size="sm" :disabled="busy" @click="emit('discard')">
          <X :size="15" />
        </BaseButton>
        <BaseButton variant="primary" size="sm" :loading="busy" @click="emit('accept')">
          <Check :size="15" />
          <span>{{ tr('Apply plan') }}</span>
        </BaseButton>
      </div>
    </div>

    <div class="max-h-[46vh] space-y-2 overflow-y-auto px-5 pb-4 pt-1">
      <div v-for="section in sections(draft)" :key="section.label" class="rounded-ios bg-surface-2/70 px-4 py-2.5">
        <p class="text-meta font-medium text-text-muted">{{ tr(section.label) }}</p>
        <p class="mt-0.5 whitespace-pre-wrap text-caption leading-relaxed text-text-primary">{{ section.value }}</p>
      </div>
    </div>
  </div>
</template>
