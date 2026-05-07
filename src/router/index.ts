import { createRouter, createWebHashHistory } from 'vue-router'
import WorkStation from '@/layouts/WorkStation.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: WorkStation,
      children: [
        {
          path: '',
          name: 'Projects',
          component: () => import('@/pages/Projects.vue'),
        },
        {
          path: 'workspace/:id?',
          name: 'Workspace',
          component: () => import('@/pages/ProjectWorkspace.vue'),
        },
        {
          path: 'knowledge',
          name: 'Knowledge',
          component: () => import('@/pages/KnowledgeBase.vue'),
        },
        {
          path: 'styles',
          name: 'WritingStyles',
          component: () => import('@/pages/WritingStyles.vue'),
        },
        {
          path: 'providers',
          name: 'Providers',
          component: () => import('@/pages/Providers.vue'),
        },
        {
          path: 'settings',
          name: 'Settings',
          component: () => import('@/pages/Settings.vue'),
        },
      ],
    },
  ],
})

export default router
