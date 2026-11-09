<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStoryProject, useWorkspaceUi } from '@/app'
import { ChevronDown, FolderClosed, Search, Plus, LayoutGrid, Minus, Square, X } from 'lucide-vue-next'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AppLogo from '@/components/layout/AppLogo.vue'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{
  openProject: [id: string]
  newProject: []
  openHome: []
}>()

const ui = useWorkspaceUi()
const projectStore = useStoryProject()
const route = useRoute()
const router = useRouter()

const project = computed(() => projectStore.getProjectById(props.projectId) ?? projectStore.activeProject)
const chapterCount = computed(() => project.value?.chapters.length ?? 0)
const isWorkspace = computed(() => route.path.startsWith('/workspace'))

// Collapse the brand and project count once the window is too narrow for one row.
const compact = ref(false)
function syncCompact() {
  compact.value = window.innerWidth < 760
}
onMounted(() => {
  syncCompact()
  window.addEventListener('resize', syncCompact)
})
onBeforeUnmount(() => window.removeEventListener('resize', syncCompact))

const projectItems = computed(() => [
  ...projectStore.sortedProjects.map(item => ({
    label: item.name,
    icon: FolderClosed,
    action: () => emit('openProject', item.id),
  })),
  { divider: true },
  { label: 'New story', icon: Plus, action: () => emit('newProject') },
  { label: 'All projects', icon: LayoutGrid, action: () => emit('openHome') },
])

function minimize() {
  window.electronAPI?.window.minimize()
}

function maximize() {
  window.electronAPI?.window.maximize()
}

function close() {
  window.electronAPI?.window.close()
}

function goWorkspace() {
  if (project.value) void router.push(`/workspace/${project.value.id}`)
}
</script>

<template>
  <header class="drag-region flex h-14 shrink-0 select-none items-center gap-2 bg-surface-0 px-3">
    <button class="no-drag flex items-center gap-2.5 rounded-full pr-2" @click="emit('openHome')">
      <AppLogo :size="30" />
      <span v-if="!compact" class="text-body font-semibold text-text-primary">Story Generator</span>
    </button>

    <div class="no-drag flex min-w-0 flex-1 items-center justify-center gap-2">
      <BaseDropdown :items="projectItems" :width="240">
        <template #trigger>
          <div class="capsule capsule--active h-10 max-w-[340px] gap-2 px-4">
            <FolderClosed :size="17" class="shrink-0 text-accent" />
            <span class="truncate">{{ project?.name || 'No project' }}</span>
            <ChevronDown :size="15" class="shrink-0 text-text-muted" />
          </div>
        </template>
      </BaseDropdown>

      <button
        v-if="project && !isWorkspace"
        class="capsule h-10 gap-1.5 bg-surface-2 px-4"
        @click="goWorkspace"
      >
        <span v-if="!compact">{{ chapterCount }} {{ ui.text('Chapters') }}</span>
        <span v-else>{{ chapterCount }}</span>
      </button>

      <BaseButton
        variant="ghost"
        size="sm"
        :aria-label="ui.text('Command palette')"
        @click="ui.commandMenu = 'palette'"
      >
        <Search :size="17" />
      </BaseButton>
    </div>

    <div class="no-drag flex items-center gap-0.5">
      <button class="app-icon-button" @click="minimize">
        <Minus :size="16" />
      </button>
      <button class="app-icon-button" @click="maximize">
        <Square :size="13" />
      </button>
      <button class="app-icon-button app-icon-button--danger" @click="close">
        <X :size="16" />
      </button>
    </div>
  </header>
</template>
