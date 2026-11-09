<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useStoryProject, useWorkspaceUi } from '@/app'
import { EXPORT_FORMATS, useProjectExport } from '@/composables/useProjectExport'
import {
  BookOpen,
  Download,
  FolderClosed,
  LayoutGrid,
  Palette,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shapes,
  Sparkles,
  Wand2,
} from 'lucide-vue-next'
import type { ExportFormat } from '@/app'
import { translatePhrase } from '@/i18n'

const props = defineProps<{ projectId: string | null }>()
const emit = defineEmits<{
  openProject: [id: string]
  newProject: []
}>()

const ui = useWorkspaceUi()
const projectStore = useStoryProject()
const router = useRouter()
const { exportFormat } = useProjectExport()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const project = computed(() => props.projectId ? projectStore.getProjectById(props.projectId) : projectStore.activeProject)
const open = computed(() => ui.commandMenu === 'palette')

interface Command {
  id: string
  label: string
  hint?: string
  icon: any
  run: () => void | Promise<void>
}

function goWorkspace() {
  if (project.value) void router.push(`/workspace/${project.value.id}`)
}

function command(name: string) {
  goWorkspace()
  ui.queueCommand(name)
}

const commands = computed<Command[]>(() => {
  const list: Command[] = [
    { id: 'new', label: 'New story', icon: Plus, run: () => emit('newProject') },
    { id: 'projects', label: 'All projects', icon: FolderClosed, run: () => { void router.push('/') } },
    { id: 'board', label: 'Corkboard', hint: translatePhrase('View'), icon: LayoutGrid, run: () => command('view:board') },
    { id: 'manuscript', label: 'Manuscript', hint: translatePhrase('View'), icon: PenLine, run: () => command('view:manuscript') },
    { id: 'story', label: 'Story bible', hint: translatePhrase('View'), icon: BookOpen, run: () => command('view:story') },
    { id: 'elements', label: 'Elements', hint: translatePhrase('View'), icon: Shapes, run: () => command('view:elements') },
    { id: 'plan-next', label: 'Plan next chapter', hint: translatePhrase('Action'), icon: Sparkles, run: () => command('plan-next') },
    { id: 'proofread', label: 'Proofread current chapter', hint: translatePhrase('Action'), icon: Search, run: () => command('proofread') },
    { id: 'polish', label: 'Polish current chapter', hint: translatePhrase('Action'), icon: Wand2, run: () => command('polish') },
    { id: 'sync-elements', label: 'Sync elements for current chapter', hint: translatePhrase('Action'), icon: RefreshCw, run: () => command('sync-elements') },
    { id: 'story-settings', label: 'Story settings', hint: translatePhrase('Action'), icon: Settings, run: () => command('story-settings') },
    { id: 'open-project', label: 'Open project workspace', hint: translatePhrase('Action'), icon: FolderClosed, run: () => goWorkspace() },
    { id: 'knowledge', label: 'Knowledge', icon: Search, run: () => ui.openDrawer('knowledge') },
    { id: 'styles', label: 'Writing styles', icon: Palette, run: () => ui.openDrawer('styles') },
    { id: 'models', label: 'Models', icon: Server, run: () => ui.openDrawer('models') },
    { id: 'settings', label: 'Settings', icon: Settings, run: () => ui.openDrawer('settings') },
  ]

  if (project.value) {
    for (const format of EXPORT_FORMATS) {
      list.push({
        id: `export-${format.id}`,
        label: `Export ${format.label}`,
        hint: project.value.name,
        icon: Download,
        run: () => exportFormat(project.value!, format.id as ExportFormat),
      })
    }
    for (const chapter of project.value.chapters) {
      list.push({
        id: `chapter-${chapter.id}`,
        label: `${chapter.index + 1}. ${chapter.title}`,
        hint: translatePhrase('Chapter'),
        icon: PenLine,
        run: () => {
          ui.workspaceChapterId = chapter.id
          ui.workspaceView = 'manuscript'
          goWorkspace()
        },
      })
    }
    for (const element of project.value.elements ?? []) {
      list.push({
        id: `element-${element.id}`,
        label: element.name,
        hint: `${translatePhrase('Element')} · ${translatePhrase(element.kind)}`,
        icon: Shapes,
        run: () => {
          ui.workspaceElementId = element.id
          ui.workspaceView = 'elements'
          goWorkspace()
        },
      })
    }
  }

  for (const item of projectStore.sortedProjects) {
    if (item.id === project.value?.id) continue
    list.push({
      id: `open-${item.id}`,
      label: item.name,
      hint: translatePhrase('Switch project'),
      icon: FolderClosed,
      run: () => emit('openProject', item.id),
    })
  }

  return list
})

const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return commands.value
  return commands.value.filter(item => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(term))
})

function close() {
  ui.commandMenu = null
}

async function run(command: Command) {
  close()
  await command.run()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1)
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  }
  if (event.key === 'Enter' && filtered.value[activeIndex.value]) {
    void run(filtered.value[activeIndex.value])
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const typing = target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    ui.commandMenu = open.value ? null : 'palette'
  } else if (event.key === '/' && !typing) {
    event.preventDefault()
    ui.commandMenu = 'palette'
  }
}

watch(open, value => {
  if (value) {
    query.value = ''
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  }
})

watch(query, () => { activeIndex.value = 0 })

onMounted(() => document.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="backdrop">
      <div
        v-if="open"
        class="fixed inset-0 z-[150] flex items-start justify-center bg-black/20 px-4 pt-[12vh] backdrop-blur-sm"
        @mousedown.self="close"
      >
        <div class="w-full max-w-xl overflow-hidden rounded-ios-lg bg-surface-1 shadow-ios-lg" @keydown="onKeydown">
          <div class="flex items-center gap-3 px-5 py-4">
            <Search :size="18" class="text-text-muted" />
            <input
              ref="inputRef"
              v-model="query"
              class="min-w-0 flex-1 bg-transparent text-body text-text-primary outline-none placeholder:text-text-muted"
              :placeholder="ui.text('Jump to a chapter, element, view, drawer, or action')"
            >
          </div>

          <div class="max-h-[52vh] overflow-y-auto px-5 pb-5 pt-4">
            <button
              v-for="(item, index) in filtered"
              :key="item.id"
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-full px-4 text-left transition-colors"
              :class="index === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2/70'"
              @mouseenter="activeIndex = index"
              @click="run(item)"
            >
              <component :is="item.icon" :size="17" class="shrink-0 text-text-secondary" />
              <span class="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">{{ ui.text(item.label) }}</span>
              <span v-if="item.hint" class="shrink-0 truncate text-meta text-text-muted">{{ ui.text(item.hint) }}</span>
            </button>
            <p v-if="!filtered.length" class="px-4 py-6 text-center text-caption text-text-muted">{{ ui.text('No matches') }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
