<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'

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
            class="app-drawer absolute right-0 top-0 flex h-full max-w-full flex-col"
            :style="{ width: `min(${width}, 100vw)` }"
          >
            <div class="app-drawer-header flex shrink-0 items-center justify-between">
              <h2 class="text-base font-semibold text-text-primary">{{ title ? translatePhrase(title) : '' }}</h2>
              <button
                class="app-icon-button"
                @click="close"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="app-drawer-body flex-1 overflow-y-auto">
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
