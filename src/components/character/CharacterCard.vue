<script setup lang="ts">
import type { Character } from '@/types/character'
import { UserRound } from 'lucide-vue-next'
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
      'flex min-h-11 w-full items-center gap-3 rounded-full px-3 py-2 text-left transition-colors',
      active ? 'bg-accent-subtle ring-2 ring-inset ring-accent/30' : 'hover:bg-surface-2',
    ]"
    @click="emit('select', character.id)"
  >
    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
      <UserRound :size="16" class="text-text-secondary" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-caption font-medium text-text-primary">{{ character.name }}</span>
      <span class="block truncate text-meta text-text-muted">{{ character.motivation }}</span>
    </span>
    <BaseTag :variant="(roleVariant[character.role] as any) ?? 'default'" size="sm">
      {{ character.role }}
    </BaseTag>
  </button>
</template>
