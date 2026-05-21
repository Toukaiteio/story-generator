<script setup lang="ts">
import { computed, ref } from 'vue'
import { translatePhrase } from '@/i18n'
import type {
  ReviewProposal,
  ReviewActionVoteSession,
  ReviewEndVoteSession,
  ReviewActionVote,
  ReviewEndVote,
} from '@/services/review/types'
import AgentAvatar from './AgentAvatar.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-vue-next'

type ProposalVariant = 'focus' | 'change' | 'end'

const props = defineProps<{
  variant: ProposalVariant
  proposal?: ReviewProposal | null
  changeVote?: ReviewActionVoteSession | null
  endVote?: ReviewEndVoteSession | null
  totalAgents?: number
  enabledAgents?: number
}>()

const emit = defineEmits<{
  approve: []
  reject: [reason: string]
  dismiss: []
}>()

const tr = translatePhrase
const expanded = ref(true)
const rejectReason = ref('')
const showRejectInput = ref(false)
const votesExpanded = ref(false)
const execExpanded = ref(false)

const borderColor = computed(() => {
  if (props.variant === 'focus') return 'border-accent'
  if (props.variant === 'change') return 'border-accent'
  return 'border-warning'
})

const iconBg = computed(() => {
  if (props.variant === 'focus') return 'text-accent'
  if (props.variant === 'change') return 'text-accent'
  return 'text-warning'
})

const agentName = computed(() => {
  if (props.variant === 'focus' && props.proposal) return props.proposal.agentName
  if (props.variant === 'change' && props.changeVote) return props.changeVote.requestedByAgentName
  if (props.variant === 'end' && props.endVote) return props.endVote.requestedByAgentName
  return ''
})

const actionLabel = computed(() => {
  if (props.variant === 'focus') return tr('proposes focus change')
  if (props.variant === 'change') return tr('requests project change')
  return tr('requests meeting end')
})

const content = computed(() => {
  if (props.variant === 'focus' && props.proposal) return props.proposal.content
  if (props.variant === 'change' && props.changeVote) return props.changeVote.request.scope
  if (props.variant === 'end' && props.endVote) return props.endVote.reason
  return ''
})

const votes = computed((): Array<ReviewActionVote | ReviewEndVote> => {
  if (props.variant === 'change' && props.changeVote) return props.changeVote.votes
  if (props.variant === 'end' && props.endVote) return props.endVote.votes
  return []
})

const approveCount = computed(() => votes.value.filter(v => v.vote === 'approve').length)
const rejectCount = computed(() => votes.value.filter(v => v.vote === 'reject').length)
const totalVotes = computed(() => votes.value.length)
const totalPossible = computed(() => props.enabledAgents || props.totalAgents || 1)
const approvePct = computed(() => totalPossible.value > 0 ? (approveCount.value / totalPossible.value) * 100 : 0)

const statusTag = computed(() => {
  if (props.variant === 'change' && props.changeVote) {
    const s = props.changeVote.status
    if (s === 'applied') return { variant: 'success' as const, label: tr('Applied') }
    if (s === 'rejected' || s === 'failed') return { variant: 'danger' as const, label: tr(s === 'failed' ? 'Failed' : 'Rejected') }
    if (s === 'applying') return { variant: 'accent' as const, label: tr('Applying') }
    return { variant: 'accent' as const, label: tr('Voting') }
  }
  if (props.variant === 'end' && props.endVote) {
    return props.endVote.status === 'ready'
      ? { variant: 'warning' as const, label: tr('Ready') }
      : { variant: 'accent' as const, label: tr('Voting') }
  }
  return null
})

const exec = computed(() => props.variant === 'change' ? props.changeVote : null)
const execSteps = computed(() => exec.value?.executionTimeline?.length ?? 0)
const execLedgerSteps = computed(() => exec.value?.executionLedger?.length ?? 0)

function submitReject() {
  emit('reject', rejectReason.value.trim())
  rejectReason.value = ''
  showRejectInput.value = false
}

function voteIcon(vote: string) {
  return vote === 'approve'
}
</script>

<template>
  <div
    class="rounded-lg border-l-2 bg-surface-2/50 px-3 py-2"
    :class="borderColor"
  >
    <!-- Header Row -->
    <div class="flex items-center gap-2">
      <div class="flex items-center justify-center w-5 h-5" :class="iconBg">
        <Sparkles v-if="variant === 'focus'" :size="11" />
        <FileText v-else-if="variant === 'change'" :size="11" />
        <ShieldAlert v-else :size="11" />
      </div>

      <AgentAvatar :name="agentName" :size="16" />
      <span class="text-[11px] font-semibold text-text-primary truncate">{{ agentName }}</span>
      <span class="text-[10px] text-text-muted truncate">{{ actionLabel }}</span>

      <BaseTag v-if="statusTag" :variant="statusTag.variant" size="sm" class="ml-1">{{ statusTag.label }}</BaseTag>

      <div class="flex-1" />

      <span class="text-[9px] text-text-muted tabular-nums">{{ approveCount }}/{{ totalPossible }}</span>

      <button
        class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors"
        @click="expanded = !expanded"
      >
        <ChevronDown v-if="expanded" :size="12" />
        <ChevronRight v-else :size="12" />
      </button>
    </div>

    <!-- Collapsed summary -->
    <div v-if="!expanded" class="mt-1 text-[11px] text-text-secondary truncate pl-7">
      "{{ content }}"
      <button
        v-if="variant === 'focus'"
        class="ml-2 text-accent hover:text-accent/80 font-medium"
        @click="emit('approve')"
      >{{ tr('Approve') }}</button>
    </div>

    <!-- Expanded content -->
    <div v-if="expanded" class="mt-1.5 pl-7 space-y-2">
      <!-- Content -->
      <p v-if="variant === 'focus'" class="text-[11px] text-text-secondary italic leading-relaxed">"{{ content }}"</p>
      <p v-else-if="variant === 'change' && changeVote" class="text-[11px] text-text-secondary leading-relaxed">
        <span class="font-semibold text-text-primary">{{ changeVote.request.scope }}</span>
        <span v-if="changeVote.request.purpose" class="ml-1">鈥?{{ changeVote.request.purpose }}</span>
      </p>
      <p v-else-if="variant === 'end' && endVote" class="text-[11px] text-text-secondary italic leading-relaxed">"{{ content }}"</p>

      <!-- Progress bar + vote avatars -->
      <div v-if="votes.length" class="space-y-1.5">
        <div class="h-1.5 rounded-full bg-surface-4 overflow-hidden flex">
          <div class="h-full bg-success/70 rounded-l-full transition-all" :style="{ width: `${approvePct}%` }" />
          <div class="h-full bg-warning/70 transition-all" :style="{ width: `${(rejectCount / totalPossible) * 100}%` }" />
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <div
            v-for="vote in votes"
            :key="`${vote.agentId}-${vote.createdAt}`"
            class="flex items-center gap-1"
          >
            <AgentAvatar :name="vote.agentName" :size="14" />
            <Check v-if="voteIcon(vote.vote)" :size="10" class="text-success" />
            <X v-else :size="10" class="text-warning" />
          </div>
          <div
            v-for="n in (totalPossible - votes.length)"
            :key="`pending-${n}`"
            class="w-[14px] h-[14px] rounded-sm border border-dashed border-surface-4"
          />
        </div>
        <button
          class="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
          @click="votesExpanded = !votesExpanded"
        >
          <ChevronDown v-if="votesExpanded" :size="10" />
          <ChevronRight v-else :size="10" />
          <span>{{ tr('Details') }}</span>
        </button>
        <div v-if="votesExpanded" class="space-y-1 pl-3 border-l border-surface-4">
          <div
            v-for="vote in votes"
            :key="`detail-${vote.agentId}-${vote.createdAt}`"
            class="flex items-start gap-2 py-0.5"
          >
            <AgentAvatar :name="vote.agentName" :size="14" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-semibold text-text-primary">{{ vote.agentName }}</span>
                <BaseTag :variant="vote.vote === 'approve' ? 'success' : 'warning'" size="sm" class="!px-1 !py-0 !text-[8px]">{{ vote.vote === 'approve' ? tr('Approve') : tr('Reject') }}</BaseTag>
              </div>
              <p v-if="vote.reason" class="text-[10px] text-text-muted leading-relaxed mt-0.5">{{ vote.reason }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Execution status (Work Process style) -->
      <div v-if="exec && (exec.executionStatus || execSteps || execLedgerSteps)" class="mt-1">
        <button
          class="flex items-center gap-1.5 text-[10px] font-medium text-text-muted hover:text-text-primary transition-colors"
          @click="execExpanded = !execExpanded"
        >
          <LoaderCircle v-if="exec.executionState === 'running'" :size="10" class="animate-spin text-accent" />
          <Brain v-else :size="10" />
          <span>{{ tr('Execution') }}</span>
          <span class="opacity-70">
            <span v-if="execSteps">路 {{ execSteps }} {{ tr('steps') }}</span>
            <span v-if="exec.executionState === 'running'">路 {{ tr('running') }}</span>
          </span>
          <BaseTag
            v-if="exec.executionState"
            :variant="exec.executionState === 'success' ? 'success' : exec.executionState === 'warning' ? 'warning' : exec.executionState === 'error' ? 'danger' : 'accent'"
            size="sm"
            class="ml-1 !px-1 !py-0 !text-[8px]"
          >
            {{ exec.executionState === 'success' ? tr('Completed') : exec.executionState === 'warning' ? tr('Warning') : exec.executionState === 'error' ? tr('Failed') : tr('Running') }}
          </BaseTag>
          <ChevronDown v-if="execExpanded" :size="10" class="ml-0.5" />
          <ChevronRight v-else :size="10" class="ml-0.5" />
        </button>
        <div v-if="execExpanded" class="mt-1 space-y-1 pl-3 border-l-2 border-surface-4">
          <p v-if="exec.executionStatus" class="text-[10px] leading-relaxed text-text-secondary">{{ exec.executionStatus }}</p>
          <div v-if="exec.executionTimeline?.length" class="max-h-28 space-y-0.5 overflow-y-auto text-[10px]">
            <div
              v-for="(step, si) in exec.executionTimeline"
              :key="`et-${si}-${step.createdAt}`"
              class="flex items-center gap-1.5 text-text-muted"
            >
              <span class="h-1 w-1 rounded-full shrink-0" :class="step.state === 'success' ? 'bg-success' : step.state === 'warning' ? 'bg-warning' : step.state === 'error' ? 'bg-danger' : 'bg-accent'" />
              <span class="truncate">{{ step.line }}</span>
            </div>
          </div>
          <div v-if="exec.executionLedger?.length" class="max-h-28 space-y-0.5 overflow-y-auto text-[10px]">
            <div
              v-for="entry in exec.executionLedger"
              :key="entry.id"
              class="flex items-center gap-1.5 text-text-muted"
            >
              <span class="h-1 w-1 rounded-full shrink-0" :class="entry.status === 'success' ? 'bg-success' : entry.status === 'warning' ? 'bg-warning' : entry.status === 'error' ? 'bg-danger' : 'bg-accent'" />
              <span class="shrink-0 uppercase text-[9px]">{{ entry.phase }}</span>
              <span class="truncate">{{ entry.step }}</span>
            </div>
          </div>
        </div>
      </div>

     <!-- Result/Error -->
     <div v-if="exec && (exec.result || exec.error)" class="text-[10px] text-text-secondary rounded px-2 py-1" :class="exec.error ? 'bg-danger/5 text-danger' : 'bg-surface-1'">
       {{ exec.result || exec.error }}
     </div>

     <!-- Actions -->
     <div v-if="variant === 'focus' && proposal" class="flex items-center gap-2 pt-1">
       <button
         v-if="!showRejectInput"
         class="text-[10px] font-medium text-text-muted hover:text-danger transition-colors"
         @click="showRejectInput = true"
       >{{ tr('Reject') }}</button>
       <template v-if="showRejectInput">
         <input
           v-model="rejectReason"
           class="h-6 flex-1 rounded border border-surface-4 bg-surface-1 px-2 text-[10px] text-text-primary outline-none focus:border-accent/50"
           :placeholder="tr('Reason (optional)')"
           @keydown.enter.prevent="submitReject"
         />
         <button class="text-[10px] font-medium text-text-muted hover:text-danger transition-colors" @click="submitReject">{{ tr('Reject') }}</button>
         <button class="text-[10px] font-medium text-text-muted hover:text-text-primary transition-colors" @click="showRejectInput = false; rejectReason = ''">{{ tr('Cancel') }}</button>
       </template>
       <div class="flex-1" />
       <BaseButton variant="primary" size="sm" class="!h-6 !px-3 !text-[10px]" @click="emit('approve')">
         {{ tr('Approve') }}
       </BaseButton>
     </div>

     <div v-if="variant === 'end' && endVote && endVote.status === 'ready'" class="flex items-center gap-2 pt-1">
       <input
         v-model="rejectReason"
         class="h-6 flex-1 rounded border border-surface-4 bg-surface-1 px-2 text-[10px] text-text-primary outline-none focus:border-accent/50"
         :placeholder="tr('Reason to continue...')"
       />
       <button class="text-[10px] font-medium text-text-muted hover:text-danger transition-colors" :disabled="!rejectReason.trim()" @click="submitReject">{{ tr('Continue') }}</button>
       <BaseButton variant="danger" size="sm" class="!h-6 !px-3 !text-[10px]" @click="emit('approve')">
         {{ tr('End Meeting') }}
       </BaseButton>
     </div>

     <div v-if="variant === 'change' && changeVote && changeVote.status === 'voting'" class="flex items-center gap-2 pt-1">
       <button
         v-if="!showRejectInput"
         class="text-[10px] font-medium text-text-muted hover:text-danger transition-colors"
         @click="showRejectInput = true"
       >{{ tr('Reject') }}</button>
       <template v-if="showRejectInput">
         <input
           v-model="rejectReason"
           class="h-6 flex-1 rounded border border-surface-4 bg-surface-1 px-2 text-[10px] text-text-primary outline-none focus:border-accent/50"
           :placeholder="tr('Reason (optional)')"
           @keydown.enter.prevent="submitReject"
         />
         <button class="text-[10px] font-medium text-text-muted hover:text-danger transition-colors" @click="submitReject">{{ tr('Reject') }}</button>
         <button class="text-[10px] font-medium text-text-muted hover:text-text-primary transition-colors" @click="showRejectInput = false; rejectReason = ''">{{ tr('Cancel') }}</button>
       </template>
       <div class="flex-1" />
       <BaseButton variant="primary" size="sm" class="!h-6 !px-3 !text-[10px]" @click="emit('approve')">
         {{ tr('Approve') }}
       </BaseButton>
     </div>
   </div>
 </div>
</template>
