<script setup lang="ts">
import { computed } from 'vue'
import { translatePhrase } from '@/i18n'
import type { ReviewAgentState, ReviewAgentStatus } from '@/services/review/multiAgentReview'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { Bot, Brain, History, Plus, RotateCcw, Settings, ShieldAlert, Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  show: boolean
  agents: ReviewAgentState[]
  queueAgentIds: string[]
  statusMeta: Record<ReviewAgentStatus, { label: string; tone: string; dot: string }>
}>()

const emit = defineEmits<{
  'restore-default': []
  'add-agent': []
  'set-agent-enabled': [agentId: string, enabled: boolean]
  'open-agent-settings': [agentId: string]
  'delete-agent': [agentId: string]
  'ask-next': [agentId: string]
}>()

const tr = translatePhrase

const queuedAgentSet = computed(() => new Set(props.queueAgentIds))
</script>

<template>
  <aside
    class="flex h-full flex-col border-l border-surface-4 bg-surface-1 transition-all duration-300"
    :class="show ? 'w-[320px]' : 'w-0 overflow-hidden'"
  >
    <div class="flex h-[52px] shrink-0 items-center justify-between border-b border-surface-4 px-4">
      <div class="flex items-center gap-2">
        <Brain :size="16" class="text-accent" />
        <h3 class="text-xs font-bold uppercase tracking-widest text-text-primary">{{ tr('Participants') }}</h3>
      </div>
      <div class="flex items-center gap-2">
        <BaseTag variant="default" size="sm" class="font-mono">{{ agents.length }}</BaseTag>
        <button
          class="grid h-7 w-7 place-items-center rounded-lg border border-surface-4 bg-surface-2 text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
          :title="tr('Restore default agents')"
          @click="emit('restore-default')"
        >
          <RotateCcw :size="14" />
        </button>
        <button
          class="grid h-7 w-7 place-items-center rounded-lg border border-surface-4 bg-surface-2 text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
          :title="tr('Add agent')"
          @click="emit('add-agent')"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
      <article
        v-for="agent in agents"
        :key="agent.id"
        class="group relative overflow-hidden rounded-2xl border border-surface-4 bg-surface-2 p-4 transition-all hover:border-surface-5 hover:shadow-md"
      >
        <div class="absolute top-0 left-0 h-[3px] w-full" :class="statusMeta[agent.status].dot"></div>

        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-surface-4 bg-surface-1 shadow-sm overflow-hidden">
              <Bot v-if="agent.status !== 'speaking'" :size="20" class="text-text-muted group-hover:text-text-secondary transition-colors" />
              <div v-else class="flex items-center justify-center w-full h-full bg-success/5">
                <div class="flex items-end gap-[3px] h-3">
                  <span class="w-[3px] bg-success rounded-full animate-speaking-bar-1"></span>
                  <span class="w-[3px] bg-success rounded-full animate-speaking-bar-2"></span>
                  <span class="w-[3px] bg-success rounded-full animate-speaking-bar-3"></span>
                </div>
              </div>
            </div>
            <div class="min-w-0">
              <h5 class="truncate text-sm font-bold text-text-primary">{{ tr(agent.name) }}</h5>
              <p class="truncate text-[10px] font-medium text-text-muted uppercase tracking-wider">{{ tr(agent.role) }}</p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors"
              :class="agent.enabled ? 'bg-success/10 text-success hover:bg-success/15' : 'bg-surface-3 text-text-muted hover:text-text-primary'"
              @click="emit('set-agent-enabled', agent.id, !agent.enabled)"
            >
              {{ tr(agent.enabled ? 'Enabled' : 'Disabled') }}
            </button>
            <button
              class="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
              @click="emit('open-agent-settings', agent.id)"
            >
              <Settings :size="14" />
            </button>
            <button
              class="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-danger-subtle hover:text-danger"
              @click="emit('delete-agent', agent.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <p class="mt-3 text-xs leading-relaxed text-text-secondary">{{ tr(agent.brief) }}</p>

        <div class="mt-4 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="h-1.5 w-1.5 rounded-full" :class="statusMeta[agent.status].dot"></div>
            <span class="text-[10px] font-bold uppercase tracking-tight" :class="statusMeta[agent.status].tone">{{ tr(statusMeta[agent.status].label) }}</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1 text-[10px] text-text-muted">
              <History :size="10" />
              <span>{{ agent.privateMemory.length }}</span>
            </div>
            <BaseButton
              variant="secondary"
              size="sm"
              class="!h-8 !px-3 !text-[10px] !font-bold uppercase tracking-wider transition-all"
              :disabled="!agent.enabled || agent.status === 'speaking' || queuedAgentSet.has(agent.id)"
              @click="emit('ask-next', agent.id)"
            >
              <span>{{ tr('Ask Next') }}</span>
            </BaseButton>
          </div>
        </div>

        <transition name="fade">
          <div v-if="agent.toolState.error" class="mt-3 flex min-w-0 items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-[10px] text-danger animate-in slide-in-from-top-1">
            <ShieldAlert :size="12" class="shrink-0 mt-0.5" />
            <p class="min-w-0 whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">{{ agent.toolState.error }}</p>
          </div>
        </transition>
      </article>
    </div>

    <div class="border-t border-surface-4 bg-surface-1/50 p-4">
      <div class="rounded-xl border border-surface-4 bg-surface-2 p-3 text-center">
        <p class="text-[10px] font-medium text-text-muted leading-relaxed">
          {{ tr('User commands override normal agent priority. Use \"Ask Next\" to force an agent to speak.') }}
        </p>
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

@keyframes speaking-bar {
  0%, 100% { height: 4px; }
  50% { height: 12px; }
}

.animate-speaking-bar-1 {
  animation: speaking-bar 0.8s ease-in-out infinite;
}
.animate-speaking-bar-2 {
  animation: speaking-bar 0.8s ease-in-out infinite 0.2s;
}
.animate-speaking-bar-3 {
  animation: speaking-bar 0.8s ease-in-out infinite 0.4s;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
