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
  document.body.style.overflow = val ? 'hidden' : ''
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
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-5 backdrop-blur-sm"
        @mousedown.self="handleBackdropClick"
      >
        <Transition name="dialog" appear>
          <div
            v-if="modelValue"
            class="flex max-h-[85vh] flex-col overflow-hidden rounded-ios-lg bg-surface-1 shadow-ios-lg"
            :style="{ width, maxWidth: '100%' }"
            role="dialog"
            aria-modal="true"
          >
            <div v-if="title || closable" class="flex shrink-0 items-center justify-between gap-3 px-6 pb-2 pt-5">
              <h2 v-if="title" class="text-title font-semibold text-text-primary">{{ translatedTitle }}</h2>
              <div v-else class="flex-1" />
              <button
                v-if="closable"
                class="app-icon-button"
                @click="close"
              >
                <X :size="18" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-6 py-4">
              <slot />
            </div>
            <div v-if="$slots.footer" class="shrink-0 px-6 pb-5 pt-3">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
