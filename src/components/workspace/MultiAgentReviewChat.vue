<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { translatePhrase } from '@/i18n'
import { useMultiAgentReviewChat, type ReviewAgentStatus, type ReviewContextElement, type ReviewPublicMessage } from '@/services/review/multiAgentReview'
import { useUiStore } from '@/stores/ui'
import { useProjectStore } from '@/stores/project'
import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolCallStatus from '@/components/ui/ToolCallStatus.vue'
import VibeModelPicker from './VibeModelPicker.vue'
import MeetingSettingsSidebar from './review/MeetingSettingsSidebar.vue'
import MeetingParticipantsSidebar from './review/MeetingParticipantsSidebar.vue'
import { Bot, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Info, LayoutList, MessageSquare, PauseCircle, RotateCcw, Settings, ShieldAlert, Sparkles, User, Users, ArrowUp, Square, X } from 'lucide-vue-next'

const props = defineProps<{
  project: StoryProject | null | undefined
  chapter: Chapter | null | undefined
  outline: string
  characters: string
}>()

const tr = translatePhrase
const ui = useUiStore()
const projectStore = useProjectStore()
const chatEndRef = ref<HTMLElement | null>(null)
const editingAgentId = ref<string | null>(null)
const agentPromptDraft = ref('')
const agentModelDraft = ref('')
const continueReason = ref('')
const showLeftSidebar = ref(true)
const showRightSidebar = ref(true)
const showAddAgentDialog = ref(false)
const showRestoreAgentsConfirm = ref(false)
const showResetConfirm = ref(false)
const newAgentName = ref('')
const newAgentRole = ref('')
const newAgentBrief = ref('')
const newAgentPrompt = ref('')
const newAgentModelRole = ref<'chapterPlanner' | 'proofreader'>('chapterPlanner')
const isProposalBannerCollapsed = ref(false)
const isChangeVoteBannerCollapsed = ref(false)
const hiddenProposalId = ref<string | null>(null)
const hiddenChangeVoteId = ref<string | null>(null)

const maxContextTurns = computed({
  get: () => props.project?.reviewAgentSettings?.maxContextTurns ?? 15,
  set: (val: number) => {
    if (!props.project) return
    const newSettings = { ...(props.project.reviewAgentSettings || { agents: {} }), maxContextTurns: val }
    void projectStore.updateProject(props.project.id, { reviewAgentSettings: newSettings })
  }
})

const review = useMultiAgentReviewChat(() => ({
  project: props.project,
  chapter: props.chapter,
  outline: props.outline,
  characters: props.characters,
}))

const statusMeta: Record<ReviewAgentStatus, { label: string; tone: string; dot: string }> = {
  idle: { label: 'idle', tone: 'text-text-muted', dot: 'bg-surface-5' },
  waiting: { label: 'waiting', tone: 'text-warning', dot: 'bg-warning' },
  requesting: { label: 'requesting', tone: 'text-accent', dot: 'bg-accent' },
  speaking: { label: 'speaking', tone: 'text-success', dot: 'bg-success' },
  blocked: { label: 'blocked', tone: 'text-danger', dot: 'bg-danger' },
}

const contextOptions: Array<{ key: ReviewContextElement; label: string; detail: string }> = [
  { key: 'story-config', label: 'Story Configuration', detail: 'Theme, genre, reader, language, constraints' },
  { key: 'master-outline', label: 'Master Outline', detail: 'Project-level outline and direction' },
  { key: 'characters', label: 'Characters', detail: 'Current cast and roles' },
  { key: 'knowledge-base', label: 'Knowledge Base', detail: 'Linked project documents and retrieved references' },
  { key: 'selected-chapter', label: 'Selected Chapter', detail: 'Chapter title, status, summary' },
  { key: 'chapter-plan', label: 'Chapter Plan', detail: 'Structured chapter planning fields' },
  { key: 'chapter-draft', label: 'Chapter Draft', detail: 'Existing draft text if available' },
]

const referenceLabelMap: Record<ReviewContextElement, string> = {
  'story-config': 'Story Configuration',
  'master-outline': 'Master Outline',
  'characters': 'Characters',
  'knowledge-base': 'Knowledge Base',
  'selected-chapter': 'Selected Chapter',
  'chapter-plan': 'Chapter Plan',
  'chapter-draft': 'Chapter Draft',
}

const activeChapterTitle = computed(() =>
  props.chapter ? `Ch ${props.chapter.index + 1}: ${props.chapter.title || tr('Untitled')}` : tr('No chapter selected')
)

const queueItems = computed(() =>
  review.speakingQueue.value.map(item => {
    const agent = review.agents.value.find(entry => entry.id === item.agentId)
    return {
      ...item,
      agentName: agent?.name || (item.agentId === 'proposer' ? tr('Proposer Agent') : item.agentId),
    }
  })
)

const editingAgent = computed(() =>
  review.agents.value.find(agent => agent.id === editingAgentId.value) ?? null
)

const visiblePendingProposal = computed(() =>
  review.pendingProposal.value && hiddenProposalId.value !== review.pendingProposal.value.id
    ? review.pendingProposal.value
    : null
)

const visibleChangeVoteSession = computed(() =>
  review.changeVoteSession.value && hiddenChangeVoteId.value !== review.changeVoteSession.value.id
    ? review.changeVoteSession.value
    : null
)

function isElementSelected(element: ReviewContextElement) {
  return review.selectedContextElements.value.includes(element)
}

function toggleContextElement(element: ReviewContextElement) {
  review.setContextElement(element, !isElementSelected(element))
}

function messageSpeaker(message: ReviewPublicMessage) {
  if (message.role === 'agent') return message.agentName || tr('Agent')
  if (message.role === 'user') return tr('User')
  return tr('Meeting')
}

function referenceLinks(content: string) {
  const matches = [...content.matchAll(/\[\[([a-z-]+)(?::([^\]]+))?\]\]/gi)]
  return matches.map(match => ({
    element: match[1],
    label: match[2] || referenceLabelMap[match[1] as ReviewContextElement] || match[1],
  }))
}

function cleanMessage(content: string) {
  return content
    .replace(/\[\[([a-z-]+):([^\]]+)\]\]/gi, '$2')
    .replace(/\[\[([a-z-]+)\]\]/gi, (_match, element: string) => referenceLabelMap[element as ReviewContextElement] || element)
    .replace(/\[PROPOSE_FOCUS:\s*([^\]]+)\]/gi, '')
    .replace(/\[REQUEST_END:\s*([^\]]+)\]/gi, '')
    .replace(/\[REQUEST_CHANGE\][\s\S]*?\[\/REQUEST_CHANGE\]/gi, '')
    .replace(/\[ASK_USER\][\s\S]*?\[\/ASK_USER\]/gi, '')
    .replace(/\[CHANGE_VOTE:\s*(?:yes|no|approve|reject)\s*\]/gi, '')
    .replace(/\[End vote:\s*(?:Approve|Reject)\]/gi, '')
    .replace(/\[Change vote:\s*(?:Approve|Reject)\]/gi, '')
    .trim()
}

function openReference(element: string) {
  if (element === 'story-config') {
    ui.setWorkspaceNode('config')
    return
  }
  if (element === 'master-outline') {
    ui.setWorkspaceNode('outline')
    return
  }
  if (element === 'characters') {
    ui.setWorkspaceNode('generation-planning')
    return
  }
  if (element === 'knowledge-base') {
    ui.navigateTo('knowledge')
    return
  }
  if (element === 'chapter-plan') {
    ui.setWorkspaceNode('generation-chapter-outline')
    return
  }
  if (element === 'selected-chapter' || element === 'chapter-draft') {
    ui.setWorkspaceNode(props.chapter?.id ? `chapter-${props.chapter.id}` : 'generation-writing')
  }
}

function changeVoteTagVariant(status: string) {
  if (status === 'applied') return 'success'
  if (status === 'rejected' || status === 'failed') return 'danger'
  return 'warning'
}

function changeVoteStatusLabel(status: string) {
  if (status === 'applied') return tr('Applied')
  if (status === 'rejected') return tr('Rejected')
  if (status === 'failed') return tr('Failed')
  if (status === 'applying') return tr('Applying')
  return tr('Voting')
}

function submitUserMessage() {
  void review.sendUserMessage()
}

function startMeetingRound() {
  review.requestAllAgents(review.currentFocus.value)
}

function endMeetingNow() {
  review.endMeeting('User stopped the meeting and interrupted pending agent turns.')
}

function openAgentSettings(agentId: string) {
  const agent = review.agents.value.find(item => item.id === agentId)
  if (!agent) return
  editingAgentId.value = agentId
  agentPromptDraft.value = agent.customSystemPrompt || agent.systemPrompt
  agentModelDraft.value = agent.modelValue
}

function saveAgentSettings() {
  if (!editingAgentId.value) return
  review.updateAgentSettings(editingAgentId.value, {
    customSystemPrompt: agentPromptDraft.value,
    modelValue: agentModelDraft.value,
  })
  editingAgentId.value = null
}

async function addAgentFromDialog() {
  await review.addAgent({
    name: newAgentName.value,
    role: newAgentRole.value,
    brief: newAgentBrief.value,
    systemPrompt: newAgentPrompt.value,
    defaultModelRole: newAgentModelRole.value,
  })
  newAgentName.value = ''
  newAgentRole.value = ''
  newAgentBrief.value = ''
  newAgentPrompt.value = ''
  newAgentModelRole.value = 'chapterPlanner'
  showAddAgentDialog.value = false
}

function rejectProposalWithReason() {
  review.rejectProposal(continueReason.value)
  continueReason.value = ''
}

function rejectEndVoteWithReason() {
  if (review.rejectEndVoteSession(continueReason.value)) {
    continueReason.value = ''
  }
}

function confirmRestoreDefaultAgents() {
  showRestoreAgentsConfirm.value = false
  void review.restoreDefaultAgents()
}

function confirmResetConversation() {
  showResetConfirm.value = false
  review.clearConversation()
}

function hideCurrentProposalBanner() {
  if (!review.pendingProposal.value) return
  hiddenProposalId.value = review.pendingProposal.value.id
}

function hideCurrentChangeVoteBanner() {
  if (!review.changeVoteSession.value) return
  hiddenChangeVoteId.value = review.changeVoteSession.value.id
}

function reopenProposalBanner() {
  hiddenProposalId.value = null
}

function reopenChangeVoteBanner() {
  hiddenChangeVoteId.value = null
}

watch(() => review.messages.value.length, async () => {
  await nextTick()
  chatEndRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
})

watch(() => review.pendingProposal.value?.id || null, proposalId => {
  hiddenProposalId.value = null
  isProposalBannerCollapsed.value = false
  if (!proposalId) hiddenProposalId.value = null
})

watch(() => review.changeVoteSession.value?.id || null, sessionId => {
  hiddenChangeVoteId.value = null
  isChangeVoteBannerCollapsed.value = false
  if (!sessionId) hiddenChangeVoteId.value = null
})
</script>

<template>
  <div class="relative flex h-full min-h-0 overflow-hidden bg-surface-0">
    <MeetingSettingsSidebar
      :show="showLeftSidebar"
      :focus="review.currentFocus.value"
      :max-context-turns="maxContextTurns"
      :context-options="contextOptions"
      :selected-context-elements="review.selectedContextElements.value"
      :queue-items="queueItems"
      :loading="review.loading.value"
      @update:show="showLeftSidebar = $event"
      @update:focus="review.currentFocus.value = $event"
      @update:max-context-turns="maxContextTurns = $event"
      @toggle-context="toggleContextElement"
      @reset="showResetConfirm = true"
      @start="startMeetingRound"
    />

    <!-- Main Content: Chat Stream -->
    <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Top Header -->
      <header class="flex h-[52px] shrink-0 items-center justify-between border-b border-surface-4 bg-surface-1/80 px-4 backdrop-blur-md">
        <div class="flex min-w-0 items-center gap-3">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-4 bg-surface-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary lg:hidden"
            @click="showLeftSidebar = !showLeftSidebar"
          >
            <LayoutList :size="16" />
          </button>
          <button
            class="hidden h-8 w-8 items-center justify-center rounded-lg border border-surface-4 bg-surface-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary lg:flex"
            @click="showLeftSidebar = !showLeftSidebar"
          >
            <ChevronLeft v-if="showLeftSidebar" :size="16" />
            <ChevronRight v-else :size="16" />
          </button>

          <div class="h-4 w-[1px] bg-surface-4"></div>

          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <Users :size="16" class="text-accent" />
              <h3 class="truncate text-sm font-bold text-text-primary">{{ tr('Meeting') }}</h3>
              <div v-if="review.loading.value" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">
                <Spinner :size="12" />
                <span class="text-[10px] font-bold uppercase tracking-wider">{{ tr('Speaking') }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <BaseButton
            v-if="!review.meetingEnded.value && (review.messages.value.some(m => m.role !== 'system') || queueItems.length > 0)"
            variant="danger"
            size="sm"
            class="!h-8"
            @click="endMeetingNow"
          >
            <Square :size="13" />
            <span>{{ tr('End Meeting') }}</span>
          </BaseButton>
          <div class="hidden items-center gap-1.5 rounded-full border border-surface-4 bg-surface-2 px-3 py-1.5 md:flex">
            <FileText :size="12" class="text-text-muted" />
            <span class="max-w-[150px] truncate text-[11px] font-medium text-text-secondary">{{ activeChapterTitle }}</span>
          </div>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-4 bg-surface-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
            @click="showRightSidebar = !showRightSidebar"
          >
            <Users :size="16" />
          </button>
        </div>
      </header>

      <div
        v-if="(review.pendingProposal.value && hiddenProposalId === review.pendingProposal.value.id) || (review.changeVoteSession.value && hiddenChangeVoteId === review.changeVoteSession.value.id)"
        class="border-b border-surface-4 bg-surface-1/70 px-6 py-2"
      >
        <div class="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
          <button
            v-if="review.pendingProposal.value && hiddenProposalId === review.pendingProposal.value.id"
            class="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/5 px-3 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/10"
            @click="reopenProposalBanner"
          >
            <Sparkles :size="12" />
            <span>{{ tr('Show focus proposal') }}</span>
          </button>
          <button
            v-if="review.changeVoteSession.value && hiddenChangeVoteId === review.changeVoteSession.value.id"
            class="inline-flex items-center gap-2 rounded-full border border-warning/25 bg-warning/5 px-3 py-1 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/10"
            @click="reopenChangeVoteBanner"
          >
            <FileText :size="12" />
            <span>{{ tr('Show project change vote') }}</span>
          </button>
        </div>
      </div>

      <!-- Proposal Banner -->
      <transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="transform -translate-y-4 opacity-0"
        enter-to-class="transform translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="transform translate-y-0 opacity-100"
        leave-to-class="transform -translate-y-4 opacity-0"
      >
        <div v-if="visiblePendingProposal" class="z-10 bg-accent/10 border-b border-accent/20 px-6 py-4 shadow-sm">
          <div class="mx-auto max-w-4xl flex items-start gap-4">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-lg shadow-accent/20">
              <Sparkles :size="20" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold uppercase tracking-wider text-accent">{{ visiblePendingProposal.agentName }}</span>
                <span class="text-xs text-text-muted">{{ tr('proposes a change') }}</span>
              </div>
              <div class="mt-1 flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold text-text-primary">
                    {{ tr('Update Meeting Focus') }}
                  </p>
                  <p v-if="!isProposalBannerCollapsed" class="mt-1 text-sm text-text-secondary italic leading-relaxed">
                    "{{ visiblePendingProposal.content }}"
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-white/60 text-text-muted transition-colors hover:text-text-primary"
                    @click="isProposalBannerCollapsed = !isProposalBannerCollapsed"
                  >
                    <ChevronDown :size="16" class="transition-transform" :class="isProposalBannerCollapsed ? '-rotate-90' : ''" />
                  </button>
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-white/60 text-text-muted transition-colors hover:text-danger"
                    @click="hideCurrentProposalBanner"
                  >
                    <X :size="15" />
                  </button>
                </div>
              </div>
              <div v-if="!isProposalBannerCollapsed" class="mt-4 flex items-center gap-3">
                <div class="flex-1"></div>
                <div class="flex gap-2">
                  <BaseButton variant="ghost" size="sm" class="!h-9" @click="rejectProposalWithReason">
                    {{ tr('Reject') }}
                  </BaseButton>
                  <BaseButton variant="primary" size="sm" class="!h-9 px-6" @click="review.approveProposal">
                    {{ tr('Approve') }}
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- Change Vote Banner -->
      <transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="transform -translate-y-4 opacity-0"
        enter-to-class="transform translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="transform translate-y-0 opacity-100"
        leave-to-class="transform -translate-y-4 opacity-0"
      >
        <div v-if="visibleChangeVoteSession" class="z-10 border-b border-accent/20 bg-accent/10 px-6 py-4 shadow-sm">
          <div class="mx-auto max-w-4xl">
            <div class="flex items-start gap-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-lg shadow-accent/20">
                <Sparkles :size="20" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-xs font-bold uppercase tracking-wider text-accent">{{ visibleChangeVoteSession.requestedByAgentName }}</span>
                      <span class="text-xs text-text-muted">{{ tr(visibleChangeVoteSession.request.target === 'consensus' ? 'requested a meeting consensus' : 'requested a project change') }}</span>
                      <BaseTag variant="accent" size="sm">{{ tr(visibleChangeVoteSession.request.target) }}</BaseTag>
                      <BaseTag
                        :variant="changeVoteTagVariant(visibleChangeVoteSession.status)"
                        size="sm"
                      >
                        {{ changeVoteStatusLabel(visibleChangeVoteSession.status) }}
                      </BaseTag>
                    </div>
                    <p class="mt-1 text-sm font-semibold text-text-primary">{{ visibleChangeVoteSession.request.scope }}</p>
                    <p v-if="!isChangeVoteBannerCollapsed" class="mt-1 text-sm leading-relaxed text-text-secondary">{{ visibleChangeVoteSession.request.purpose }}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <button
                      class="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-white/60 text-text-muted transition-colors hover:text-text-primary"
                      @click="isChangeVoteBannerCollapsed = !isChangeVoteBannerCollapsed"
                    >
                      <ChevronDown :size="16" class="transition-transform" :class="isChangeVoteBannerCollapsed ? '-rotate-90' : ''" />
                    </button>
                    <button
                      class="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-white/60 text-text-muted transition-colors hover:text-danger"
                      @click="hideCurrentChangeVoteBanner"
                    >
                      <X :size="15" />
                    </button>
                  </div>
                </div>
                <div v-if="!isChangeVoteBannerCollapsed">
                  <p class="mt-1 text-xs leading-relaxed text-text-muted">
                    {{ tr('Project changes are voted on by meeting agents and applied automatically by the project change tool after majority approval.') }}
                  </p>

                  <div v-if="visibleChangeVoteSession.votes.length" class="mt-3 grid gap-2 sm:grid-cols-2">
                    <div
                      v-for="vote in visibleChangeVoteSession.votes"
                      :key="`${vote.agentId}-${vote.createdAt}`"
                      class="rounded-xl border border-surface-4 bg-surface-1/70 px-3 py-2"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate text-xs font-semibold text-text-primary">{{ tr(vote.agentName) }}</span>
                        <BaseTag :variant="vote.vote === 'approve' ? 'success' : 'warning'" size="sm">{{ tr(vote.vote === 'approve' ? 'Approve' : 'Reject') }}</BaseTag>
                      </div>
                      <p class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{{ vote.reason }}</p>
                    </div>
                  </div>

                  <div v-if="visibleChangeVoteSession.result || visibleChangeVoteSession.error" class="mt-3 rounded-xl border border-surface-4 bg-surface-1/70 px-3 py-2 text-xs text-text-secondary">
                    {{ visibleChangeVoteSession.result || visibleChangeVoteSession.error }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- End Vote Banner -->
      <transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="transform -translate-y-4 opacity-0"
        enter-to-class="transform translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="transform translate-y-0 opacity-100"
        leave-to-class="transform -translate-y-4 opacity-0"
      >
        <div v-if="review.endVoteSession.value" class="z-10 border-b border-warning/25 bg-warning/10 px-6 py-4 shadow-sm">
          <div class="mx-auto max-w-4xl">
            <div class="flex items-start gap-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning text-white shadow-lg shadow-warning/20">
                <ShieldAlert :size="20" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs font-bold uppercase tracking-wider text-warning">{{ review.endVoteSession.value.requestedByAgentName }}</span>
                  <span class="text-xs text-text-muted">{{ tr('requested ending the meeting') }}</span>
                  <BaseTag variant="warning" size="sm">
                    {{ review.endVoteSession.value.votes.length }}/{{ review.agents.value.filter(agent => agent.enabled).length }} {{ tr('votes') }}
                  </BaseTag>
                </div>
                <p class="mt-1 text-sm font-semibold text-text-primary">{{ tr(review.endVoteSession.value.status === 'voting' ? 'Agent voting in progress' : 'Agent voting complete') }}</p>
                <p class="mt-1 text-sm leading-relaxed text-text-secondary italic">"{{ review.endVoteSession.value.reason }}"</p>
                <p class="mt-1 text-xs leading-relaxed text-text-muted">
                  {{ tr('End voting runs in the background. You can keep reviewing changes and decide later.') }}
                </p>

                <div v-if="review.endVoteSession.value.votes.length" class="mt-3 grid gap-2 sm:grid-cols-2">
                  <div
                    v-for="vote in review.endVoteSession.value.votes"
                    :key="`${vote.agentId}-${vote.createdAt}`"
                    class="rounded-xl border border-surface-4 bg-surface-1/70 px-3 py-2"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="truncate text-xs font-semibold text-text-primary">{{ tr(vote.agentName) }}</span>
                      <BaseTag :variant="vote.vote === 'approve' ? 'success' : 'warning'" size="sm">{{ tr(vote.vote === 'approve' ? 'Approve' : 'Reject') }}</BaseTag>
                    </div>
                    <p class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{{ vote.reason }}</p>
                  </div>
                </div>

                <div v-if="review.endVoteSession.value.status === 'ready'" class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    v-model="continueReason"
                    class="h-9 flex-1 rounded-xl border border-surface-4 bg-surface-1 px-3 text-sm text-text-primary outline-none focus:border-warning/60"
                    :placeholder="tr('Reject reason is required to continue discussing...')"
                  />
                  <div class="flex gap-2">
                    <BaseButton variant="ghost" size="sm" class="!h-9" :disabled="!continueReason.trim()" @click="rejectEndVoteWithReason">
                      {{ tr('Continue Discussion') }}
                    </BaseButton>
                    <BaseButton variant="danger" size="sm" class="!h-9 px-6" @click="review.approveEndVoteSession">
                      {{ tr('End Meeting') }}
                    </BaseButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- Chat Area -->
      <div class="flex-1 overflow-y-auto custom-scrollbar bg-surface-0/50">
        <div class="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
          <div v-if="!review.messages.value.length" class="flex flex-col items-center justify-center py-20 text-center">
            <div class="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-2 text-surface-5 mb-6">
              <MessageSquare :size="40" stroke-width="1.5" />
            </div>
            <h4 class="text-lg font-bold text-text-primary">{{ tr('Start the Meeting') }}</h4>
            <p class="mt-2 max-w-sm text-sm text-text-muted leading-relaxed">
              {{ tr('Choose your context elements and describe an opening topic to begin the multi-agent discussion.') }}
            </p>
            <BaseButton variant="primary" size="md" class="mt-8 px-8" @click="startMeetingRound">
              <Sparkles :size="18" class="mr-2" />
              <span>{{ tr('Open Meeting') }}</span>
            </BaseButton>
          </div>

          <article
            v-for="(message, index) in review.messages.value"
            :key="message.id"
            class="group relative animate-in fade-in slide-in-from-bottom-2 duration-500"
            :style="{ animationDelay: `${index * 50}ms` }"
          >
            <!-- System Message -->
            <div v-if="message.role === 'system'" class="flex justify-center">
              <div class="max-w-[85%] rounded-2xl bg-surface-2 px-4 py-2 border border-surface-4 shadow-sm">
                <p class="text-[10px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-2">
                  <Info :size="12" />
                  {{ cleanMessage(message.content) }}
                </p>
                <details v-if="message.changeVoteSnapshot" class="mt-3 overflow-hidden rounded-xl border border-surface-4 bg-surface-1/80 text-left">
                  <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-text-primary">
                    <span>{{ tr('Proposal Vote Details') }}</span>
                    <div class="flex items-center gap-2">
                      <BaseTag :variant="changeVoteTagVariant(message.changeVoteSnapshot.status)" size="sm">
                        {{ changeVoteStatusLabel(message.changeVoteSnapshot.status) }}
                      </BaseTag>
                      <ChevronDown :size="14" class="text-text-muted" />
                    </div>
                  </summary>
                  <div class="border-t border-surface-4 px-4 py-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <BaseTag variant="accent" size="sm">{{ tr(message.changeVoteSnapshot.request.target) }}</BaseTag>
                      <span class="text-[11px] text-text-muted">{{ tr('Requested by') }} {{ message.changeVoteSnapshot.requestedByAgentName }}</span>
                    </div>
                    <p class="mt-2 text-sm font-semibold text-text-primary">{{ message.changeVoteSnapshot.request.scope }}</p>
                    <p class="mt-1 text-xs leading-relaxed text-text-secondary">{{ message.changeVoteSnapshot.request.purpose }}</p>
                    <div v-if="message.changeVoteSnapshot.votes.length" class="mt-3 grid gap-2 sm:grid-cols-2">
                      <div
                        v-for="vote in message.changeVoteSnapshot.votes"
                        :key="`${message.id}-${vote.agentId}-${vote.createdAt}`"
                        class="rounded-xl border border-surface-4 bg-surface-0/70 px-3 py-2"
                      >
                        <div class="flex items-center justify-between gap-2">
                          <span class="truncate text-xs font-semibold text-text-primary">{{ tr(vote.agentName) }}</span>
                          <BaseTag :variant="vote.vote === 'approve' ? 'success' : 'warning'" size="sm">{{ tr(vote.vote === 'approve' ? 'Approve' : 'Reject') }}</BaseTag>
                        </div>
                        <p class="mt-1 text-[11px] leading-relaxed text-text-muted">{{ vote.reason }}</p>
                      </div>
                    </div>
                    <div v-if="message.changeVoteSnapshot.result || message.changeVoteSnapshot.error" class="mt-3 rounded-xl border border-surface-4 bg-surface-0/70 px-3 py-2 text-xs text-text-secondary">
                      {{ message.changeVoteSnapshot.result || message.changeVoteSnapshot.error }}
                    </div>
                  </div>
                </details>
                <div v-if="message.tool" class="mt-3 border-t border-surface-4/50 pt-3 text-left">
                  <ToolCallStatus :item="message.tool" />
                </div>
              </div>
            </div>

            <!-- User/Agent Message -->
            <div v-else class="flex flex-col" :class="message.role === 'user' ? 'items-end' : 'items-start'">
              <div class="flex items-center gap-2 mb-2 px-1">
                <template v-if="message.role === 'user'">
                  <span class="text-[10px] text-text-muted">{{ new Date(message.createdAt).toLocaleTimeString() }}</span>
                  <span class="text-xs font-bold text-accent">{{ tr('You') }}</span>
                  <div class="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <User :size="12" stroke-width="3" />
                  </div>
                </template>
                <template v-else>
                  <div class="flex h-6 w-6 items-center justify-center rounded-lg bg-success/10 text-success">
                    <Bot :size="12" stroke-width="2" />
                  </div>
                  <span class="text-xs font-bold text-text-primary">{{ messageSpeaker(message) }}</span>
                  <BaseTag variant="default" size="sm" class="!px-1 !py-0 !text-[8px] uppercase tracking-tighter">{{ tr('Public') }}</BaseTag>
                  <span class="text-[10px] text-text-muted">{{ new Date(message.createdAt).toLocaleTimeString() }}</span>
                </template>
              </div>

              <div
                class="relative max-w-[85%] rounded-2xl border px-5 py-4 shadow-sm transition-all"
                :class="[
                  message.role === 'user'
                    ? 'rounded-tr-none border-accent/20 bg-accent/5 text-text-primary shadow-accent/5'
                    : 'rounded-tl-none border-surface-4 bg-surface-1 text-text-secondary'
                ]"
              >
                <p v-if="cleanMessage(message.content)" class="whitespace-pre-wrap text-sm leading-relaxed">{{ cleanMessage(message.content) }}</p>

                <div v-if="message.tool" class="mt-4 border-t border-surface-4/50 pt-4">
                  <ToolCallStatus :item="message.tool" />
                </div>

                <div v-if="referenceLinks(message.content).length" class="mt-4 flex flex-wrap gap-2 border-t border-surface-4/50 pt-3">
                  <button
                    v-for="link in referenceLinks(message.content)"
                    :key="`${message.id}-${link.element}-${link.label}`"
                    class="group/link flex items-center gap-1.5 rounded-lg border border-surface-4 bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-text-secondary transition-all hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
                    @click="openReference(link.element)"
                  >
                    <FileText :size="12" class="text-text-muted group-hover/link:text-accent" />
                    <span>{{ link.label }}</span>
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- Thinking Indicators -->
          <div v-if="review.loading.value" class="space-y-4">
            <div
              v-for="agentId in review.activeSpeakerIds.value"
              :key="agentId"
              class="flex items-center gap-2 px-1 text-xs text-text-muted animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <Spinner :size="12" />
              <span class="font-semibold text-text-secondary">{{ tr(review.agents.value.find(a => a.id === agentId)?.name || 'Agent') }}</span>
              <span>{{ tr('is thinking...') }}</span>
            </div>
          </div>

          <div ref="chatEndRef" class="h-4"></div>
        </div>
      </div>

      <!-- Input Section -->
      <footer class="shrink-0 border-t border-surface-4 bg-surface-1/50 p-6 backdrop-blur-sm">
        <div class="mx-auto max-w-4xl relative">
          <!-- Status Banner -->
          <transition name="slide-up">
            <div v-if="review.userTyping.value" class="absolute -top-8 left-0 right-0 flex items-center justify-center gap-2 text-[10px] font-medium text-warning animate-pulse">
              <PauseCircle :size="12" />
              <span>{{ tr('Input active: queued agents paused') }}</span>
            </div>
          </transition>

          <div class="relative flex items-end gap-3 rounded-2xl border border-surface-4 bg-surface-2 p-3 shadow-xl transition-all focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/5">
            <div
              v-if="review.askUserSession.value?.status === 'ready'"
              class="absolute bottom-full left-0 right-0 mb-3 rounded-2xl border border-accent/25 bg-surface-2 p-4 shadow-xl"
            >
              <div class="flex items-start gap-3">
                <Info :size="16" class="mt-0.5 shrink-0 text-accent" />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold uppercase tracking-widest text-accent">{{ tr('User clarification needed') }}</p>
                  <p class="mt-1 text-sm font-semibold text-text-primary">{{ review.askUserSession.value.request.question }}</p>
                  <p class="mt-1 text-xs leading-relaxed text-text-muted">{{ review.askUserSession.value.request.reason }}</p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      v-for="option in review.askUserSession.value.request.options"
                      :key="option"
                      class="rounded-xl border border-surface-4 bg-surface-1 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                      @click="review.answerAskUser(option)"
                    >
                      {{ option }}
                    </button>
                  </div>
                  <p class="mt-2 text-[10px] text-text-muted">{{ tr('Or type a custom answer in the message box.') }}</p>
                </div>
              </div>
            </div>
            <textarea
              ref="inputTextarea"
              :value="review.inputText.value"
              rows="2"
              class="min-h-[48px] max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted custom-scrollbar"
              :placeholder="tr('Add a high-priority user message to the meeting...')"
              @input="review.handleInput(($event.target as HTMLTextAreaElement).value)"
              @keydown.ctrl.enter.prevent="submitUserMessage"
            ></textarea>
            <button
              :disabled="!review.inputText.value.trim() && !review.loading.value"
              class="grid h-10 w-10 shrink-0 place-items-center rounded-full p-0 text-white shadow-sm transition-all hover:shadow-lg active:scale-95 disabled:bg-surface-4 disabled:text-text-muted disabled:shadow-none"
              :class="review.loading.value ? 'bg-warning shadow-warning/20 hover:shadow-warning/25' : 'bg-accent shadow-accent/20 hover:shadow-accent/25'"
              :title="tr(review.loading.value ? 'Processing...' : 'Send')"
              @click="submitUserMessage"
            >
              <ArrowUp :size="20" stroke-width="2.5" />
            </button>
          </div>

          <div class="mt-3 flex items-center justify-between px-2">
            <div class="flex items-center gap-3">
              <p class="text-[9px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Ctrl + Enter to send') }}</p>
              <div v-if="review.meetingEnded.value" class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 text-success">
                <Check :size="10" />
                <span class="text-[9px] font-bold uppercase">{{ tr('Meeting Ended') }}</span>
              </div>
              <div v-else-if="!review.loading.value && !queueItems.length" class="flex items-center gap-2">
                <span class="text-[9px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Meeting Idle') }}</span>
                <button 
                  class="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase text-accent transition-colors hover:bg-accent/20"
                  @click="startMeetingRound"
                >
                  <RotateCcw :size="10" />
                  <span>{{ tr('Trigger Next Round') }}</span>
                </button>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <button class="text-[10px] text-text-muted hover:text-accent flex items-center gap-1 transition-colors" @click="review.clearConversation">
                <RotateCcw :size="10" />
                <span>{{ tr('Clear History') }}</span>
              </button>
            </div>
          </div>
        </div>
      </footer>
    </main>

    <MeetingParticipantsSidebar
      :show="showRightSidebar"
      :agents="review.agents.value"
      :queue-agent-ids="queueItems.map(item => item.agentId)"
      :status-meta="statusMeta"
      @restore-default="showRestoreAgentsConfirm = true"
      @add-agent="showAddAgentDialog = true"
      @set-agent-enabled="(agentId, enabled) => review.setAgentEnabled(agentId, enabled)"
      @open-agent-settings="openAgentSettings"
      @delete-agent="review.deleteAgent"
      @ask-next="agentId => review.userRequestTurn(agentId, review.inputText.value)"
    />

    <BaseDialog :model-value="Boolean(editingAgentId)" :title="tr('Agent Settings')" width="720px" @update:model-value="value => { if (!value) editingAgentId = null }" @close="editingAgentId = null">
      <div v-if="editingAgent" class="space-y-6 py-2">
        <div class="flex items-center gap-4 rounded-2xl border border-surface-4 bg-surface-2 p-4">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Bot :size="24" />
          </div>
          <div>
            <h4 class="text-base font-bold text-text-primary">{{ tr(editingAgent.name) }}</h4>
            <p class="text-xs text-text-muted">{{ tr(editingAgent.role) }}</p>
          </div>
        </div>

        <div class="space-y-3">
          <label class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-text-secondary">
            <Brain :size="14" />
            {{ tr('Model Configuration') }}
          </label>
          <VibeModelPicker v-model="agentModelDraft" :role="editingAgent.defaultModelRole" />
          <p class="text-[10px] leading-relaxed text-text-muted">
            {{ tr('Agent model selection is saved in the project. If the selected provider or model is unavailable, the agent falls back to its Default Model Role binding.') }}
          </p>
        </div>

        <div class="space-y-3">
          <label class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-text-secondary">
            <LayoutList :size="14" />
            {{ tr('Agent System Prompt') }}
          </label>
          <textarea
            v-model="agentPromptDraft"
            rows="12"
            class="w-full resize-y rounded-2xl border border-surface-4 bg-surface-1 px-4 py-3 text-sm leading-relaxed text-text-primary outline-none transition-all focus:border-accent/50 focus:ring-4 focus:ring-accent/5"
          ></textarea>
          <p class="text-[10px] text-text-muted leading-relaxed">
            {{ tr('Modifying the system prompt changes the agent\'s behavior and persona. Use with care.') }}
          </p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="ghost" size="md" class="px-6" @click="editingAgentId = null">{{ tr('Cancel') }}</BaseButton>
          <BaseButton variant="primary" size="md" class="px-8 shadow-lg shadow-accent/10" @click="saveAgentSettings">{{ tr('Save Changes') }}</BaseButton>
        </div>
      </template>
    </BaseDialog>

    <BaseDialog v-model="showAddAgentDialog" title="Add Agent" width="680px">
      <div class="space-y-4 py-2">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-2 block text-xs font-semibold text-text-secondary">{{ tr('Agent Name') }}</label>
            <input v-model="newAgentName" class="h-10 w-full rounded-xl border border-surface-4 bg-surface-2 px-3 text-sm text-text-primary outline-none focus:border-accent/50" :placeholder="tr('e.g. Lore Auditor')" />
          </div>
          <div>
            <label class="mb-2 block text-xs font-semibold text-text-secondary">{{ tr('Agent Role') }}</label>
            <input v-model="newAgentRole" class="h-10 w-full rounded-xl border border-surface-4 bg-surface-2 px-3 text-sm text-text-primary outline-none focus:border-accent/50" :placeholder="tr('e.g. Worldbuilding consistency')" />
          </div>
        </div>
        <div>
          <label class="mb-2 block text-xs font-semibold text-text-secondary">{{ tr('Agent Brief') }}</label>
          <input v-model="newAgentBrief" class="h-10 w-full rounded-xl border border-surface-4 bg-surface-2 px-3 text-sm text-text-primary outline-none focus:border-accent/50" :placeholder="tr('Short description shown in the participant list')" />
        </div>
        <div>
          <label class="mb-2 block text-xs font-semibold text-text-secondary">{{ tr('Default Model Role') }}</label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="h-9 rounded-lg border text-sm transition-colors" :class="newAgentModelRole === 'chapterPlanner' ? 'border-accent bg-accent/10 text-accent' : 'border-surface-4 bg-surface-2 text-text-secondary'" @click="newAgentModelRole = 'chapterPlanner'">
              {{ tr('Chapter Planner') }}
            </button>
            <button type="button" class="h-9 rounded-lg border text-sm transition-colors" :class="newAgentModelRole === 'proofreader' ? 'border-accent bg-accent/10 text-accent' : 'border-surface-4 bg-surface-2 text-text-secondary'" @click="newAgentModelRole = 'proofreader'">
              {{ tr('Proofreader') }}
            </button>
          </div>
          <p class="mt-2 text-[10px] leading-relaxed text-text-muted">
            {{ tr('Default Model Role only selects the fallback provider role binding for this agent. It is not the agent persona and it does not store a concrete model in the project file.') }}
          </p>
        </div>
        <div>
          <label class="mb-2 block text-xs font-semibold text-text-secondary">{{ tr('Agent System Prompt') }}</label>
          <textarea v-model="newAgentPrompt" rows="8" class="w-full resize-y rounded-2xl border border-surface-4 bg-surface-2 px-3 py-2 text-sm leading-relaxed text-text-primary outline-none focus:border-accent/50" :placeholder="tr('Define this agent persona, scope, and meeting behavior...')"></textarea>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="ghost" size="md" class="px-6" @click="showAddAgentDialog = false">{{ tr('Cancel') }}</BaseButton>
          <BaseButton variant="primary" size="md" class="px-8" :disabled="!newAgentName.trim()" @click="addAgentFromDialog">{{ tr('Add Agent') }}</BaseButton>
        </div>
      </template>
    </BaseDialog>

    <ConfirmDialog
      :model-value="showRestoreAgentsConfirm"
      :title="tr('Restore default agents')"
      :message="tr('This will remove custom meeting agents and restore the default participant list. The built-in Meeting Proposer Agent is managed separately in Settings and Agent Binding.')"
      :confirm-text="tr('Restore')"
      :cancel-text="tr('Cancel')"
      variant="danger"
      @update:model-value="showRestoreAgentsConfirm = $event"
      @confirm="confirmRestoreDefaultAgents"
      @cancel="showRestoreAgentsConfirm = false"
    />

    <ConfirmDialog
      :model-value="showResetConfirm"
      :title="tr('Reset meeting')"
      :message="tr('This will stop all active meeting turns, clear the current discussion history, and reset the meeting state for this project. Continue?')"
      :confirm-text="tr('Reset')"
      :cancel-text="tr('Cancel')"
      variant="danger"
      @update:model-value="showResetConfirm = $event"
      @confirm="confirmResetConversation"
      @cancel="showResetConfirm = false"
    />
  </div>
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

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

</style>
