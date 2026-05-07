<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { User, Shield, Users, UserCircle } from 'lucide-vue-next'

const projectStore = useProjectStore()
const ui = useUiStore()
const project = computed(() => projectStore.activeProject)

const characters = computed(() => {
  const p = project.value
  if (!p) return []
  return p.characters.map(c => ({
    id: c.id,
    name: c.name,
    role: c.role,
    traits: c.personality.slice(0, 3),
    relationCount: c.relations.length,
  }))
})

const roleGroups = computed(() => {
  const groups: Record<string, typeof characters.value> = {}
  for (const char of characters.value) {
    if (!groups[char.role]) groups[char.role] = []
    groups[char.role].push(char)
  }
  return groups
})

function navigateToCharacter(characterId: string) {
  ui.setWorkspaceNode(`character-${characterId}`)
}

function roleIcon(role: string) {
  switch (role) {
    case 'protagonist': return User
    case 'antagonist': return Shield
    default: return UserCircle
  }
}

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
</script>

<template>
  <div v-if="project && characters.length" class="space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-medium text-text-secondary uppercase tracking-wider">Characters</h3>
      <span class="text-2xs text-text-muted">{{ characters.length }} total</span>
    </div>

    <div v-for="(chars, role) in roleGroups" :key="role" class="space-y-1">
      <div class="flex items-center gap-1.5 mb-1">
        <component :is="roleIcon(role)" :size="10" class="text-text-muted" />
        <span class="text-2xs text-text-muted uppercase tracking-wider">{{ roleLabel(role) }}</span>
      </div>

      <button
        v-for="char in chars"
        :key="char.id"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-surface-3 transition-colors"
        @click="navigateToCharacter(char.id)"
      >
        <div class="w-5 h-5 rounded-full bg-surface-4 flex items-center justify-center text-2xs text-text-muted">
          {{ char.name.charAt(0) }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-text-primary truncate">{{ char.name }}</div>
          <div v-if="char.traits.length" class="text-2xs text-text-muted truncate">
            {{ char.traits.join(', ') }}
          </div>
        </div>
        <span v-if="char.relationCount" class="text-2xs text-text-muted">
          {{ char.relationCount }} rel
        </span>
      </button>
    </div>
  </div>
</template>