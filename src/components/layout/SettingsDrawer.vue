<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Database, Download, FolderOpen, Globe, RefreshCw, Wrench } from 'lucide-vue-next'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useModelCatalog } from '@/app'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { APP_VERSION } from '@/constants/version'
import { translatePhrase } from '@/i18n'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const tr = translatePhrase
const ui = useUiStore()
const catalog = useModelCatalog()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const updateStatus = ref<UpdaterStatus>({
  state: 'idle',
  message: 'Update status has not been loaded yet.',
})
const checking = ref(false)
const hasUpdater = ref(false)
let removeListener: (() => void) | null = null

onMounted(async () => {
  hasUpdater.value = Boolean(window.electronAPI?.updater)
  if (!hasUpdater.value || !window.electronAPI?.updater) return
  removeListener = window.electronAPI.updater.onStatus(status => {
    updateStatus.value = status
    checking.value = status.state === 'checking'
  })
  updateStatus.value = await window.electronAPI.updater.getStatus()
})

onBeforeUnmount(() => {
  removeListener?.()
  removeListener = null
})

const toolRoundPresets = [8, 16, 24, 32]
const rewindPresets = [0, 1, 3, 5]
const severityOptions = [
  { label: tr('Low'), value: 'low' },
  { label: tr('Medium'), value: 'medium' },
  { label: tr('High'), value: 'high' },
]

const promptDraft = ref(ui.customSystemPrompt)
const languages = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
]

function setLanguage(value: string) {
  ui.setLanguage(value as 'en' | 'zh')
}

async function checkUpdates() {
  if (!window.electronAPI?.updater) return
  checking.value = true
  try {
    updateStatus.value = await window.electronAPI.updater.check()
  } finally {
    checking.value = updateStatus.value.state === 'checking'
  }
}

async function installUpdate() {
  await window.electronAPI?.updater?.install()
}

async function browseStorage() {
  const path = await window.electronAPI?.dialog?.openDirectory?.({ title: tr('Default storage folder') })
  if (path) ui.setDefaultStoragePath(path)
}

function savePrompt() {
  ui.setCustomSystemPrompt(promptDraft.value)
  toast.success('Prompt prefix saved')
}
</script>

<template>
  <BaseDrawer v-model="open" :title="tr('Settings')" width="480px">
    <div class="space-y-4">
      <section>
        <p class="mb-2 flex items-center gap-1.5 text-meta font-medium text-text-muted">
          <Globe :size="14" />
          {{ tr('Language') }}
        </p>
        <BaseSegmented :model-value="ui.language" :options="languages" @update:model-value="setLanguage" />
      </section>

      <section>
        <p class="mb-2 flex items-center gap-1.5 text-meta font-medium text-text-muted">
          <Wrench :size="14" />
          {{ tr('Tool rounds before a checkpoint') }}
        </p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="rounds in toolRoundPresets"
            :key="rounds"
            class="capsule h-9 px-3.5 text-meta"
            :class="catalog.toolWorkflowSettings.maxToolCallRounds === rounds ? 'bg-accent-subtle text-accent' : 'bg-surface-2'"
            @click="catalog.setMaxToolCallRounds(rounds)"
          >
            {{ rounds }}
          </button>
        </div>
        <BaseSelect
          class="mt-2"
          :model-value="catalog.toolWorkflowSettings.minIssueSeverity"
          :options="severityOptions"
          :placeholder="tr('Minimum issue severity to polish')"
          @update:model-value="catalog.setMinIssueSeverity($event as any)"
        />
      </section>

      <section>
        <p class="mb-2 text-meta font-medium text-text-muted">{{ tr('Rewind points') }}</p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="points in rewindPresets"
            :key="points"
            class="capsule h-9 px-3.5 text-meta"
            :class="ui.vibeRewindPoints === points ? 'bg-accent-subtle text-accent' : 'bg-surface-2'"
            @click="ui.setVibeRewindPoints(points)"
          >
            {{ points }}
          </button>
        </div>
      </section>

      <section>
        <p class="mb-2 flex items-center gap-1.5 text-meta font-medium text-text-muted">
          <Database :size="14" />
          {{ tr('Default storage folder') }}
        </p>
        <div class="flex items-center gap-1.5">
          <span class="flex h-9 min-w-0 flex-1 items-center truncate rounded-full bg-surface-2 px-3.5 text-meta text-text-primary">
            {{ ui.defaultStoragePath || tr('Not set') }}
          </span>
          <BaseButton variant="secondary" size="sm" @click="browseStorage">
            <FolderOpen :size="14" />
            <span>{{ tr('Browse') }}</span>
          </BaseButton>
        </div>
      </section>

      <section>
        <p class="mb-2 flex items-center gap-1.5 text-meta font-medium text-text-muted">
          <Download :size="14" />
          {{ tr('Updates') }}
        </p>
        <div class="rounded-ios bg-surface-2 px-3.5 py-3">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-meta text-text-primary">{{ tr(updateStatus.message) }}</p>
              <p class="text-meta text-text-muted">{{ APP_VERSION }}<span v-if="updateStatus.version"> → {{ updateStatus.version }}</span></p>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <BaseButton variant="secondary" size="sm" :loading="checking" :disabled="checking || !hasUpdater" @click="checkUpdates">
                <RefreshCw :size="14" />
                <span>{{ tr('Check') }}</span>
              </BaseButton>
              <BaseButton v-if="updateStatus.state === 'downloaded'" variant="primary" size="sm" @click="installUpdate">
                {{ tr('Install') }}
              </BaseButton>
            </div>
          </div>
          <div v-if="updateStatus.state === 'downloading'" class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div class="h-full rounded-full bg-accent" :style="{ width: `${updateStatus.progress ?? 0}%` }" />
          </div>
        </div>
      </section>

      <section>
        <p class="mb-2 text-meta font-medium text-text-muted">{{ tr('Prompt prefix') }}</p>
        <BaseTextarea v-model="promptDraft" :rows="5" :placeholder="tr('Prepended to every built-in system prompt')" />
        <div class="mt-2 flex justify-end">
          <BaseButton variant="secondary" size="sm" @click="savePrompt">{{ tr('Save') }}</BaseButton>
        </div>
      </section>
    </div>
  </BaseDrawer>
</template>
