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
import AgentAvatar from './review/AgentAvatar.vue'
import ProposalCard from './review/ProposalCard.vue'
import { stripMeetingControlBlocks } from '@/services/review/utils'
import { Bot, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Info, LayoutList, MessageSquare, PauseCircle, RotateCcw, Sparkles, User, Users, ArrowUp, Square } from 'lucide-vue-next'

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
const inputTextarea = ref<HTMLTextAreaElement | null>(null)
const editingAgentId = ref<string | null>(null)
const agentPromptDraft = ref('')
const agentModelDraft = ref('')
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
  { key: 'chapter-plan-overview', label: 'All Chapter Plans', detail: 'Cross-chapter planning progress and status summary' },
  { key: 'selected-chapter', label: 'Selected Chapter', detail: 'Chapter title, status, summary' },
  { key: 'chapter-plan', label: 'Chapter Plan', detail: 'Structured chapter planning fields' },
  { key: 'chapter-draft', label: 'Chapter Draft', detail: 'Existing draft text if available' },
]

const referenceLabelMap: Record<ReviewContextElement, string> = {
  'story-config': 'Story Configuration',
  'master-outline': 'Master Outline',
  'characters': 'Characters',
  'knowledge-base': 'Knowledge Base',
  'chapter-plan-overview': 'All Chapter Plans',
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

type ProcessedMessage = ReviewPublicMessage & {
  _clean: string
  _refs: { element: string; label: string }[]
}

function normalizeActionSnapshot(msg: any) {
  if (msg.actionVoteSnapshot) return msg.actionVoteSnapshot
  const snapshot = msg.actionSnapshot
  if (!snapshot?.request) return undefined
  return {
    id: snapshot.id,
    requestedByAgentId: snapshot.proposedByAgentId,
    requestedByAgentName: snapshot.proposedByAgentName,
    request: snapshot.request,
    status: snapshot.status === 'running'
      ? 'applying'
      : snapshot.status === 'applied'
        ? 'applied'
        : snapshot.status === 'failed'
          ? 'failed'
          : 'rejected',
    votes: [],
    result: snapshot.result,
    error: snapshot.error,
    createdAt: snapshot.createdAt,
    completedAt: snapshot.completedAt,
    executionTimeline: [],
    executionLedger: [],
  }
}

const processedMessages = computed((): ProcessedMessage[] =>
  review.messages.value.map(msg => ({
    ...msg,
    actionVoteSnapshot: normalizeActionSnapshot(msg),
    _clean: cleanMessage(msg.content),
    _refs: referenceLinks(msg.content),
  }))
)

type SystemGroup = {
  messages: ProcessedMessage[]
  hasVote: boolean
  lastVoteMessage: ProcessedMessage | undefined
}

type ChatItem = { type: 'message'; message: ProcessedMessage } | { type: 'system-group'; group: SystemGroup }

const groupedMessages = computed((): ChatItem[] => {
  const result: ChatItem[] = []
  let currentSystemMsgs: ProcessedMessage[] = []

  for (const msg of processedMessages.value) {
    if (msg.role === 'system') {
      currentSystemMsgs.push(msg)
    } else {
      if (currentSystemMsgs.length) {
        const voteMsg = currentSystemMsgs.find(m => m.actionVoteSnapshot && m.actionVoteSnapshot.status !== 'applied' && m.actionVoteSnapshot.status !== 'rejected' && m.actionVoteSnapshot.status !== 'failed')
        result.push({
          type: 'system-group',
          group: { messages: currentSystemMsgs, hasVote: Boolean(voteMsg), lastVoteMessage: voteMsg },
        })
        currentSystemMsgs = []
      }
      result.push({ type: 'message', message: msg })
    }
  }
  if (currentSystemMsgs.length) {
    const voteMsg = currentSystemMsgs.find(m => m.actionVoteSnapshot && m.actionVoteSnapshot.status !== 'applied' && m.actionVoteSnapshot.status !== 'rejected' && m.actionVoteSnapshot.status !== 'failed')
    result.push({
      type: 'system-group',
      group: { messages: currentSystemMsgs, hasVote: Boolean(voteMsg), lastVoteMessage: voteMsg },
    })
  }
  return result
})

const WINDOW_SIZE = 60
const renderWindowStart = ref(Math.max(0, groupedMessages.value.length - WINDOW_SIZE))
watch(groupedMessages, (items) => {
  // Auto-scroll: when new messages arrive, keep window at end
  if (renderWindowStart.value + WINDOW_SIZE >= items.length - 1) {
    renderWindowStart.value = Math.max(0, items.length - WINDOW_SIZE)
  }
}, { deep: false, flush: 'post' })

const visibleItems = computed(() => groupedMessages.value.slice(renderWindowStart.value))
const olderCount = computed(() => renderWindowStart.value)

function loadOlderMessages() {
  const newStart = Math.max(0, renderWindowStart.value - WINDOW_SIZE)
  renderWindowStart.value = newStart
  nextTick(() => {
    document.getElementById('chat-scroll-anchor')?.scrollIntoView({ behavior: 'instant', block: 'start' })
  })
}



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

function speakerKey(message: ReviewPublicMessage) {
  if (message.role === 'agent') return `agent:${message.agentId || message.agentName}`
  if (message.role === 'user') return 'user'
  return `system:${message.content.slice(0, 40)}`
}

function isSameSpeakerAsPrevious(currentItem: ChatItem, index: number) {
  if (index === 0) return false
  const prev = visibleItems.value[index - 1]
  if (prev.type !== 'message' || currentItem.type !== 'message') return false
  return speakerKey(prev.message) === speakerKey(currentItem.message)
}

function referenceLinks(content: string) {
  const matches = [...content.matchAll(/\[\[([a-z-]+)(?::([^\]]+))?\]\]/gi)]
  return matches.map(match => ({
    element: match[1],
    label: match[2] || referenceLabelMap[match[1] as ReviewContextElement] || match[1],
  }))
}

function cleanMessage(content: string) {
  return stripMeetingControlBlocks(content)
    .replace(/\[\[([a-z-]+):([^\]]+)\]\]/gi, '$2')
    .replace(/\[\[([a-z-]+)\]\]/gi, (_match, element: string) => referenceLabelMap[element as ReviewContextElement] || element)
    .replace(/\[End vote:\s*(?:Approve|Reject)\]/gi, '')
    .replace(/\[Change vote:\s*(?:Approve|Reject)\]/gi, '')
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
  if (element === 'chapter-plan-overview') {
    ui.setWorkspaceNode('generation-chapter-outline')
    return
  }
  if (element === 'selected-chapter' || element === 'chapter-draft') {
    ui.setWorkspaceNode(props.chapter?.id ? `chapter-${props.chapter.id}` : 'generation-writing')
  }
}



function submitUserMessage() {
  void review.sendUserMessage()
}

function startMeetingRound() {
  review.requestAllAgents(review.currentFocus.value, { mandatoryBrainstorm: false })
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



function confirmRestoreDefaultAgents() {
  showRestoreAgentsConfirm.value = false
  void review.restoreDefaultAgents()
}

function confirmResetConversation() {
  showResetConfirm.value = false
  review.clearConversation()
}



watch(() => review.messages.value.length, async () => {
  await nextTick()
  chatEndRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
})


</script>

<template>
  <div class="relative flex h-full min-h-0 overflow-hidden bg-surface-0">
      <MeetingSettingsSidebar
      :show="showLeftSidebar"
      :focus="review.currentFocus.value"
      :context-options="contextOptions"
      :selected-context-elements="review.selectedContextElements.value"
      :queue-items="queueItems"
      :loading="review.loading.value"
      :auto-continue="review.autoContinue.value"
      :max-auto-rounds="review.maxAutoRounds.value"
      :round-count="review.roundCount.value"
      :verification-status="review.verificationSession.value?.status"
      :verification-reason="review.verificationSession.value?.reason"
      @update:show="showLeftSidebar = $event"
      @update:focus="review.currentFocus.value = $event"
      @update:auto-continue="review.setAutoContinue($event)"
      @update:max-auto-rounds="review.setMaxAutoRounds($event)"
      @toggle-context="toggleContextElement"
      @reset="showResetConfirm = true"
      @start="startMeetingRound"
    />

    <!-- Main Content: Chat Stream -->
    <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Top Header -->
      <header class="flex h-[44px] shrink-0 items-center justify-between border-b border-surface-4 bg-surface-1/80 px-3 backdrop-blur-md">
        <div class="flex min-w-0 items-center gap-2">
          <button
            class="flex h-7 w-7 items-center justify-center rounded-lg border border-surface-4 bg-surface-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
            @click="showLeftSidebar = !showLeftSidebar"
          >
            <ChevronLeft v-if="showLeftSidebar" :size="14" />
            <ChevronRight v-else :size="14" />
          </button>

          <div class="h-3 w-[1px] bg-surface-4"></div>

          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <Users :size="14" class="text-accent" />
              <h3 class="truncate text-xs font-bold text-text-primary">{{ tr('Meeting') }}</h3>
              <div v-if="review.loading.value" class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                <Spinner :size="10" />
                <span class="text-[9px] font-bold uppercase tracking-wider">{{ tr('Active') }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <BaseButton
            v-if="!review.meetingEnded.value && (review.messages.value.some(m => m.role !== 'system') || queueItems.length > 0)"
            variant="danger"
            size="sm"
            class="!h-7 !px-2 !text-[10px]"
            @click="endMeetingNow"
          >
            <Square :size="11" />
            <span>{{ tr('End') }}</span>
          </BaseButton>
          <div class="hidden items-center gap-1 rounded-full border border-surface-4 bg-surface-2 px-2 py-1 md:flex">
            <FileText :size="10" class="text-text-muted" />
            <span class="max-w-[120px] truncate text-[10px] font-medium text-text-secondary">{{ activeChapterTitle }}</span>
          </div>
          <button
            class="flex h-7 w-7 items-center justify-center rounded-lg border border-surface-4 bg-surface-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
            @click="showRightSidebar = !showRightSidebar"
          >
            <Users :size="14" />
          </button>
        </div>
      </header>

      <!-- Chat Area -->
      <div class="flex-1 overflow-y-auto custom-scrollbar">
        <div class="mx-auto flex max-w-4xl flex-col gap-1 px-4 py-5">
          <div v-if="!review.messages.value.length && !review.pendingProposal.value && !review.actionVoteSession.value && !review.endVoteSession.value" class="flex flex-col items-center justify-center py-20 text-center">
            <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-text-muted mb-4">
              <MessageSquare :size="28" stroke-width="1.5" />
            </div>
            <h4 class="text-sm font-bold text-text-primary">{{ tr('Start the Meeting') }}</h4>
            <p class="mt-1.5 max-w-xs text-xs text-text-muted leading-relaxed">
              {{ tr('Choose context elements and describe a topic to begin the multi-agent discussion.') }}
            </p>
            <BaseButton variant="primary" size="md" class="mt-6 px-6" @click="startMeetingRound">
              <Sparkles :size="14" class="mr-1.5" />
              <span>{{ tr('Open Meeting') }}</span>
            </BaseButton>
          </div>

          <div v-if="olderCount > 0" class="flex justify-center py-2">
            <button
              class="flex items-center gap-1.5 rounded-full border border-surface-4 bg-surface-2 px-4 py-1.5 text-[10px] font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
              @click="loadOlderMessages"
            >
              <ChevronDown :size="12" class="rotate-180" />
              <span>{{ tr('Show') }} {{ olderCount > 60 ? `${Math.min(WINDOW_SIZE, olderCount)}` : olderCount }} {{ tr('older messages') }}</span>
            </button>
          </div>
          <div id="chat-scroll-anchor"></div>

          <template v-for="(item, index) in visibleItems" :key="item.type === 'system-group' ? `sg-${item.group.messages[0].id}` : item.message.id">
            <!-- System Group (collapsible) -->
            <template v-if="item.type === 'system-group'">
              <!-- Proposal Card for vote-carrying system messages -->
              <ProposalCard
                v-if="item.group.hasVote"
                variant="change"
                :change-vote="item.group.lastVoteMessage!.actionVoteSnapshot"
                :total-agents="review.agents.value.length"
                :enabled-agents="review.agents.value.filter(a => a.enabled).length"
                class="mt-4"
                @approve="review.approveProposal"
                @reject="(reason) => review.rejectProposal(reason)"
              />

              <details
                class="group flex flex-col"
                :class="index > 0 && visibleItems[index - 1].type !== 'system-group' ? 'mt-3' : ''"
              >
                <summary class="flex cursor-pointer list-none items-start gap-1.5 py-0.5 select-none">
                  <span class="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-surface-4 group-hover:bg-text-muted transition-colors"></span>
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <span class="shrink-0 text-[10px] font-medium text-text-muted/60">{{ item.group.messages.length }} msgs</span>
                    <p class="min-w-0 flex-1 truncate text-[11px] text-text-muted/60">
                      {{ item.group.messages[item.group.messages.length - 1]._clean }}
                    </p>
                  </div>
                  <ChevronDown :size="10" class="mt-1 shrink-0 text-text-muted/40 transition-transform group-open:rotate-180" />
                </summary>
                <div class="ml-2.5 space-y-0.5">
                  <div
                    v-for="sysMsg in item.group.messages"
                    :key="sysMsg.id"
                    class="flex items-start gap-1.5"
                  >
                    <span class="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-surface-4"></span>
                    <p class="min-w-0 flex-1 text-[11px] leading-relaxed text-text-muted/80 truncate" :title="sysMsg._clean">
                      {{ sysMsg._clean }}
                    </p>
                    <span class="shrink-0 text-[9px] text-text-muted/40 pt-px">{{ new Date(sysMsg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>

                    <details v-if="sysMsg.actionVoteSnapshot" class="ml-3 mt-1 overflow-hidden rounded border border-surface-4 bg-surface-2/30 text-left">
                      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-2.5 py-1 text-[10px] font-medium text-text-muted hover:text-text-secondary transition-colors">
                        <span>{{ tr('Vote Result') }}</span>
                        <div class="flex items-center gap-2">
                          <BaseTag
                            :variant="sysMsg.actionVoteSnapshot.status === 'applied' ? 'success' : sysMsg.actionVoteSnapshot.status === 'failed' ? 'danger' : 'warning'"
                            size="sm"
                            class="!px-1 !py-0 !text-[8px]"
                          >
                            {{ sysMsg.actionVoteSnapshot.status === 'applied' ? tr('Applied') : sysMsg.actionVoteSnapshot.status === 'failed' ? tr('Failed') : sysMsg.actionVoteSnapshot.status === 'rejected' ? tr('Rejected') : tr('Voting') }}
                          </BaseTag>
                          <ChevronDown :size="10" class="text-text-muted/60" />
                        </div>
                      </summary>
                      <div class="border-t border-surface-4 px-2.5 py-1.5 space-y-1.5">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <BaseTag variant="accent" size="sm" class="!px-1 !py-0 !text-[8px]">{{ tr(sysMsg.actionVoteSnapshot.request.target) }}</BaseTag>
                          <span class="text-[10px] text-text-muted">{{ tr('by') }} {{ sysMsg.actionVoteSnapshot.requestedByAgentName }}</span>
                        </div>
                        <p class="text-[10px] font-semibold text-text-primary">{{ sysMsg.actionVoteSnapshot.request.scope }}</p>
                        <p v-if="sysMsg.actionVoteSnapshot.request.purpose" class="text-[9px] text-text-muted leading-relaxed">{{ sysMsg.actionVoteSnapshot.request.purpose }}</p>
                        <div v-if="sysMsg.actionVoteSnapshot.votes.length" class="flex flex-wrap items-center gap-1.5">
                          <div
                            v-for="vote in sysMsg.actionVoteSnapshot.votes"
                            :key="`${sysMsg.id}-${vote.agentId}-${vote.createdAt}`"
                            class="flex items-center gap-1 rounded px-1.5 py-0.5 bg-surface-1"
                          >
                            <AgentAvatar :name="vote.agentName" :size="10" />
                            <BaseTag :variant="vote.vote === 'approve' ? 'success' : 'warning'" size="sm" class="!px-1 !py-0 !text-[7px]">{{ vote.vote === 'approve' ? '✓' : '✗' }}</BaseTag>
                          </div>
                        </div>
                        <div v-if="sysMsg.actionVoteSnapshot.result || sysMsg.actionVoteSnapshot.error" class="text-[9px] text-text-secondary rounded px-1.5 py-1" :class="sysMsg.actionVoteSnapshot.error ? 'bg-danger/5 text-danger' : 'bg-surface-1'">
                          {{ sysMsg.actionVoteSnapshot.result || sysMsg.actionVoteSnapshot.error }}
                        </div>
                      </div>
                    </details>
                    <div v-if="sysMsg.tool" class="ml-3 mt-1">
                      <ToolCallStatus :item="sysMsg.tool" />
                    </div>
                  </div>
                </div>
              </details>
            </template>

            <!-- User/Agent Message -->
            <div
              v-else
              class="group flex flex-col"
              :class="index > 0 && visibleItems[index - 1].type === 'message' ? (isSameSpeakerAsPrevious(item, index) ? 'gap-0.5 mt-0.5' : 'gap-1 mt-4') : 'gap-1'"
            >
              <!-- Role Label -->
              <div v-if="index === 0 || visibleItems[index - 1].type !== 'message' || !isSameSpeakerAsPrevious(item, index)" class="flex items-center justify-between select-none">
                <div class="flex items-center gap-2">
                  <template v-if="item.message.role === 'user'">
                    <div class="flex items-center justify-center w-5 h-5 text-text-primary">
                      <User :size="11" />
                    </div>
                    <span class="text-[11px] font-semibold text-text-primary">{{ tr('You') }}</span>
                  </template>
                  <template v-else>
                    <AgentAvatar :name="messageSpeaker(item.message)" :size="20" />
                    <span class="text-[11px] font-semibold text-text-primary">{{ messageSpeaker(item.message) }}</span>
                    <BaseTag variant="default" size="sm" class="!px-1 !py-0 !text-[8px] uppercase tracking-tighter">{{ tr('Public') }}</BaseTag>
                  </template>
                </div>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span class="text-[10px] text-text-muted">{{ new Date(item.message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
                </div>
              </div>

              <!-- Content Body -->
              <div class="pl-7 text-[13px] leading-relaxed text-text-primary whitespace-pre-wrap break-words relative">
                <p v-if="item.message._clean">{{ item.message._clean }}</p>

                <div v-if="item.message.tool" class="mt-2">
                  <ToolCallStatus :item="item.message.tool" />
                </div>

                <div v-if="item.message._refs.length" class="mt-2 flex flex-wrap gap-1.5">
                  <button
                    v-for="link in item.message._refs"
                    :key="`${item.message.id}-${link.element}-${link.label}`"
                    class="group/link flex items-center gap-1 rounded border border-surface-4 bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-secondary transition-all hover:border-accent/40 hover:text-accent"
                    @click="openReference(link.element)"
                  >
                    <FileText :size="10" class="text-text-muted group-hover/link:text-accent" />
                    <span>{{ link.label }}</span>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- Active Proposal Card (inline) -->
          <ProposalCard
            v-if="review.pendingProposal.value"
            variant="focus"
            :proposal="review.pendingProposal.value"
            :total-agents="review.agents.value.length"
            :enabled-agents="review.agents.value.filter(a => a.enabled).length"
            :class="review.messages.value.length ? 'mt-4' : ''"
            @approve="review.approveProposal"
            @reject="(reason) => review.rejectProposal(reason)"
          />

          <!-- Active Action Vote Card (inline) -->
          <ProposalCard
            v-if="review.actionVoteSession.value"
            variant="change"
            :change-vote="review.actionVoteSession.value"
            :total-agents="review.agents.value.length"
            :enabled-agents="review.agents.value.filter(a => a.enabled).length"
            :class="(review.messages.value.length || review.pendingProposal.value) ? 'mt-4' : ''"
            @approve="review.approveProposal"
            @reject="(reason) => review.rejectProposal(reason)"
          />

          <!-- Active End Vote Card (inline) -->
          <ProposalCard
            v-if="review.endVoteSession.value"
            variant="end"
            :end-vote="review.endVoteSession.value"
            :total-agents="review.agents.value.length"
            :enabled-agents="review.agents.value.filter(a => a.enabled).length"
            :class="(review.messages.value.length || review.pendingProposal.value || review.actionVoteSession.value) ? 'mt-4' : ''"
            @approve="review.approveEndVoteSession"
            @reject="(reason) => review.rejectEndVoteSession(reason)"
          />

          <!-- Thinking Indicators (minimalist) -->
          <div v-if="review.loading.value" class="space-y-1 mt-2">
            <div
              v-for="agentId in review.activeSpeakerIds.value"
              :key="agentId"
              class="flex items-center gap-2 pl-7 text-[11px] text-text-muted"
            >
              <AgentAvatar :name="review.agents.value.find(a => a.id === agentId)?.name || 'Agent'" :size="16" />
              <span class="font-medium text-text-secondary">{{ review.agents.value.find(a => a.id === agentId)?.name || tr('Agent') }}</span>
              <span class="text-text-muted">{{ tr('thinking...') }}</span>
              <div class="flex items-center gap-1 opacity-60">
                <div class="h-1 w-1 rounded-full bg-text-muted animate-bounce" style="animation-delay: 0ms"></div>
                <div class="h-1 w-1 rounded-full bg-text-muted animate-bounce" style="animation-delay: 150ms"></div>
                <div class="h-1 w-1 rounded-full bg-text-muted animate-bounce" style="animation-delay: 300ms"></div>
              </div>
            </div>
          </div>

          <div ref="chatEndRef" class="h-2"></div>
        </div>
      </div>

      <!-- Input Section -->
      <footer class="shrink-0 border-t border-surface-4 bg-surface-1/95 p-3">
        <div class="mx-auto max-w-4xl relative">
          <transition name="slide-up">
            <div v-if="review.userTyping.value" class="absolute -top-6 left-0 right-0 flex items-center justify-center gap-1.5 text-[10px] font-medium text-warning animate-pulse">
              <PauseCircle :size="10" />
              <span>{{ tr('Input active: queued agents paused') }}</span>
            </div>
          </transition>

          <div class="relative flex items-end gap-2 rounded-2xl border border-surface-4 bg-surface-2/80 px-3 py-2 shadow-sm transition-all focus-within:border-accent/40 focus-within:bg-surface-2">
            <div
              v-if="review.askUserSession.value?.status === 'ready'"
              class="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-accent/25 bg-surface-2 p-3 shadow-xl"
            >
              <div class="flex items-start gap-2">
                <Info :size="14" class="mt-0.5 shrink-0 text-accent" />
                <div class="min-w-0 flex-1">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-accent">{{ tr('User clarification needed') }}</p>
                  <p class="mt-1 text-xs font-semibold text-text-primary">{{ review.askUserSession.value.request.question }}</p>
                  <p class="mt-0.5 text-[10px] leading-relaxed text-text-muted">{{ review.askUserSession.value.request.reason }}</p>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <button
                      v-for="option in review.askUserSession.value.request.options"
                      :key="option"
                      class="rounded-lg border border-surface-4 bg-surface-1 px-2.5 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                      @click="review.answerAskUser(option)"
                    >
                      {{ option }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <textarea
              ref="inputTextarea"
              :value="review.inputText.value"
              rows="1"
              class="min-h-[40px] max-h-32 flex-1 resize-none bg-transparent px-0 py-1 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted/70 custom-scrollbar"
              :placeholder="tr('Add a high-priority user message to the meeting...')"
              @input="review.handleInput(($event.target as HTMLTextAreaElement).value)"
              @keydown.ctrl.enter.prevent="submitUserMessage"
            ></textarea>
            <button
              :disabled="!review.inputText.value.trim() && !review.loading.value"
              class="grid h-8 w-8 shrink-0 place-items-center rounded-full p-0 text-white shadow-sm transition-all hover:shadow-md active:scale-95 disabled:bg-surface-4 disabled:text-text-muted disabled:shadow-none"
              :class="review.loading.value ? 'bg-warning shadow-warning/20 hover:shadow-warning/25' : 'bg-accent shadow-accent/20 hover:shadow-accent/25'"
              :title="tr(review.loading.value ? 'Processing...' : 'Send')"
              @click="submitUserMessage"
            >
              <ArrowUp :size="16" stroke-width="2.5" />
            </button>
          </div>

          <div class="mt-2 flex items-center justify-between px-1">
            <div class="flex items-center gap-2">
              <span class="text-[9px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Ctrl + Enter') }}</span>
              <div v-if="review.meetingEnded.value" class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success/10 text-success">
                <Check :size="9" />
                <span class="text-[9px] font-bold uppercase">{{ tr('Ended') }}</span>
              </div>
              <div v-else-if="!review.loading.value && !queueItems.length" class="flex items-center gap-1.5">
                <span class="text-[9px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Idle') }}</span>
                <button 
                  class="flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent transition-colors hover:bg-accent/20"
                  @click="startMeetingRound"
                >
                  <RotateCcw :size="9" />
                  <span>{{ tr('Next Round') }}</span>
                </button>
              </div>
            </div>
            <button class="text-[9px] text-text-muted hover:text-accent flex items-center gap-1 transition-colors" @click="review.clearConversation">
              <RotateCcw :size="9" />
              <span>{{ tr('Clear') }}</span>
            </button>
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
      @reorder-agents="(fromIndex, toIndex) => review.reorderAgents(fromIndex, toIndex)"
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
