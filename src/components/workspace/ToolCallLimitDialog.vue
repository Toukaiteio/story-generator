<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AlertTriangle, RotateCw, Square } from 'lucide-vue-next'
import { useGenerationStore } from '@/stores/generation'
import { translatePhrase } from '@/i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const AUTO_CONTINUE_SECONDS = 8

const genStore = useGenerationStore()
const tr = translatePhrase
const remainingSeconds = ref(AUTO_CONTINUE_SECONDS)
let timer: ReturnType<typeof setInterval> | null = null

const request = computed(() => genStore.toolContinuationRequest)

function clearTimer() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

function continueWorkflow() {
  clearTimer()
  request.value?.continue()
}

function stopWorkflow() {
  clearTimer()
  request.value?.stop()
}

watch(request, (next) => {
  clearTimer()
  if (!next) return

  remainingSeconds.value = AUTO_CONTINUE_SECONDS
  timer = setInterval(() => {
    remainingSeconds.value -= 1
    if (remainingSeconds.value <= 0) {
      continueWorkflow()
    }
  }, 1000)
}, { immediate: true })

onBeforeUnmount(clearTimer)
</script>

<template>
  <BaseDialog
    :model-value="!!request"
    :title="tr('Tool Calls Exceeded')"
    width="460px"
    :closable="false"
  >
    <div class="flex gap-3">
      <div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-warning/30 bg-warning/10">
        <AlertTriangle :size="18" class="text-warning" />
      </div>
      <div class="min-w-0 space-y-2">
        <p class="text-sm font-medium text-text-primary">
          {{ tr('The model seems to be calling tools more than expected.') }}
        </p>
        <p class="text-xs leading-relaxed text-text-secondary">
          {{ tr('It has used {count} tool rounds without submitting {tools}. You can continue and reset the counter, or stop this workflow.')
            .replace('{count}', String(request?.rounds ?? 0))
            .replace('{tools}', request?.finalToolNames.join(` ${tr('or')} `) ?? '') }}
        </p>
        <p class="text-xs text-text-muted">
          {{ tr('Continuing automatically in {seconds}s.').replace('{seconds}', String(remainingSeconds)) }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <BaseButton variant="ghost" size="sm" @click="stopWorkflow">
          <Square :size="13" />
          <span>{{ tr('Stop') }}</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="continueWorkflow">
          <RotateCw :size="13" />
          <span>{{ tr('Continue') }}</span>
        </BaseButton>
      </div>
    </template>
  </BaseDialog>
</template>
