<script setup lang="ts">
import { computed } from 'vue'
import { Check, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import { translatePhrase } from '@/i18n'

const props = defineProps<{
  original: string
  revised: string
  kind: 'rewrite' | 'append'
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
</script>

<template>
  <div class="rounded-2xl border border-accent/25 bg-surface-1 p-3">
    <p
      v-if="kind === 'rewrite' && segments.removed"
      class="mb-2 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-muted line-through decoration-danger/60"
    >
      {{ segments.removed }}
    </p>
    <p class="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-primary">
      <template v-if="kind === 'rewrite'">{{ segments.prefix }}<span class="text-accent">{{ segments.added }}</span>{{ segments.suffix }}</template>
      <template v-else><span class="text-accent">{{ revised }}</span></template>
    </p>
    <div class="mt-2 flex items-center justify-end gap-1.5">
      <BaseButton variant="ghost" size="sm" :disabled="busy" @click="emit('discard')">
        <X :size="13" />
      </BaseButton>
      <BaseButton variant="primary" size="sm" :loading="busy" @click="emit('accept')">
        <Check :size="13" />
        <span>{{ tr('Accept') }}</span>
      </BaseButton>
    </div>
  </div>
</template>
