<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'

const props = withDefaults(defineProps<{
  modelValue?: string
  options: { label: string; value: string }[]
  label?: string
  placeholder?: string
  disabled?: boolean
}>(), {
  placeholder: 'Select...',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const containerRef = ref<HTMLDivElement>()
const triggerRef = ref<HTMLButtonElement>()
const position = ref({ top: 0, left: 0, width: 0 })

const selectedLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.modelValue)
  return opt?.label ? translatePhrase(opt.label) : ''
})

const translatedLabel = computed(() => props.label ? translatePhrase(props.label) : '')
const translatedPlaceholder = computed(() => translatePhrase(props.placeholder))
const translatedOptions = computed(() =>
  props.options.map(option => ({
    ...option,
    label: translatePhrase(option.label),
  }))
)

function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  nextTick(() => {
    const rect = triggerRef.value?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, 190)
    position.value = {
      top: Math.min(rect.bottom + 6, window.innerHeight - 260),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
    }
    open.value = true
  })
}

function select(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', handleClickOutside))
</script>

<template>
  <div ref="containerRef" class="flex min-w-0 flex-col gap-1.5">
    <label v-if="label" class="text-caption font-medium text-text-secondary">{{ translatedLabel }}</label>
    <button
      ref="triggerRef"
      type="button"
      :class="[
        'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-full px-3.5 text-caption transition-colors duration-150',
        'bg-surface-2 text-text-primary',
        open ? 'ring-2 ring-accent/40' : 'hover:bg-surface-3',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ]"
      @click="toggle"
      :disabled="disabled"
    >
      <span class="truncate" :class="selectedLabel ? '' : 'text-text-muted'">
        {{ selectedLabel || translatedPlaceholder }}
      </span>
      <ChevronDown :size="16" :class="['shrink-0 text-text-muted transition-transform duration-150', open ? 'rotate-180' : '']" />
    </button>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="open"
          class="fixed z-[220] max-h-64 overflow-y-auto rounded-ios border border-line bg-surface-1 p-1.5 shadow-ios-lg"
          :style="{ top: position.top + 'px', left: position.left + 'px', width: position.width + 'px' }"
        >
          <button
            v-for="opt in translatedOptions"
            :key="opt.value"
            type="button"
            :class="[
              'flex min-h-9 w-full items-center justify-between gap-2 rounded-full px-3.5 text-left text-caption transition-colors duration-100',
              opt.value === modelValue ? 'bg-accent-subtle text-accent' : 'text-text-primary hover:bg-surface-2',
            ]"
            @click="select(opt.value)"
          >
            <span class="truncate">{{ opt.label }}</span>
            <Check v-if="opt.value === modelValue" :size="15" class="shrink-0 text-accent" />
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
