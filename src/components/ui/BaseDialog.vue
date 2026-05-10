<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  width?: string
  closable?: boolean
}>(), {
  width: '480px',
  closable: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const translatedTitle = computed(() => props.title ? translatePhrase(props.title) : '')

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closable) close()
}

function handleBackdropClick() {
  if (props.closable) close()
}

watch(() => props.modelValue, (val) => {
  if (val) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="backdrop">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
        @mousedown.self="handleBackdropClick"
      >
        <Transition name="dialog" appear>
          <div
            v-if="modelValue"
            class="bg-surface-1 rounded-xl border border-surface-4 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            :style="{ width, maxWidth: '100%' }"
            role="dialog"
            aria-modal="true"
          >
            <div v-if="title || closable" class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 v-if="title" class="text-base font-semibold text-text-primary">{{ translatedTitle }}</h2>
              <div v-else />
              <button
                v-if="closable"
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="close"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-4">
              <slot />
            </div>
            <div v-if="$slots.footer" class="px-5 py-3 border-t border-surface-4 shrink-0">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
