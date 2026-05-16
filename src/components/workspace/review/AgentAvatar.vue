<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  size?: number
  colorSeed?: string
}>(), {
  size: 20,
})

const palette = [
  'bg-accent text-white',
  'bg-success text-white',
  'bg-warning text-white',
  'bg-danger text-white',
  'bg-blue-500 text-white',
  'bg-violet-500 text-white',
  'bg-emerald-500 text-white',
  'bg-amber-500 text-white',
  'bg-rose-500 text-white',
  'bg-cyan-500 text-white',
]

const initial = computed(() => {
  const parts = props.name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return props.name.slice(0, 2).toUpperCase()
})

const colorClass = computed(() => {
  const seed = props.colorSeed || props.name
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  return palette[Math.abs(hash) % palette.length]
})

const pxSize = computed(() => `${props.size}px`)
const fontSize = computed(() => `${Math.max(8, Math.round(props.size * 0.45))}px`)
</script>

<template>
  <div
    class="flex shrink-0 items-center justify-center rounded-md font-bold uppercase tracking-tight"
    :class="colorClass"
    :style="{ width: pxSize, height: pxSize, fontSize }"
    :title="name"
  >
    {{ initial }}
  </div>
</template>
