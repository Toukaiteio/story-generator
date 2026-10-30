<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Settings2 } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { useStoryProject, useWritingStyleLibrary, countWords, buildWritingStyleSnapshot } from '@/app'
import { translatePhrase } from '@/i18n'

const tr = translatePhrase

const projectStore = useStoryProject()
const writingStyles = useWritingStyleLibrary()

const project = computed(() => projectStore.activeProject)
const outline = ref('')
const savedOutline = ref('')
const showConfig = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(project, value => {
  outline.value = value?.outline ?? ''
  savedOutline.value = outline.value
}, { immediate: true })

watch(outline, () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveOutline(), 900)
})

async function saveOutline() {
  if (!project.value || outline.value === project.value.outline) return
  await projectStore.updateProject(project.value.id, { outline: outline.value })
  savedOutline.value = outline.value
}

const config = reactive({
  genre: '',
  chapterCount: 8,
  writingFormat: 'plaintext' as 'plaintext' | 'markdown',
  language: 'English',
  styleId: 'default',
})

watch(project, value => {
  if (!value) return
  config.genre = value.genre
  config.chapterCount = value.chapterConfig?.maxChapters ?? value.chapterCount ?? 8
  config.writingFormat = value.writingFormat ?? 'plaintext'
  config.language = value.language || 'English'
  config.styleId = value.styleId || 'default'
}, { immediate: true })

async function saveConfig() {
  if (!project.value) return
  const style = writingStyles.getStyleById(config.styleId)
  const resolvedStyle = writingStyles.resolveStyleContent(config.styleId) || project.value.style
  await projectStore.updateProject(project.value.id, {
    genre: config.genre,
    chapterCount: config.chapterCount,
    chapterConfig: { maxChapters: config.chapterCount },
    writingFormat: config.writingFormat,
    language: config.language,
    styleId: config.styleId,
    style: resolvedStyle,
    writingStyleSnapshot: buildWritingStyleSnapshot(style, resolvedStyle),
  })
  showConfig.value = false
}

const styleOptions = computed(() => [
  { label: tr('Default'), value: 'default' },
  ...writingStyles.styles.map(style => ({ label: style.name, value: style.id })),
])

const chapterCountOptions = [4, 8, 12, 16, 24, 32].map(count => ({ label: String(count), value: String(count) }))
const genreOptions = ['fantasy', 'sci-fi', 'romance', 'mystery', 'thriller', 'historical', 'literary', 'horror', 'adventure']
  .map(genre => ({ label: genre, value: genre }))

const outlineDirty = computed(() => outline.value !== savedOutline.value)
</script>

<template>
  <div v-if="project" class="h-full overflow-y-auto">
    <div class="mx-auto max-w-3xl px-6 py-6">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="truncate text-xl font-bold text-text-primary">{{ project.name }}</h1>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <BaseTag size="sm" variant="accent">{{ project.genre || tr('Unset genre') }}</BaseTag>
            <BaseTag size="sm">{{ (project.chapterConfig?.maxChapters ?? project.chapterCount) }} {{ tr('chapters') }}</BaseTag>
            <BaseTag size="sm">{{ project.writingFormat }}</BaseTag>
            <BaseTag size="sm">{{ project.language }}</BaseTag>
            <BaseTag size="sm">{{ countWords(outline) }} {{ tr('words') }}</BaseTag>
          </div>
        </div>
        <BaseButton variant="ghost" size="sm" @click="showConfig = !showConfig">
          <Settings2 :size="15" />
        </BaseButton>
      </div>

      <div v-if="showConfig" class="mt-4 grid gap-3 rounded-2xl border border-surface-4 bg-surface-1 p-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <BaseSelect v-model="config.genre" :options="genreOptions" />
          <BaseSelect v-model="config.styleId" :options="styleOptions" />
        </div>
        <div class="space-y-1.5">
          <BaseSelect
            :model-value="String(config.chapterCount)"
            :options="chapterCountOptions"
            @update:model-value="config.chapterCount = Number($event)"
          />
          <div class="flex items-center gap-2">
            <BaseSegmented
              :model-value="config.writingFormat"
              :options="[
                { label: tr('Plain text'), value: 'plaintext' },
                { label: 'Markdown', value: 'markdown' },
              ]"
              @update:model-value="config.writingFormat = $event as 'plaintext' | 'markdown'"
            />
            <BaseSegmented
              :model-value="config.language"
              :options="[
                { label: 'EN', value: 'English' },
                { label: '中文', value: '中文' },
              ]"
              @update:model-value="config.language = $event"
            />
          </div>
        </div>
        <div class="sm:col-span-2 flex justify-end">
          <BaseButton variant="primary" size="sm" @click="saveConfig">{{ tr('Save') }}</BaseButton>
        </div>
      </div>

      <section class="mt-5">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-2xs font-bold uppercase tracking-wider text-text-secondary">{{ tr('Story outline') }}</h2>
          <span v-if="outlineDirty" class="text-2xs text-accent">●</span>
        </div>
        <textarea
          v-model="outline"
          class="min-h-[420px] w-full resize-y rounded-2xl border border-surface-4 bg-surface-1 p-5 text-sm leading-7 text-text-primary outline-none transition-colors focus:border-accent/60"
          :placeholder="tr('Write the master outline. The copilot expands it on request.')"
        />
      </section>
    </div>
  </div>
</template>
