<script setup lang="ts">
import { computed } from 'vue'
import { Check, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import { translatePhrase } from '@/i18n'

const props = defineProps<{
  original: string
  revised: string
  kind: 'rewrite' | 'append'
  label?: string
  busy?: boolean
}>()

const emit = defineEmits<{ accept: []; discard: [] }>()
const tr = translatePhrase

function commonEdge(a: string, b: string, edge: 'start' | 'end') {
  let length = 0
  const max = Math.min(a.length, b.length)
  while (length < max) {
    const ai = edge === 'start' ? length : a.length - 1 - length
    const bi = edge === 'start' ? length : b.length - 1 - length
    if (a[ai] !== b[bi]) break
    length++
  }
  return a.slice(0, length)
}

const segments = computed(() => {
  if (props.kind === 'append') return { prefix: '', removed: '', added: props.revised, suffix: '' }
  const prefix = commonEdge(props.original, props.revised, 'start')
  const suffix = commonEdge(
    props.original.slice(prefix.length),
    props.revised.slice(prefix.length),
    'end',
  )
  return {
    prefix,
    removed: props.original.slice(prefix.length, props.original.length - suffix.length),
    added: props.revised.slice(prefix.length, props.revised.length - suffix.length),
    suffix,
  }
})

const changedChars = computed(() => segments.value.added.length + segments.value.removed.length)
</script>

<template>
  <div class="overflow-hidden rounded-ios bg-surface-1 shadow-ios-pill">
    <div class="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
      <div class="min-w-0">
        <p class="text-caption font-semibold text-text-primary">{{ tr(label || (kind === 'append' ? 'Continuation' : 'Rewritten passage')) }}</p>
        <p class="text-meta text-text-muted">{{ changedChars }} {{ tr('characters changed') }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <BaseButton variant="secondary" size="sm" :disabled="busy" @click="emit('discard')">
          <X :size="15" />
        </BaseButton>
        <button class="capsule h-9 gap-1 bg-accent-subtle px-3.5 text-caption text-accent disabled:opacity-40" :disabled="busy" @click="emit('accept')">
          <Check :size="15" />
          <span>{{ tr('Accept') }}</span>
        </button>
      </div>
    </div>

    <div class="max-h-[46vh] overflow-y-auto px-4 pb-4 pt-1">
      <p
        v-if="kind === 'rewrite' && segments.removed"
        class="mb-2 whitespace-pre-wrap rounded-ios bg-danger-subtle px-3 py-2 text-caption leading-relaxed text-text-secondary line-through decoration-danger/50"
      >
        {{ segments.removed }}
      </p>
      <p class="whitespace-pre-wrap rounded-ios bg-accent-subtle px-3 py-2 text-caption leading-relaxed text-text-primary">
        <template v-if="kind === 'rewrite'">
          {{ segments.prefix }}<span class="font-medium text-accent">{{ segments.added }}</span>{{ segments.suffix }}
        </template>
        <template v-else>{{ segments.added }}</template>
      </p>
    </div>
  </div>
</template>
