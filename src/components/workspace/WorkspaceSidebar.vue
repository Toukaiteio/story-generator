<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import {
  FileText,
  Users,
  BookOpen,
  List,
  ChevronRight,
  ChevronDown,
  Settings,
  Wand2,
} from 'lucide-vue-next'
import { ref } from 'vue'
import ProjectStats from './ProjectStats.vue'
import ChapterProgress from './ChapterProgress.vue'
import CharacterOverview from './CharacterOverview.vue'

const projectStore = useProjectStore()
const ui = useUiStore()

const project = computed(() => projectStore.activeProject)

const expandedSections = ref<Set<string>>(new Set(['generation', 'outline', 'chapters', 'characters']))

function toggleSection(section: string) {
  if (expandedSections.value.has(section)) {
    expandedSections.value.delete(section)
  } else {
    expandedSections.value.add(section)
  }
}

interface TreeNode {
  id: string
  label: string
  icon: any
  section?: string
  children?: TreeNode[]
}

const tree = computed<TreeNode[]>(() => {
  if (!project.value) return []

  return [
    {
      id: 'config',
      label: 'Story Configuration',
      icon: Settings,
    },
    {
      id: 'generation-section',
      label: 'Generation Flow',
      icon: Wand2,
      section: 'generation',
      children: [
        { id: 'generation-planning', label: 'Story Planning', icon: List },
        { id: 'generation-chapter-outline', label: 'Chapter Plan', icon: FileText },
        { id: 'generation-writing', label: 'Writing', icon: FileText },
        { id: 'generation-proofreading', label: 'Proofreading', icon: FileText },
        { id: 'generation-polishing', label: 'Polishing', icon: FileText },
      ],
    },
    {
      id: 'outline-section',
      label: 'Outline',
      icon: List,
      section: 'outline',
      children: project.value.outline
        ? [{ id: 'outline', label: 'Story Outline', icon: FileText }]
        : [],
    },
    {
      id: 'chapters-section',
      label: `Chapters (${project.value.chapters.length})`,
      icon: BookOpen,
      section: 'chapters',
      children: project.value.chapters.map(ch => ({
        id: `chapter-${ch.id}`,
        label: `Ch ${ch.index + 1}: ${ch.title}`,
        icon: FileText,
      })),
    },
    {
      id: 'characters-section',
      label: `Characters (${project.value.characters.length})`,
      icon: Users,
      section: 'characters',
      children: project.value.characters.map(c => ({
        id: `character-${c.id}`,
        label: c.name,
        icon: Users,
      })),
    },
  ]
})

function handleNodeClick(node: TreeNode) {
  if (node.section) {
    toggleSection(node.section)
  } else {
    ui.setWorkspaceNode(node.id)
  }
}
</script>

<template>
  <div class="h-full flex flex-col bg-surface-1 border-r border-surface-4 overflow-hidden">
    <div class="px-3 py-3 border-b border-surface-4 shrink-0">
      <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        {{ project?.name || 'Project' }}
      </h3>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      <div v-for="node in tree" :key="node.id">
        <button
          :class="[
            'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors duration-100',
            node.section
              ? 'text-text-secondary hover:text-text-primary font-medium'
              : ui.activeWorkspaceNode === node.id
                ? 'bg-accent-subtle text-accent'
                : 'text-text-primary hover:bg-surface-3',
          ]"
          @click="handleNodeClick(node)"
        >
          <ChevronDown
            v-if="node.section"
            :size="12"
            :class="[
              'shrink-0 transition-transform duration-100 text-text-muted',
              expandedSections.has(node.section) ? '' : '-rotate-90',
            ]"
          />
          <component :is="node.icon" :size="14" class="shrink-0" />
          <span class="truncate text-xs">{{ node.label }}</span>
        </button>

        <Transition name="fade">
          <div v-if="!node.section || expandedSections.has(node.section)">
            <div v-for="child in node.children" :key="child.id">
              <button
                :class="[
                  'flex items-center gap-2 w-full pl-8 pr-3 py-1.5 text-xs text-left transition-colors duration-100',
                  ui.activeWorkspaceNode === child.id
                    ? 'bg-accent-subtle text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-3',
                ]"
                @click="ui.setWorkspaceNode(child.id)"
              >
                <component :is="child.icon" :size="12" class="shrink-0" />
                <span class="truncate">{{ child.label }}</span>
              </button>
            </div>
          </div>
        </Transition>
      </div>

      <div v-if="!project" class="px-3 py-6 text-center">
        <p class="text-xs text-text-muted">No project loaded</p>
      </div>
    </div>

    <!-- Project Stats & Progress -->
    <div v-if="project" class="shrink-0 border-t border-surface-4 p-3 space-y-4 overflow-y-auto max-h-[50%]">
      <ProjectStats />
      <ChapterProgress />
      <CharacterOverview />
    </div>
  </div>
</template>
