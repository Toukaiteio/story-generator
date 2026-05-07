<script setup lang="ts">
import type { Character } from '@/types/character'
import { User } from 'lucide-vue-next'
import BaseTag from '@/components/ui/BaseTag.vue'

const props = defineProps<{
  character: Character
  active?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const roleVariant: Record<string, string> = {
  protagonist: 'accent',
  antagonist: 'danger',
  supporting: 'success',
  minor: 'default',
}
</script>

<template>
  <button
    :class="[
      'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-all duration-100',
      active
        ? 'bg-accent-subtle border border-accent/30'
        : 'hover:bg-surface-3 border border-transparent',
    ]"
    @click="emit('select', character.id)"
  >
    <div class="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center shrink-0">
      <User :size="14" class="text-text-muted" />
    </div>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-text-primary truncate">{{ character.name }}</p>
      <p class="text-xs text-text-muted truncate">{{ character.motivation }}</p>
    </div>
    <BaseTag :variant="(roleVariant[character.role] as any) ?? 'default'" size="sm">
      {{ character.role }}
    </BaseTag>
  </button>
</template>
