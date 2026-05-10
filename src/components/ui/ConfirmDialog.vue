<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle } from 'lucide-vue-next'
import BaseDialog from './BaseDialog.vue'
import BaseButton from './BaseButton.vue'
import { translatePhrase } from '@/i18n'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'default'
}>(), {
  title: 'Confirm',
  message: 'Are you sure?',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  variant: 'default',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
}>()

function handleConfirm() {
  emit('confirm')
  emit('update:modelValue', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:modelValue', false)
}

const iconColor = computed(() => {
  if (props.variant === 'danger') return 'text-danger'
  if (props.variant === 'warning') return 'text-warning'
  return 'text-accent'
})

const translatedTitle = computed(() => translatePhrase(props.title))
const translatedMessage = computed(() => translatePhrase(props.message))
const translatedConfirmText = computed(() => translatePhrase(props.confirmText))
const translatedCancelText = computed(() => translatePhrase(props.cancelText))
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="translatedTitle"
    width="400px"
  >
    <div class="flex gap-3">
      <AlertTriangle v-if="variant !== 'default'" :size="20" :class="iconColor" class="shrink-0 mt-0.5" />
      <p class="text-sm text-text-secondary leading-relaxed">{{ translatedMessage }}</p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <BaseButton variant="ghost" size="sm" @click="handleCancel">
          {{ translatedCancelText }}
        </BaseButton>
        <BaseButton
          :variant="variant === 'danger' ? 'danger' : 'primary'"
          size="sm"
          @click="handleConfirm"
        >
          {{ translatedConfirmText }}
        </BaseButton>
      </div>
    </template>
  </BaseDialog>
</template>
