<script setup lang="ts">
withDefaults(defineProps<{
  options: Array<{ label: string; value: string; disabled?: boolean }>
  modelValue: string
  size?: 'sm' | 'md'
  disabled?: boolean
}>(), {
  size: 'sm',
  disabled: false,
})

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div
    class="capsule-group max-w-full overflow-x-auto"
    :class="disabled ? 'pointer-events-none opacity-50' : ''"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="capsule shrink-0"
      :class="[
        size === 'md' ? 'min-h-[40px] px-4 text-caption' : '',
        option.value === modelValue ? 'capsule--active' : '',
      ]"
      :disabled="option.disabled"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
