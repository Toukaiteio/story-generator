<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useProviderStore } from '@/stores/provider'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { APP_VERSION } from '@/constants/version'
import { Monitor, Globe, Info, Database, FolderOpen, Wrench, Download, RefreshCw } from 'lucide-vue-next'

const ui = useUiStore()
const providerStore = useProviderStore()
const updateStatus = ref<UpdaterStatus>({
  state: 'idle',
  message: 'Update status has not been loaded yet.',
})
const checkingForUpdates = ref(false)
const hasUpdaterApi = ref(false)
let removeUpdaterStatusListener: (() => void) | null = null

onMounted(async () => {
  ui.navigateTo('settings')
  hasUpdaterApi.value = Boolean(window.electronAPI?.updater)
  if (hasUpdaterApi.value && window.electronAPI?.updater) {
    removeUpdaterStatusListener = window.electronAPI.updater.onStatus(status => {
      updateStatus.value = status
      checkingForUpdates.value = status.state === 'checking'
    })
    updateStatus.value = await window.electronAPI.updater.getStatus()
  }
})

onBeforeUnmount(() => {
  removeUpdaterStatusListener?.()
  removeUpdaterStatusListener = null
})

const issueSeverityOptions = [
  { label: 'Low - process all issues', value: 'low' },
  { label: 'Medium - ignore low severity', value: 'medium' },
  { label: 'High - only process high severity', value: 'high' },
]

const langOptions = [
  { label: 'English', value: 'en' },
  { label: '中文', value: 'zh' },
]

function handleLanguageChange(value: any) {
  ui.setLanguage(value as 'en' | 'zh')
}

function handleMaxToolRoundsChange(value: string) {
  providerStore.setMaxToolCallRounds(Number(value))
}

function handleMinIssueSeverityChange(value: any) {
  providerStore.setMinIssueSeverity(value)
}

function handleVibeRewindPointsChange(value: string) {
  ui.setVibeRewindPoints(Number(value))
}

function handleCustomSystemPromptChange(value: string) {
  ui.setCustomSystemPrompt(value)
}

function handleMeetingProposerPromptChange(value: string) {
  ui.setMeetingProposerPrompt(value)
}

async function handleCheckForUpdates() {
  if (!window.electronAPI?.updater) return
  checkingForUpdates.value = true
  try {
    updateStatus.value = await window.electronAPI.updater.check()
  } finally {
    checkingForUpdates.value = updateStatus.value.state === 'checking'
  }
}

async function handleInstallUpdate() {
  await window.electronAPI?.updater?.install()
}

function formatUpdateCheckedAt(value?: string) {
  if (!value) return ui.text('Never checked')
  return new Date(value).toLocaleString()
}

async function handleBrowseStorage() {
  if (!window.electronAPI?.dialog?.openDirectory) return
  const path = await window.electronAPI.dialog.openDirectory({
    title: ui.t('settings.defaultStoragePath'),
  })
  if (path) {
    ui.setDefaultStoragePath(path)
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-2xl mx-auto px-6 py-6">
      <h1 class="text-lg font-semibold text-text-primary mb-6">{{ ui.t('settings.title') }}</h1>

      <div class="space-y-6">
        <section>
          <div class="flex items-center gap-2 mb-4">
            <Monitor :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.t('settings.appearance') }}</h2>
          </div>
          <div class="pl-6">
            <div class="flex items-center justify-between py-2">
              <div>
                <p class="text-sm text-text-primary">{{ ui.t('settings.theme') }}</p>
                <p class="text-xs text-text-muted">{{ ui.t('settings.themeDescription') }}</p>
              </div>
              <BaseTag variant="accent" size="sm">{{ ui.text('Dark') }}</BaseTag>
            </div>
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Globe :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.t('settings.language') }}</h2>
          </div>
          <div class="pl-6">
            <BaseSelect
              :model-value="ui.language"
              :label="ui.t('settings.languageLabel')"
              :options="langOptions"
              @update:model-value="handleLanguageChange"
            />
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Wrench :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.text('AI Tool Workflow') }}</h2>
          </div>
          <div class="pl-6">
            <BaseInput
              :model-value="String(providerStore.toolWorkflowSettings.maxToolCallRounds)"
              :label="ui.text('Tool workflow soft checkpoint')"
              type="number"
              placeholder="16"
              @update:model-value="handleMaxToolRoundsChange"
            />
            <p class="mt-2 text-xs leading-relaxed text-text-muted">
              {{ ui.text('Default is 16. This is now a soft checkpoint: the app nudges the agent to finalize, but allows continued progress. It stops only after repeated no-tool responses, stalled progress, or a much higher safety guard.') }}
            </p>
            <div class="mt-4">
              <BaseSelect
                :model-value="providerStore.toolWorkflowSettings.minIssueSeverity"
                :label="ui.text('Minimum issue severity to polish')"
                :options="issueSeverityOptions"
                @update:model-value="handleMinIssueSeverityChange"
              />
              <p class="mt-2 text-xs leading-relaxed text-text-muted">
                {{ ui.text('Default is Low. Raising this threshold marks lower-severity issues as ignored during Polish.') }}
              </p>
            </div>
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Wrench :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.text('Vibe AI Safety') }}</h2>
          </div>
          <div class="pl-6">
            <BaseInput
              :model-value="String(ui.vibeRewindPoints)"
              :label="ui.text('Workspace rewind points')"
              type="number"
              placeholder="1"
              @update:model-value="handleVibeRewindPointsChange"
            />
            <p class="mt-2 text-xs leading-relaxed text-text-muted">
              {{ ui.text('Default is 1. Before each Vibe AI request, the app saves a small snapshot of the current workspace so you can rewind from that message if the AI makes a bad edit. Older snapshots are replaced when the limit is exceeded. Set 0 to disable rewind snapshots.') }}
            </p>
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Download :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.text('Software Updates') }}</h2>
          </div>
          <div class="pl-6">
            <div class="rounded-lg border border-surface-4 bg-surface-2 p-4">
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-text-primary">{{ ui.text(updateStatus.message) }}</p>
                  <p class="mt-1 text-xs text-text-muted">
                    {{ ui.text('Current version') }}: {{ APP_VERSION }}
                    <span v-if="updateStatus.version"> · {{ ui.text('Latest') }}: {{ updateStatus.version }}</span>
                  </p>
                  <p class="mt-1 text-xs text-text-muted">
                    {{ ui.text('Last checked') }}: {{ formatUpdateCheckedAt(updateStatus.checkedAt) }}
                  </p>
                </div>
                <div class="flex shrink-0 flex-wrap gap-2">
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :loading="checkingForUpdates"
                    :disabled="checkingForUpdates || !hasUpdaterApi"
                    @click="handleCheckForUpdates"
                  >
                    <template v-if="!checkingForUpdates">
                      <RefreshCw :size="14" />
                    </template>
                    <span>{{ ui.text('Check Now') }}</span>
                  </BaseButton>
                  <BaseButton
                    v-if="updateStatus.state === 'downloaded'"
                    variant="primary"
                    size="sm"
                    @click="handleInstallUpdate"
                  >
                    <Download :size="14" />
                    <span>{{ ui.text('Restart and Install') }}</span>
                  </BaseButton>
                </div>
              </div>

              <div v-if="updateStatus.state === 'downloading'" class="mt-3">
                <div class="h-2 overflow-hidden rounded-full bg-surface-4">
                  <div
                    class="h-full rounded-full bg-accent transition-all duration-150"
                    :style="{ width: `${updateStatus.progress ?? 0}%` }"
                  />
                </div>
                <p class="mt-1 text-xs text-text-muted">{{ updateStatus.progress ?? 0 }}%</p>
              </div>

              <p v-if="!hasUpdaterApi" class="mt-3 text-xs leading-relaxed text-text-muted">
                {{ ui.text('Update checks are available in the packaged Electron app.') }}
              </p>
            </div>
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Wrench :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.text('Prepend to System Prompts') }}</h2>
          </div>
          <div class="pl-6">
            <BaseTextarea
              :model-value="ui.customSystemPrompt"
              :label="ui.text('Custom prompt prefix')"
              :rows="8"
              :auto-resize="true"
              :placeholder="ui.text('Optional global instructions inserted before each built-in system prompt...')"
              @update:model-value="handleCustomSystemPromptChange"
            />
            <p class="mt-2 text-xs leading-relaxed text-text-muted">
              {{ ui.text('This text is prepended before every built-in Agent and AI request system prompt. It does not replace the built-in prompt. Leave it empty to disable this behavior.') }}
            </p>
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Wrench :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.text('Meeting Proposer Agent') }}</h2>
          </div>
          <div class="pl-6">
            <BaseTextarea
              :model-value="ui.meetingProposerPrompt"
              :label="ui.text('Proposer system prompt')"
              :rows="8"
              :auto-resize="true"
              :placeholder="ui.text('Internal meeting proposer instructions...')"
              @update:model-value="handleMeetingProposerPromptChange"
            />
            <p class="mt-2 text-xs leading-relaxed text-text-muted">
              {{ ui.text('This built-in agent is triggered internally after the first open discussion pass. Its model is configured in Provider > Agent Binding as Meeting Proposer Agent.') }}
            </p>
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Database :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.t('settings.storage') }}</h2>
          </div>
          <div class="pl-6">
            <div class="flex flex-col gap-2">
              <div class="flex flex-col gap-1">
                <p class="text-sm text-text-primary">{{ ui.t('settings.defaultStoragePath') }}</p>
                <p class="text-xs text-text-muted">{{ ui.t('settings.defaultStoragePathDescription') }}</p>
              </div>
              <div class="flex gap-2">
                <div class="flex-1 min-w-0 h-9 flex items-center px-3 bg-surface-2 border border-surface-4 rounded-md text-sm text-text-primary truncate">
                  {{ ui.defaultStoragePath || 'Not set' }}
                </div>
                <BaseButton variant="secondary" class="!h-9" @click="handleBrowseStorage">
                  <FolderOpen :size="14" />
                  <span>{{ ui.t('settings.browse') }}</span>
                </BaseButton>
              </div>
            </div>
          </div>
        </section>

        <section class="border-t border-surface-4 pt-6">
          <div class="flex items-center gap-2 mb-4">
            <Info :size="16" class="text-accent" />
            <h2 class="text-sm font-semibold text-text-primary">{{ ui.t('settings.about') }}</h2>
          </div>
          <div class="pl-6 space-y-2">
            <div class="flex items-center justify-between py-1">
              <span class="text-sm text-text-secondary">{{ ui.t('settings.version') }}</span>
              <span class="text-sm text-text-primary">{{ APP_VERSION }}</span>
            </div>
            <div class="flex items-center justify-between py-1">
              <span class="text-sm text-text-secondary">{{ ui.t('settings.framework') }}</span>
              <span class="text-sm text-text-primary">Electron + Vue 3</span>
            </div>
            <div class="flex items-center justify-between py-1">
              <span class="text-sm text-text-secondary">{{ ui.t('settings.license') }}</span>
              <span class="text-sm text-text-primary">MIT</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
