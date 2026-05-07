<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useGenerationStore } from '@/stores/generation'
import { useToast } from '@/composables/useToast'
import BaseButton from '@/components/ui/BaseButton.vue'
import { Send, Sparkles, RotateCcw, User, MessageSquare, Check, Copy } from 'lucide-vue-next'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

const props = defineProps<{
  stage: string
  context?: Record<string, any>
}>()

const emit = defineEmits<{
  apply: [content: string]
  close: []
}>()

const projectStore = useProjectStore()
const genStore = useGenerationStore()
const toast = useToast()

const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const isLoading = ref(false)
const chatContainer = ref<HTMLElement | null>(null)

const project = computed(() => projectStore.activeProject)

const stagePrompts: Record<string, string> = {
  planning: 'You are a story planning assistant. Help the user refine their story outline and character designs. Provide creative suggestions, identify plot holes, and help develop compelling narratives.',
  'chapter-outline': 'You are a chapter planning assistant. Help the user structure their chapters effectively. Suggest improvements to chapter flow, pacing, and story beats.',
  writing: 'You are a writing assistant. Help the user improve their prose, suggest better word choices, enhance descriptions, and maintain consistent voice and style.',
  proofreading: 'You are a proofreading assistant. Help the user identify and fix grammar errors, inconsistencies, plot holes, and continuity issues.',
  polishing: 'You are a polishing assistant. Help the user enhance their prose quality, improve sentence rhythm, strengthen emotional resonance, and elevate the overall writing.',
}

const stageLabels: Record<string, string> = {
  planning: 'Story Architect',
  'chapter-outline': 'Structure Designer',
  writing: 'Prose Draftsman',
  proofreading: 'Continuity Editor',
  polishing: 'Style Polisher',
}

function addMessage(role: 'user' | 'assistant' | 'system', content: string) {
  messages.value.push({
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    role,
    content,
    timestamp: new Date(),
  })
  scrollToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTo({
        top: chatContainer.value.scrollHeight,
        behavior: 'smooth'
      })
    }
  })
}

function buildContextPrompt(): string {
  const ctx = props.context || {}
  const parts: string[] = []
  if (ctx.outline) parts.push(`Outline:\n${ctx.outline}`)
  if (ctx.chapter) parts.push(`Chapter: ${ctx.chapter.title}\nContent:\n${ctx.chapter.content || 'Drafting...'}`)
  if (ctx.character) parts.push(`Character: ${ctx.character.name} (${ctx.character.role})`)
  return parts.join('\n\n')
}

async function sendMessage() {
  if (!inputText.value.trim() || isLoading.value) return

  const userMessage = inputText.value.trim()
  inputText.value = ''
  addMessage('user', userMessage)
  isLoading.value = true

  try {
    const systemPrompt = stagePrompts[props.stage] || stagePrompts.planning
    const contextPrompt = buildContextPrompt()
    const fullPrompt = contextPrompt 
      ? `${systemPrompt}\n\nContext:\n${contextPrompt}\n\nUser: ${userMessage}`
      : `${systemPrompt}\n\nUser: ${userMessage}`

    const response = await genStore.chatWithAssistant(fullPrompt)
    addMessage('assistant', response)
  } catch (error: any) {
    toast.error(error?.message || 'Connection lost')
    addMessage('system', 'System error: Unable to reach Vibe Engine.')
  } finally {
    isLoading.value = false
  }
}

function applyContent(content: string) {
  emit('apply', content)
  toast.success('Applied to editor')
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copied to clipboard')
}

function clearChat() {
  messages.value = []
  addMessage('assistant', `Hello. I am your ${stageLabels[props.stage]}. How shall we evolve your story today?`)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

watch(() => props.stage, () => {
  if (messages.value.length === 0) {
    addMessage('assistant', `Hello. I am your ${stageLabels[props.stage]}. How shall we evolve your story today?`)
  }
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col h-full bg-[#fdfdfd] dark:bg-surface-1 font-sans">
    <!-- Clean Header -->
    <div class="shrink-0 px-6 py-4 flex items-center justify-between border-b border-black/5 dark:border-white/5">
      <div class="flex items-center gap-3">
        <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/5 dark:bg-accent/10 border border-accent/10">
          <Sparkles :size="16" class="text-accent" />
        </div>
        <div>
          <h3 class="text-sm font-bold text-text-primary tracking-tight">Vibe Assistant</h3>
          <p class="text-[10px] uppercase tracking-widest text-text-muted font-bold">{{ stageLabels[stage] }}</p>
        </div>
      </div>
      <button 
        class="p-2 text-text-muted hover:text-accent hover:bg-accent/5 rounded-full transition-all"
        title="Reset Conversation"
        @click="clearChat"
      >
        <RotateCcw :size="14" />
      </button>
    </div>

    <!-- Minimalist Chat Container -->
    <div
      ref="chatContainer"
      class="flex-1 overflow-y-auto px-6 py-8 space-y-10 custom-scrollbar"
    >
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="group flex flex-col gap-3"
      >
        <!-- Message Role Label -->
        <div class="flex items-center gap-2 select-none">
          <div v-if="msg.role === 'user'" class="flex items-center gap-2">
            <User :size="12" class="text-text-muted" />
            <span class="text-[10px] font-black uppercase tracking-widest text-text-muted">You</span>
          </div>
          <div v-else-if="msg.role === 'assistant'" class="flex items-center gap-2">
            <Sparkles :size="12" class="text-accent" />
            <span class="text-[10px] font-black uppercase tracking-widest text-accent">Vibe Engine</span>
          </div>
          <div v-else class="flex items-center gap-2">
            <span class="text-[10px] font-black uppercase tracking-widest text-warning">System</span>
          </div>
          <span class="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {{ msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
          </span>
        </div>

        <!-- Content Body (No Bubble for Assistant, Subtle for User) -->
        <div 
          :class="[
            'text-[15px] leading-relaxed max-w-full transition-all',
            msg.role === 'user' 
              ? 'bg-surface-2/50 dark:bg-surface-2/30 p-4 rounded-xl border border-black/5 dark:border-white/5 italic text-text-secondary' 
              : 'text-text-primary px-1'
          ]"
        >
          <div class="whitespace-pre-wrap">{{ msg.content }}</div>

          <!-- Actions for Assistant Messages -->
          <div v-if="msg.role === 'assistant'" class="mt-6 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
            <button 
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-accent text-white shadow-lg shadow-accent/20 hover:scale-105 active:scale-95 transition-all"
              @click="applyContent(msg.content)"
            >
              <Check :size="12" />
              Apply to Editor
            </button>
            <button 
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-surface-3 text-text-secondary hover:bg-surface-4 transition-all"
              @click="copyToClipboard(msg.content)"
            >
              <Copy :size="12" />
              Copy
            </button>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="flex flex-col gap-3 animate-pulse">
        <div class="flex items-center gap-2">
          <Sparkles :size="12" class="text-accent/50" />
          <span class="text-[10px] font-black uppercase tracking-widest text-accent/50">Vibe Engine Thinking...</span>
        </div>
        <div class="space-y-2 px-1">
          <div class="h-4 bg-accent/5 rounded w-full"></div>
          <div class="h-4 bg-accent/5 rounded w-5/6"></div>
          <div class="h-4 bg-accent/5 rounded w-2/3"></div>
        </div>
      </div>
    </div>

    <!-- Claude-style Floating Input Area -->
    <div class="shrink-0 p-6">
      <div class="relative group">
        <div class="absolute -inset-1 bg-gradient-to-r from-accent/20 to-accent/5 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-500"></div>
        <div class="relative flex items-end gap-2 bg-white dark:bg-surface-2 border border-black/10 dark:border-white/10 rounded-xl p-3 shadow-sm focus-within:shadow-md focus-within:border-accent/30 transition-all">
          <textarea
            v-model="inputText"
            rows="1"
            placeholder="Describe a vibe, ask for advice..."
            class="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2 px-1 resize-none custom-scrollbar min-h-[40px] max-h-[120px] text-text-primary"
            @keydown="handleKeydown"
            @input="(e) => {
              const el = e.target as HTMLElement;
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
            }"
          ></textarea>
          <button
            :disabled="!inputText.trim() || isLoading"
            class="mb-1 p-2 rounded-lg bg-accent text-white disabled:bg-surface-4 disabled:text-text-muted hover:shadow-lg hover:shadow-accent/20 active:scale-95 transition-all"
            @click="sendMessage"
          >
            <Send :size="16" />
          </button>
        </div>
      </div>
      <div class="mt-3 flex items-center justify-center gap-4">
        <p class="text-[10px] text-text-muted font-medium">Shift + Enter for new line</p>
        <div class="h-1 w-1 rounded-full bg-text-muted/30"></div>
        <p class="text-[10px] text-text-muted font-medium">Powered by Vibe Engine v2</p>
      </div>
    </div>
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
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
}

textarea {
  outline: none !important;
}

/* Animations inspired by Claude */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

.group {
  animation: fadeIn 0.4s ease-out forwards;
}
</style>