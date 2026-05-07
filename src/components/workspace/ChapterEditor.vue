<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useToast } from '@/composables/useToast'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { Save, Eye, EyeOff, FileText, Type } from 'lucide-vue-next'

const props = defineProps<{
  chapterId: string
}>()

const projectStore = useProjectStore()
const toast = useToast()

const chapter = computed(() => {
  const project = projectStore.activeProject
  if (!project) return null
  return project.chapters.find(ch => ch.id === props.chapterId) ?? null
})

const title = ref('')
const content = ref('')
const showVersions = ref(false)

watch(chapter, (ch) => {
  if (ch) {
    title.value = ch.title || ''
    content.value = ch.content || ''
  }
}, { immediate: true })

async function save() {
  if (!chapter.value || !projectStore.activeProject) return
  const chapters = projectStore.activeProject.chapters.map(ch =>
    ch.id === props.chapterId ? { ...ch, title: title.value, content: content.value } : ch
  )
  const saved = await projectStore.updateProject(projectStore.activeProject.id, { chapters })
  if (!saved) {
    toast.error('Failed to save chapter')
    return
  }
  toast.success('Chapter saved')
}

const statusVariant = computed(() => {
  const map: Record<string, string> = {
    outline: 'default',
    writing: 'warning',
    draft: 'default',
    proofreading: 'warning',
    proofread: 'accent',
    polishing: 'warning',
    polished: 'success',
  }
  return (map[chapter.value?.status ?? ''] ?? 'default') as any
})

const wordCount = computed(() => {
  const text = content.value || ''
  return text.trim() ? text.trim().split(/\s+/).length : 0
})
</script>

<template>
  <div v-if="chapter" class="h-full flex flex-col overflow-hidden bg-surface-0">
    <!-- Header Toolbar -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center justify-between px-6 py-5 border-b border-surface-4 shrink-0 bg-surface-1 shadow-sm">
      <div class="flex items-center gap-4 flex-1 min-w-0">
        <div class="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center border border-surface-3 shrink-0 shadow-sm">
          <FileText :size="22" class="text-accent" />
        </div>
        <div class="flex-1 flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-3">
            <span class="text-xs font-semibold text-text-muted uppercase tracking-wider">Chapter {{ chapter.index + 1 }}</span>
            <BaseTag :variant="statusVariant" size="sm" class="uppercase tracking-wider font-semibold text-[10px] px-2">{{ chapter.status }}</BaseTag>
          </div>
          <input 
            v-model="title" 
            class="text-xl font-bold text-text-primary bg-transparent outline-none placeholder:text-text-muted/50 truncate w-full transition-colors focus:text-accent"
            placeholder="Enter Chapter Title..."
          />
        </div>
      </div>

      <div class="flex items-center gap-3 shrink-0 sm:ml-4">
        <div class="px-2.5 py-1.5 rounded-md bg-surface-2 border border-surface-3 text-xs text-text-secondary flex items-center gap-1.5 hidden md:flex">
          <Type :size="14" class="text-text-muted" />
          <span class="text-text-muted">Words:</span>
          <span class="text-text-primary font-medium">{{ wordCount }}</span>
        </div>
        <BaseButton variant="secondary" size="md" @click="showVersions = !showVersions" class="hover:border-surface-4">
          <Eye v-if="!showVersions" :size="16" />
          <EyeOff v-else :size="16" />
          <span>{{ showVersions ? 'Editor' : 'Versions' }}</span>
        </BaseButton>
        <BaseButton variant="primary" size="md" @click="save">
          <Save :size="16" />
          <span>Save Changes</span>
        </BaseButton>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 overflow-y-auto bg-surface-0">
      <div v-if="!showVersions" class="max-w-3xl mx-auto px-8 py-10 h-full flex flex-col">
        <textarea
          v-model="content"
          class="w-full flex-1 min-h-[60vh] bg-transparent text-text-primary resize-none outline-none placeholder:text-text-muted/40 font-serif selection:bg-accent/30 selection:text-text-primary"
          placeholder="Start writing your chapter here..."
          style="font-size: 1.125rem; line-height: 1.8; letter-spacing: 0.01em;"
        />
      </div>

      <div v-else class="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div v-if="chapter.content" class="space-y-3">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">Draft</h3>
            <div class="h-px flex-1 bg-surface-4"></div>
          </div>
          <div class="rounded-xl border border-surface-4 bg-surface-2 p-6 text-sm text-text-primary whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto font-serif shadow-sm">
            {{ chapter.content }}
          </div>
        </div>
        <div v-if="chapter.proofreadContent" class="space-y-3">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">Proofread</h3>
            <div class="h-px flex-1 bg-surface-4"></div>
          </div>
          <div class="rounded-xl border border-surface-4 bg-surface-2 p-6 text-sm text-text-primary whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto font-serif shadow-sm">
            {{ chapter.proofreadContent }}
          </div>
        </div>
        <div v-if="chapter.polishedContent" class="space-y-3">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">Polished</h3>
            <div class="h-px flex-1 bg-surface-4"></div>
          </div>
          <div class="rounded-xl border border-surface-4 bg-surface-2 p-6 text-sm text-text-primary whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto font-serif shadow-sm">
            {{ chapter.polishedContent }}
          </div>
        </div>
        <div v-if="!chapter.content && !chapter.proofreadContent && !chapter.polishedContent" class="h-[40vh] flex flex-col items-center justify-center text-center">
          <div class="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-4 border border-surface-3">
            <FileText :size="24" class="text-text-muted" />
          </div>
          <p class="text-base font-medium text-text-primary">No content generated yet</p>
          <p class="text-sm text-text-secondary mt-1 max-w-sm">Use the generation tools or write directly in the editor to create content for this chapter.</p>
        </div>
      </div>
    </div>
  </div>
</template>
