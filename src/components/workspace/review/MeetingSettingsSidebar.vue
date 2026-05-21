<script setup lang="ts">
import { translatePhrase } from '@/i18n'
import type { ReviewContextElement } from '@/services/review/types'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseTooltip from '@/components/ui/BaseTooltip.vue'
import { Check, Info, RotateCcw, Settings, Sparkles } from 'lucide-vue-next'

interface QueueItem {
  id: string
  agentId: string
  agentName: string
  requestedBy: 'user' | 'agent' | 'system'
}

const props = defineProps<{
  show: boolean
  focus: string
  contextOptions: Array<{ key: ReviewContextElement; label: string; detail: string }>
  selectedContextElements: ReviewContextElement[]
  queueItems: QueueItem[]
  loading: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'update:focus': [value: string]
  'toggle-context': [element: ReviewContextElement]
  'reset': []
  'start': []
}>()

const tr = translatePhrase

function isElementSelected(element: ReviewContextElement) {
  return props.selectedContextElements.includes(element)
}
</script>

<template>
  <aside
    class="flex h-full flex-col border-r border-surface-4 bg-surface-1 transition-all duration-300"
    :class="show ? 'w-[300px]' : 'w-0 overflow-hidden'"
  >
    <div class="flex h-[52px] shrink-0 items-center justify-between border-b border-surface-4 px-4">
      <div class="flex items-center gap-2">
        <Settings :size="16" class="text-text-secondary" />
        <h3 class="text-xs font-bold uppercase tracking-widest text-text-primary">{{ tr('Meeting Settings') }}</h3>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-[10px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Opening topic') }}</p>
          <BaseTooltip :text="tr('Agents may propose a new focus, but it only changes after user approval.')">
            <Info :size="12" class="text-text-muted" />
          </BaseTooltip>
        </div>
        <textarea
          :value="focus"
          rows="5"
          class="w-full resize-none rounded-xl border border-surface-4 bg-surface-2 px-3 py-2 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted transition-all focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
          :placeholder="tr('Describe the meeting opening topic...')"
          @input="emit('update:focus', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </section>

      <section class="mt-8 space-y-3">
        <p class="text-[10px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Context Elements') }}</p>
        <div class="grid gap-2">
          <button
            v-for="item in contextOptions"
            :key="item.key"
            class="group relative w-full overflow-hidden rounded-xl border p-3 text-left transition-all"
            :class="isElementSelected(item.key) ? 'border-accent/40 bg-accent/5 ring-1 ring-accent/20' : 'border-surface-4 bg-surface-2 hover:border-surface-5 hover:bg-surface-3'"
            @click="emit('toggle-context', item.key)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-semibold" :class="isElementSelected(item.key) ? 'text-accent' : 'text-text-primary'">{{ tr(item.label) }}</p>
                <p class="mt-0.5 text-[10px] leading-relaxed text-text-muted">{{ tr(item.detail) }}</p>
              </div>
              <div v-if="isElementSelected(item.key)" class="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white">
                <Check :size="10" stroke-width="3" />
              </div>
            </div>
          </button>
        </div>
      </section>

      <section class="mt-8 space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-[10px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Turn Queue') }}</p>
          <BaseTag variant="default" size="sm" class="font-mono">{{ queueItems.length }}</BaseTag>
        </div>
        <div v-if="queueItems.length" class="space-y-2">
          <div
            v-for="(item, index) in queueItems"
            :key="item.id"
            class="flex items-center justify-between gap-2 rounded-xl border border-surface-4 bg-surface-2 p-2 shadow-sm transition-all hover:border-surface-5"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-[10px] font-bold text-text-secondary">
                {{ index + 1 }}
              </span>
              <span class="truncate text-xs font-medium text-text-secondary">{{ tr(item.agentName) }}</span>
            </div>
            <BaseTag :variant="item.requestedBy === 'user' ? 'warning' : 'default'" size="sm" class="!px-1.5 !py-0 !text-[9px]">
              {{ tr(item.requestedBy === 'user' ? 'User' : 'Agent') }}
            </BaseTag>
          </div>
        </div>
        <div v-else class="rounded-xl border border-dashed border-surface-4 bg-surface-1/50 py-6 text-center">
          <p class="text-xs text-text-muted">{{ tr('No agents waiting') }}</p>
        </div>
      </section>
    </div>

    <div class="border-t border-surface-4 p-4 bg-surface-1/50">
      <div class="grid grid-cols-2 gap-3">
        <BaseButton variant="ghost" size="sm" class="!h-10 border border-surface-4" @click="emit('reset')">
          <RotateCcw :size="14" />
          <span>{{ tr('Reset') }}</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" class="!h-10 shadow-lg shadow-accent/10" :disabled="loading" @click="emit('start')">
          <Sparkles :size="14" />
          <span>{{ tr('Start') }}</span>
        </BaseButton>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--surface-4);
  border-radius: 2px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--surface-5);
}
</style>
