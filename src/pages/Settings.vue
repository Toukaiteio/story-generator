<script setup lang="ts">
import { onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { Monitor, Globe, Info, Database, FolderOpen } from 'lucide-vue-next'

const ui = useUiStore()
onMounted(() => ui.navigateTo('settings'))

const langOptions = [
  { label: 'English', value: 'en' },
  { label: '中文', value: 'zh' },
]

function handleLanguageChange(value: any) {
  ui.setLanguage(value as 'en' | 'zh')
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
              <BaseTag variant="accent" size="sm">Dark</BaseTag>
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
              <span class="text-sm text-text-primary">0.1.0</span>
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
