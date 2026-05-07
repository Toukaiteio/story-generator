import { useUiStore } from '@/stores/ui'

export function useToast() {
  const ui = useUiStore()

  function toast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', duration?: number) {
    ui.addToast({ type, message, duration })
  }

  return {
    toast,
    success: (msg: string) => toast(msg, 'success'),
    error: (msg: string) => toast(msg, 'error', 6000),
    warning: (msg: string) => toast(msg, 'warning'),
    info: (msg: string) => toast(msg, 'info'),
  }
}
