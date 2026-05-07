import { ref, markRaw } from 'vue'
import type { Component } from 'vue'

interface DialogOptions {
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'default'
}

const activeDialog = ref<{
  component: Component
  props: Record<string, any>
  resolve: (value: boolean) => void
} | null>(null)

export function useDialog() {
  function confirm(options: DialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      activeDialog.value = {
        component: markRaw({} as Component),
        props: {
          ...options,
          modelValue: true,
        },
        resolve,
      }
    })
  }

  function close(value: boolean) {
    if (activeDialog.value) {
      activeDialog.value.resolve(value)
      activeDialog.value = null
    }
  }

  return {
    activeDialog,
    confirm,
    close,
  }
}
