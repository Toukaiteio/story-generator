<script setup lang="ts">
withDefaults(defineProps<{
  size?: number
}>(), {
  size: 20,
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    class="animate-spin"
  >
    <circle
      cx="12" cy="12" r="10"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      class="text-surface-4"
    />
    <path
      d="M12 2a10 10 0 0 1 10 10"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      class="text-accent"
    />
  </svg>
</template>
