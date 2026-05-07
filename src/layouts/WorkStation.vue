<script setup lang="ts">
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-surface-0">
    <AppSidebar />

    <div class="flex flex-col flex-1 min-w-0">
      <AppHeader />

      <main class="flex-1 overflow-hidden">
        <router-view v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </router-view>
      </main>
    </div>

    <ToastContainer />
  </div>
</template>
