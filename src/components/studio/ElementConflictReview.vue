<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Check, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import { translatePhrase, formatChapterLabel } from '@/i18n'
import type { ElementStateConflict } from '@/app'

const props = defineProps<{
  conflicts: ElementStateConflict[]
  busy?: boolean
}>()

const emit = defineEmits<{
  accept: [conflict: ElementStateConflict]
  discard: []
  openChapter: [chapterIndex: number]
}>()

const tr = translatePhrase

const reasonLabel = computed<Record<string, string>>(() => ({
  'location-conflict': tr('Two places in one chapter'),
  'status-conflict': tr('Contradicting statuses'),
  'proposal-conflict': tr('Conflicts with the saved state'),
}))
</script>

<template>
  <div class="overflow-hidden rounded-ios bg-surface-1 shadow-ios-pill">
    <div class="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
      <p class="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
        <AlertTriangle :size="15" class="text-warning" />
        {{ tr('Timeline conflicts') }}
      </p>
      <span class="rounded-full bg-warning-subtle px-2 py-0.5 text-meta font-medium text-warning">{{ conflicts.length }}</span>
    </div>

    <div class="max-h-[34vh] space-y-1.5 overflow-y-auto px-4 pb-3 pt-2">
      <article
        v-for="conflict in conflicts"
        :key="conflict.id"
        class="rounded-ios bg-surface-2/70 px-3 py-2.5"
      >
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-caption font-semibold text-text-primary">{{ conflict.elementName }}</span>
          <span class="rounded-full bg-surface-1 px-2 py-0.5 text-meta text-text-secondary">{{ reasonLabel[conflict.reason] || conflict.reason }}</span>
          <button
            class="rounded-full bg-surface-1 px-2 py-0.5 text-meta text-text-secondary hover:text-accent"
            @click="emit('openChapter', conflict.chapterIndex)"
          >
            {{ formatChapterLabel(conflict.chapterIndex) }}
          </button>
        </div>
        <p class="mt-1 text-meta leading-relaxed text-text-secondary">{{ conflict.detail }}</p>
        <div class="mt-2 flex justify-end gap-1.5">
          <BaseButton variant="secondary" size="sm" :disabled="busy" @click="emit('accept', conflict)">
            <Check :size="14" />
            <span>{{ tr('Keep latest') }}</span>
          </BaseButton>
        </div>
      </article>
    </div>

    <div class="flex justify-end px-4 pb-3">
      <BaseButton variant="ghost" size="sm" @click="emit('discard')">
        <X :size="14" />
        <span>{{ tr('Dismiss') }}</span>
      </BaseButton>
    </div>
  </div>
</template>
