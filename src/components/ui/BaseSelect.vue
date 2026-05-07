<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'

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

const selectedLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.modelValue)
  return opt?.label ?? ''
})

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
  <div class="flex flex-col gap-1.5" ref="containerRef">
    <label v-if="label" class="text-xs font-medium text-text-secondary">{{ label }}</label>
    <div class="relative">
      <button
        type="button"
        :class="[
          'flex items-center justify-between w-full h-9 px-3 rounded-md border text-sm transition-all duration-100',
          'bg-surface-1',
          open ? 'border-accent ring-1 ring-accent/20' : 'border-surface-4 hover:border-surface-5',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ]"
        @click="open = !open"
        :disabled="disabled"
      >
        <span :class="selectedLabel ? 'text-text-primary' : 'text-text-muted'">
          {{ selectedLabel || placeholder }}
        </span>
        <ChevronDown :size="14" :class="['text-text-muted transition-transform duration-100', open ? 'rotate-180' : '']" />
      </button>

      <Transition name="fade">
        <div
          v-if="open"
          class="absolute z-50 w-full mt-1 py-1 rounded-md border border-surface-4 bg-surface-2 shadow-lg max-h-60 overflow-y-auto"
        >
          <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            :class="[
              'flex items-center justify-between w-full px-3 py-2 text-sm text-left transition-colors duration-100',
              opt.value === modelValue ? 'text-accent bg-accent-subtle' : 'text-text-primary hover:bg-surface-3',
            ]"
            @click="select(opt.value)"
          >
            <span>{{ opt.label }}</span>
            <Check v-if="opt.value === modelValue" :size="14" class="text-accent" />
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>
