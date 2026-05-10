<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Save, User, Heart, Target, Trash2, ArrowLeftRight, CalendarDays, Fingerprint } from 'lucide-vue-next'

const props = defineProps<{
  characterId: string
}>()

const projectStore = useProjectStore()
const ui = useUiStore()
const toast = useToast()
const showDeleteConfirm = ref(false)

const character = computed(() => {
  const project = projectStore.activeProject
  if (!project) return null
  return project.characters.find(c => c.id === props.characterId) ?? null
})

const form = ref({
  name: '',
  role: 'supporting' as string,
  personality: '',
  appearance: '',
  backstory: '',
  motivation: '',
  goals: '',
  conflicts: '',
  currentState: '',
})

const roleVariant = computed(() => {
  if (form.value.role === 'protagonist') return 'accent'
  if (form.value.role === 'antagonist') return 'danger'
  if (form.value.role === 'supporting') return 'success'
  return 'default'
})

const metaInfo = computed(() => {
  if (!character.value) return []
  return [
    { label: 'Created', value: new Date(character.value.createdAt).toLocaleDateString() },
    { label: 'Updated', value: new Date(character.value.updatedAt).toLocaleDateString() },
    { label: 'Relations', value: `${character.value.relations.length}` },
  ]
})

watch(character, (c) => {
  if (c) {
    form.value = {
      name: c.name,
      role: c.role,
      personality: c.personality.join(', '),
      appearance: c.appearance,
      backstory: c.backstory,
      motivation: c.motivation,
      goals: c.goals,
      conflicts: c.conflicts,
      currentState: c.currentState,
    }
  }
}, { immediate: true })

const roleOptions = [
  { label: 'Protagonist', value: 'protagonist' },
  { label: 'Antagonist', value: 'antagonist' },
  { label: 'Supporting', value: 'supporting' },
  { label: 'Minor', value: 'minor' },
]

async function save() {
  if (!character.value || !projectStore.activeProject) return
  const characters = projectStore.activeProject.characters.map(c =>
    c.id === props.characterId
      ? {
          ...c,
          name: form.value.name,
          role: form.value.role as any,
          personality: form.value.personality.split(',').map(s => s.trim()).filter(Boolean),
          appearance: form.value.appearance,
          backstory: form.value.backstory,
          motivation: form.value.motivation,
          goals: form.value.goals,
          conflicts: form.value.conflicts,
          currentState: form.value.currentState,
          updatedAt: new Date().toISOString(),
        }
      : c
  )
  const saved = await projectStore.updateProject(projectStore.activeProject.id, { characters })
  if (!saved) {
    toast.error('Failed to save character')
    return
  }
  toast.success('Character saved')
}

function requestDelete() {
  showDeleteConfirm.value = true
}

async function deleteCharacter() {
  if (!character.value || !projectStore.activeProject) return

  const remaining = projectStore.activeProject.characters
    .filter(c => c.id !== props.characterId)
    .map(c => ({
      ...c,
      relations: c.relations.filter(rel => rel.targetId !== props.characterId),
      updatedAt: c.id === props.characterId ? c.updatedAt : new Date().toISOString(),
    }))

  const saved = await projectStore.updateProject(projectStore.activeProject.id, {
    characters: remaining,
  })
  if (!saved) {
    toast.error('Failed to delete character')
    return
  }

  ui.setWorkspaceNode(remaining[0] ? `character-${remaining[0].id}` : 'config')
  toast.warning(`Character "${character.value.name}" deleted`)
}
</script>

<template>
  <div v-if="character" class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto px-6 py-8">
      
      <!-- Top Header Area -->
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between mb-8 pb-6 border-b border-surface-4">
        <div class="flex items-start gap-5">
          <div class="w-16 h-16 rounded-2xl bg-surface-3 flex items-center justify-center shrink-0 border border-surface-4 shadow-sm">
            <User :size="28" class="text-text-secondary" />
          </div>
          <div class="space-y-3 pt-1">
            <div class="space-y-1">
              <div class="flex items-center gap-3 flex-wrap">
                <h2 class="text-2xl font-bold text-text-primary tracking-tight">{{ form.name || character.name }}</h2>
                <BaseTag :variant="roleVariant" size="sm" class="uppercase tracking-wider font-semibold text-[10px] px-2">{{ form.role }}</BaseTag>
              </div>
              <p class="text-sm text-text-secondary max-w-2xl leading-relaxed">
                {{ ui.text("Define the character's core identity, physical traits, emotional drivers, and interpersonal relationships.") }}
              </p>
            </div>

            <div class="flex flex-wrap gap-2">
              <div
                v-for="item in metaInfo"
                :key="item.label"
                class="px-2.5 py-1 rounded-md bg-surface-2 border border-surface-3 text-xs text-text-secondary flex items-center gap-1.5"
              >
                <CalendarDays :size="12" class="text-text-muted" />
                <span class="text-text-muted">{{ ui.text(item.label) }}:</span>
                <span class="text-text-primary font-medium">{{ item.value }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <BaseButton variant="secondary" size="md" @click="requestDelete" class="!text-danger hover:!bg-danger-subtle hover:!border-danger/30">
            <Trash2 :size="16" />
            <span>{{ ui.text('Delete') }}</span>
          </BaseButton>
          <BaseButton variant="primary" size="md" @click="save">
            <Save :size="16" />
            <span>{{ ui.text('Save Changes') }}</span>
          </BaseButton>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div class="lg:col-span-8 space-y-6">
          <BaseCard class="!p-6 !bg-surface-1 border-surface-3 shadow-sm hover:border-surface-4 transition-colors">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center border border-surface-3">
                <Fingerprint :size="18" class="text-accent" />
              </div>
              <div>
                <h3 class="text-base font-semibold text-text-primary">{{ ui.text('Core Identity') }}</h3>
                <p class="text-xs text-text-secondary">{{ ui.text('Name, role, and personality traits.') }}</p>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <BaseInput v-model="form.name" label="Name" placeholder="e.g. John Doe" />
              <BaseSelect v-model="form.role" label="Role" :options="roleOptions" />
            </div>

            <div class="mt-5">
              <BaseTextarea
                v-model="form.personality"
                label="Personality Traits"
                placeholder="Comma-separated: brave, loyal, cautious, introverted..."
                :rows="2"
                :auto-resize="true"
              />
            </div>
          </BaseCard>

          <BaseCard class="!p-6 !bg-surface-1 border-surface-3 shadow-sm hover:border-surface-4 transition-colors">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center border border-surface-3">
                <Heart :size="18" class="text-success" />
              </div>
              <div>
                <h3 class="text-base font-semibold text-text-primary">{{ ui.text('Physical & Past') }}</h3>
                <p class="text-xs text-text-secondary">{{ ui.text('Concrete details for consistent generation.') }}</p>
              </div>
            </div>

            <div class="space-y-5">
              <BaseTextarea v-model="form.appearance" label="Appearance" :rows="3" :auto-resize="true" placeholder="Physical description, clothing style, mannerisms..." />
              <BaseTextarea v-model="form.backstory" label="Backstory" :rows="4" :auto-resize="true" placeholder="Origin, formative events, key life moments..." />
            </div>
          </BaseCard>

          <BaseCard class="!p-6 !bg-surface-1 border-surface-3 shadow-sm hover:border-surface-4 transition-colors">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center border border-surface-3">
                <Target :size="18" class="text-warning" />
              </div>
              <div>
                <h3 class="text-base font-semibold text-text-primary">{{ ui.text('Motivation & Conflict') }}</h3>
                <p class="text-xs text-text-secondary">{{ ui.text('What drives them and what stands in their way.') }}</p>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <BaseTextarea v-model="form.motivation" label="Motivation" :rows="3" :auto-resize="true" placeholder="What inherently drives this character..." />
              <BaseTextarea v-model="form.goals" label="Goals" :rows="3" :auto-resize="true" placeholder="What are their current concrete objectives..." />
            </div>

            <div class="mt-5">
              <BaseTextarea v-model="form.conflicts" label="Conflicts" :rows="3" :auto-resize="true" placeholder="Internal struggles and external obstacles..." />
            </div>

            <div class="mt-5">
              <BaseTextarea v-model="form.currentState" label="Current State" :rows="2" :auto-resize="true" placeholder="Current situation, mood, or status in the narrative..." />
            </div>
          </BaseCard>
        </div>

        <div class="lg:col-span-4 space-y-6">
          <BaseCard class="!p-6 !bg-surface-1 border-surface-3 shadow-sm hover:border-surface-4 transition-colors">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center border border-surface-3">
                <ArrowLeftRight :size="18" class="text-accent" />
              </div>
              <div>
                <h3 class="text-base font-semibold text-text-primary">{{ ui.text('Relationships') }}</h3>
                <p class="text-xs text-text-secondary">{{ ui.text('Connections to others.') }}</p>
              </div>
            </div>

            <div v-if="character.relations.length" class="space-y-3">
              <div
                v-for="rel in character.relations"
                :key="rel.targetId"
                class="rounded-xl border border-surface-4 bg-surface-2 px-4 py-3.5 space-y-2.5 transition-colors hover:border-surface-5"
              >
                <div class="flex items-center justify-between gap-3">
                  <BaseTag size="sm" variant="accent" class="text-[10px] font-medium tracking-wide">{{ rel.relation }}</BaseTag>
                  <span class="text-xs text-text-muted truncate font-medium">{{ rel.targetId }}</span>
                </div>
                <p class="text-sm text-text-primary leading-relaxed">{{ rel.description }}</p>
              </div>
            </div>
            <div v-else class="rounded-xl border-2 border-dashed border-surface-4 bg-surface-2/50 px-4 py-8 flex flex-col items-center justify-center text-center">
              <div class="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center mb-3">
                <ArrowLeftRight :size="20" class="text-text-muted" />
              </div>
              <p class="text-sm font-medium text-text-primary">{{ ui.text('No relationships yet') }}</p>
              <p class="text-xs text-text-secondary mt-1">{{ ui.text('Interactions will appear here as the story evolves.') }}</p>
            </div>
          </BaseCard>

          <BaseCard class="!p-6 !bg-danger-subtle/30 border-danger/20 shadow-sm">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-lg bg-danger-subtle flex items-center justify-center border border-danger/20">
                <Trash2 :size="18" class="text-danger" />
              </div>
              <div>
                <h3 class="text-base font-semibold text-text-primary">{{ ui.text('Danger Zone') }}</h3>
                <p class="text-xs text-danger/80">{{ ui.text('Irreversible actions.') }}</p>
              </div>
            </div>

            <p class="text-sm text-text-secondary leading-relaxed mb-5">
              {{ ui.text('Permanently delete this character from the project. All related references in other characters will be cleaned up.') }}
            </p>
            
            <BaseButton variant="danger" class="w-full justify-center" @click="requestDelete">
              <Trash2 :size="16" />
              <span>{{ ui.text('Delete Character') }}</span>
            </BaseButton>
          </BaseCard>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      :title="ui.text('Delete Character')"
      :message="ui.text('This will remove the character from the project and clean up any relationships that point to it. This action cannot be undone.')"
      :confirm-text="ui.text('Delete')"
      :cancel-text="ui.text('Cancel')"
      variant="danger"
      @confirm="deleteCharacter"
    />
  </div>
</template>
