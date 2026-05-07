<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  width?: string
}>(), {
  width: '400px',
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
        class="fixed inset-0 z-[100] bg-black/60"
        @mousedown.self="close"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="modelValue"
            class="absolute right-0 top-0 h-full bg-surface-1 border-l border-surface-4 shadow-2xl flex flex-col"
            :style="{ width }"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 class="text-base font-semibold text-text-primary">{{ title }}</h2>
              <button
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
