<script setup lang="ts">
import { computed } from 'vue'
import { translatePhrase } from '@/i18n'
import type { ReviewContextElement } from '@/services/review/types'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseTooltip from '@/components/ui/BaseTooltip.vue'
import {
  BookOpen,
  Check,
  ClipboardList,
  FileText,
  Info,
  Layers,
  Library,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-vue-next'

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
  autoContinue: boolean
  maxAutoRounds: number
  roundCount: number
  verificationStatus?: string
  verificationReason?: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'update:focus': [value: string]
  'update:auto-continue': [value: boolean]
  'update:max-auto-rounds': [value: number]
  'toggle-context': [element: ReviewContextElement]
  'reset': []
  'start': []
}>()

const tr = translatePhrase
type ContextWeight = 'core' | 'reference' | 'heavy'
type ContextGroupId = 'project' | 'chapter' | 'library'

const contextMeta: Record<ReviewContextElement, {
  group: ContextGroupId
  weight: ContextWeight
  icon: any
  short: string
}> = {
  'story-config': { group: 'project', weight: 'core', icon: SlidersHorizontal, short: 'Scope' },
  'master-outline': { group: 'project', weight: 'reference', icon: BookOpen, short: 'Arc' },
  characters: { group: 'project', weight: 'reference', icon: Users, short: 'Cast' },
  'knowledge-base': { group: 'library', weight: 'heavy', icon: Library, short: 'KB' },
  'chapter-plan-overview': { group: 'chapter', weight: 'heavy', icon: Layers, short: 'All plans' },
  'selected-chapter': { group: 'chapter', weight: 'core', icon: FileText, short: 'Current' },
  'chapter-plan': { group: 'chapter', weight: 'core', icon: ClipboardList, short: 'Plan' },
  'chapter-draft': { group: 'chapter', weight: 'heavy', icon: FileText, short: 'Draft' },
}

const groupTitles: Record<ContextGroupId, string> = {
  project: 'Project sources',
  chapter: 'Chapter sources',
  library: 'Reference sources',
}

const groupDescriptions: Record<ContextGroupId, string> = {
  project: 'Global direction and story state.',
  chapter: 'Current chapter and cross-chapter planning.',
  library: 'External references retrieved from linked knowledge bases.',
}

const contextPresets: Array<{
  id: string
  label: string
  detail: string
  elements: ReviewContextElement[]
}> = [
  {
    id: 'focused',
    label: 'Focused edit',
    detail: 'Fast current-chapter changes',
    elements: ['story-config', 'selected-chapter', 'chapter-plan', 'chapter-draft'],
  },
  {
    id: 'planning',
    label: 'Planning pass',
    detail: 'Outline and structure review',
    elements: ['story-config', 'master-outline', 'characters', 'selected-chapter', 'chapter-plan', 'chapter-plan-overview'],
  },
  {
    id: 'continuity',
    label: 'Continuity audit',
    detail: 'Cast and cross-chapter facts',
    elements: ['master-outline', 'characters', 'chapter-plan-overview', 'selected-chapter', 'chapter-plan'],
  },
  {
    id: 'reference',
    label: 'Reference heavy',
    detail: 'Use linked knowledge',
    elements: ['story-config', 'master-outline', 'characters', 'knowledge-base', 'selected-chapter', 'chapter-plan'],
  },
]

const weightScore: Record<ContextWeight, number> = {
  core: 1,
  reference: 2,
  heavy: 3,
}

const selectedCount = computed(() => props.selectedContextElements.length)
const selectedWeight = computed(() =>
  props.selectedContextElements.reduce((sum, element) => sum + weightScore[contextMeta[element]?.weight || 'reference'], 0)
)
const maxWeight = computed(() =>
  props.contextOptions.reduce((sum, item) => sum + weightScore[contextMeta[item.key]?.weight || 'reference'], 0) || 1
)
const loadPercent = computed(() => Math.min(100, Math.round((selectedWeight.value / maxWeight.value) * 100)))
const loadLabel = computed(() => {
  if (loadPercent.value >= 75) return 'Broad context'
  if (loadPercent.value >= 45) return 'Balanced context'
  return 'Focused context'
})
const contextGroups = computed(() =>
  (['project', 'chapter', 'library'] as ContextGroupId[])
    .map(group => ({
      id: group,
      title: groupTitles[group],
      description: groupDescriptions[group],
      items: props.contextOptions.filter(item => contextMeta[item.key]?.group === group),
    }))
    .filter(group => group.items.length)
)

function isElementSelected(element: ReviewContextElement) {
  return props.selectedContextElements.includes(element)
}

function setElement(element: ReviewContextElement, enabled: boolean) {
  if (isElementSelected(element) === enabled) return
  if (!enabled && selectedCount.value <= 1) return
  emit('toggle-context', element)
}

function applyPreset(elements: ReviewContextElement[]) {
  const allowed = new Set(props.contextOptions.map(item => item.key))
  const next = new Set(elements.filter(element => allowed.has(element)))
  for (const item of props.contextOptions) {
    setElement(item.key, next.has(item.key))
  }
}

function selectGroup(elements: ReviewContextElement[]) {
  for (const element of elements) setElement(element, true)
}

function trimToGroup(elements: ReviewContextElement[]) {
  const keep = new Set(elements)
  for (const item of props.contextOptions) setElement(item.key, keep.has(item.key))
}

function itemWeightLabel(element: ReviewContextElement) {
  const weight = contextMeta[element]?.weight || 'reference'
  if (weight === 'core') return 'Core'
  if (weight === 'heavy') return 'Large'
  return 'Context'
}

function setMaxRounds(delta: number) {
  emit('update:max-auto-rounds', Math.max(1, Math.min(12, props.maxAutoRounds + delta)))
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
          <BaseTooltip :text="tr('The meeting uses this focus to pick context, synthesize one concrete action, and run the project tool.')">
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

      <section class="mt-6 space-y-3 rounded-lg border border-surface-4 bg-surface-2 p-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[10px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Run Strategy') }}</p>
            <p class="mt-0.5 truncate text-[10px] text-text-muted">{{ tr('Continue automatically until the verifier says the task is complete.') }}</p>
          </div>
          <button
            class="shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold transition-colors"
            :class="autoContinue ? 'border-accent/40 bg-accent/10 text-accent' : 'border-surface-4 bg-surface-1 text-text-muted'"
            @click="emit('update:auto-continue', !autoContinue)"
          >
            {{ tr(autoContinue ? 'Auto' : 'Manual') }}
          </button>
        </div>

        <div class="grid grid-cols-[1fr_auto] items-center gap-3">
          <div>
            <p class="text-[10px] font-medium text-text-secondary">{{ tr('Auto rounds') }}</p>
            <p class="mt-0.5 text-[9px] text-text-muted">{{ tr('Stops early on completion, high risk, or blocker.') }}</p>
          </div>
          <div class="flex items-center rounded border border-surface-4 bg-surface-1">
            <button class="h-7 w-7 text-text-muted hover:text-text-primary" @click="setMaxRounds(-1)">-</button>
            <span class="w-7 text-center text-[11px] font-bold tabular-nums text-text-primary">{{ maxAutoRounds }}</span>
            <button class="h-7 w-7 text-text-muted hover:text-text-primary" @click="setMaxRounds(1)">+</button>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 rounded border border-surface-4 bg-surface-1 px-2 py-1.5">
          <span class="text-[10px] text-text-muted">{{ tr('Round') }}</span>
          <span class="text-[10px] font-bold tabular-nums text-text-secondary">{{ roundCount }}/{{ maxAutoRounds }}</span>
        </div>

        <div v-if="verificationStatus || verificationReason" class="rounded border border-surface-4 bg-surface-1 px-2 py-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-medium text-text-secondary">{{ tr('Verifier') }}</span>
            <BaseTag variant="default" size="sm" class="!px-1.5 !py-0 !text-[9px]">{{ tr(verificationStatus || 'idle') }}</BaseTag>
          </div>
          <p v-if="verificationReason" class="mt-1 line-clamp-2 text-[10px] leading-snug text-text-muted">{{ verificationReason }}</p>
        </div>
      </section>

      <section class="mt-8 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Context Elements') }}</p>
            <p class="mt-0.5 text-[10px] text-text-muted">{{ tr('Choose exactly what the agents can see this round.') }}</p>
          </div>
          <BaseTag variant="accent" size="sm" class="font-mono">{{ selectedCount }}/{{ contextOptions.length }}</BaseTag>
        </div>

        <div class="rounded-lg border border-surface-4 bg-surface-2 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-xs font-semibold text-text-primary">{{ tr(loadLabel) }}</p>
              <p class="mt-0.5 truncate text-[10px] text-text-muted">{{ tr('More context improves recall but increases noise.') }}</p>
            </div>
            <span class="shrink-0 text-[10px] font-bold tabular-nums text-text-secondary">{{ loadPercent }}%</span>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-4">
            <div class="h-full rounded-full bg-accent transition-all" :style="{ width: `${loadPercent}%` }"></div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="preset in contextPresets"
            :key="preset.id"
            class="rounded-lg border border-surface-4 bg-surface-2 px-2.5 py-2 text-left transition-colors hover:border-accent/40 hover:bg-accent/5"
            @click="applyPreset(preset.elements)"
          >
            <p class="truncate text-[11px] font-semibold text-text-primary">{{ tr(preset.label) }}</p>
            <p class="mt-0.5 truncate text-[9px] text-text-muted">{{ tr(preset.detail) }}</p>
          </button>
        </div>

        <div class="space-y-3">
          <div
            v-for="group in contextGroups"
            :key="group.id"
            class="rounded-lg border border-surface-4 bg-surface-1"
          >
            <div class="flex items-start justify-between gap-2 border-b border-surface-4 px-3 py-2">
              <div class="min-w-0">
                <p class="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{{ tr(group.title) }}</p>
                <p class="mt-0.5 truncate text-[9px] text-text-muted">{{ tr(group.description) }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  class="rounded border border-surface-4 px-1.5 py-0.5 text-[9px] font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
                  @click="selectGroup(group.items.map(item => item.key))"
                >
                  {{ tr('Add all') }}
                </button>
                <button
                  class="rounded border border-surface-4 px-1.5 py-0.5 text-[9px] font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
                  @click="trimToGroup(group.items.map(item => item.key))"
                >
                  {{ tr('Only') }}
                </button>
              </div>
            </div>

            <div class="divide-y divide-surface-4">
              <button
                v-for="item in group.items"
                :key="item.key"
                class="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-left transition-colors"
                :class="isElementSelected(item.key) ? 'bg-accent/5' : 'hover:bg-surface-2'"
                @click="setElement(item.key, !isElementSelected(item.key))"
              >
                <span
                  class="mt-0.5 flex h-5 w-5 items-center justify-center rounded border transition-colors"
                  :class="isElementSelected(item.key) ? 'border-accent bg-accent text-white' : 'border-surface-4 bg-surface-2 text-text-muted'"
                >
                  <Check v-if="isElementSelected(item.key)" :size="12" stroke-width="3" />
                  <component v-else :is="contextMeta[item.key]?.icon" :size="12" />
                </span>
                <span class="min-w-0">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-xs font-semibold" :class="isElementSelected(item.key) ? 'text-accent' : 'text-text-primary'">{{ tr(item.label) }}</span>
                    <span class="shrink-0 rounded border border-surface-4 px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide text-text-muted">{{ tr(itemWeightLabel(item.key)) }}</span>
                  </span>
                  <span class="mt-0.5 block text-[10px] leading-snug text-text-muted">{{ tr(item.detail) }}</span>
                </span>
                <span class="mt-0.5 shrink-0 text-[9px] font-mono text-text-muted">{{ tr(contextMeta[item.key]?.short || '') }}</span>
              </button>
            </div>
          </div>
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
