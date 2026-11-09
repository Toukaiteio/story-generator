<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  width?: string
  flush?: boolean
}>(), {
  width: '480px',
  flush: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
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
        class="fixed inset-0 z-[100] bg-black/25 backdrop-blur-sm"
        @mousedown.self="close"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="modelValue"
            class="app-drawer absolute bottom-0 right-0 top-0 flex max-w-full flex-col overflow-hidden rounded-l-ios-lg"
            :style="{ width: `min(480px, min(${width}, 100vw))` }"
          >
            <div class="app-drawer-header flex shrink-0 items-center justify-between gap-3">
              <h2 class="truncate text-title font-semibold text-text-primary">{{ title ? translatePhrase(title) : '' }}</h2>
              <button
                class="app-icon-button"
                :aria-label="translatePhrase('Close')"
                @click="close"
              >
                <X :size="18" />
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto" :class="flush ? '' : 'app-drawer-body'">
              <slot />
            </div>
            <div v-if="$slots.footer" class="app-drawer-footer shrink-0">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
