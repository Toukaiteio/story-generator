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
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/72 p-4"
        @mousedown.self="handleBackdropClick"
      >
        <Transition name="dialog" appear>
          <div
            v-if="modelValue"
            class="flex max-h-[85vh] flex-col overflow-hidden rounded-md border border-surface-4 bg-surface-1"
            :style="{ width, maxWidth: '100%' }"
            role="dialog"
            aria-modal="true"
          >
            <div v-if="title || closable" class="flex shrink-0 items-center justify-between border-b border-surface-4 bg-surface-0 px-5 py-4">
              <h2 v-if="title" class="text-base font-semibold text-text-primary">{{ translatedTitle }}</h2>
              <div v-else />
              <button
                v-if="closable"
                class="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-white/[0.05] hover:text-text-primary"
                @click="close"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-4">
              <slot />
            </div>
            <div v-if="$slots.footer" class="shrink-0 border-t border-surface-4 bg-surface-0 px-5 py-3">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
