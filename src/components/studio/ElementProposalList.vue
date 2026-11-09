<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import { translatePhrase, formatChapterLabel } from '@/i18n'
import type { ElementStateProposal } from '@/app'

const props = defineProps<{
  proposals: ElementStateProposal[]
  title?: string
  busy?: boolean
}>()

const emit = defineEmits<{ apply: [selected: ElementStateProposal[]]; discard: [] }>()
const tr = translatePhrase

const rejected = ref<Set<string>>(new Set())

watch(() => props.proposals, () => { rejected.value = new Set() })

function keyOf(proposal: ElementStateProposal, index: number) {
  return `${proposal.elementId ?? proposal.name}-${proposal.state.chapterIndex}-${index}`
}

function isRejected(proposal: ElementStateProposal, index: number) {
  return rejected.value.has(keyOf(proposal, index))
}

function toggle(proposal: ElementStateProposal, index: number) {
  const next = new Set(rejected.value)
  const key = keyOf(proposal, index)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  rejected.value = next
}

const accepted = computed(() =>
  props.proposals.filter((proposal, index) => !isRejected(proposal, index)),
)
</script>

<template>
  <div class="overflow-hidden rounded-ios bg-surface-1 shadow-ios-pill">
    <div class="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
      <p class="text-caption font-semibold text-text-primary">{{ tr(title || 'Element updates') }}</p>
      <span class="rounded-full bg-surface-2 px-2 py-0.5 text-meta font-medium text-text-secondary">{{ accepted.length }}/{{ proposals.length }}</span>
    </div>

    <div class="max-h-[40vh] space-y-1.5 overflow-y-auto px-4 pb-3 pt-2">
      <button
        v-for="(proposal, index) in proposals"
        :key="keyOf(proposal, index)"
        type="button"
        class="flex w-full items-start gap-2.5 rounded-ios px-3 py-2 text-left transition-colors"
        :class="isRejected(proposal, index) ? 'bg-surface-2/60 opacity-60' : 'bg-accent-subtle/60'"
        @click="toggle(proposal, index)"
      >
        <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" :class="isRejected(proposal, index) ? 'bg-surface-3 text-text-muted' : 'bg-accent text-text-inverse'">
          <Check v-if="!isRejected(proposal, index)" :size="12" />
          <X v-else :size="12" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="text-caption font-semibold text-text-primary">{{ proposal.name }}</span>
            <span class="rounded-full bg-surface-1 px-2 py-0.5 text-meta text-text-secondary">{{ tr(proposal.kind) }}</span>
            <span v-if="proposal.state.status" class="rounded-full bg-surface-1 px-2 py-0.5 text-meta text-accent">{{ tr(proposal.state.status) }}</span>
            <span class="rounded-full bg-surface-1 px-2 py-0.5 text-meta text-text-muted">{{ formatChapterLabel(proposal.state.chapterIndex) }}</span>
          </span>
          <span class="mt-1 block text-meta leading-relaxed text-text-secondary">{{ proposal.state.summary }}</span>
        </span>
      </button>
    </div>

    <div class="flex justify-end gap-1.5 px-4 pb-3">
      <BaseButton variant="secondary" size="sm" @click="emit('discard')">
        {{ tr('Discard') }}
      </BaseButton>
      <BaseButton variant="primary" size="sm" :disabled="!accepted.length || busy" @click="emit('apply', accepted)">
        {{ tr('Apply') }}
      </BaseButton>
    </div>
  </div>
</template>
