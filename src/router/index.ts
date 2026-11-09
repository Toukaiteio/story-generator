import { createRouter, createWebHashHistory } from 'vue-router'
import WorkStation from '@/layouts/WorkStation.vue'
import { useUiStore } from '@/stores/ui'

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
          component: () => import('@/pages/Studio.vue'),
        },
        { path: 'knowledge', redirect: { name: 'Projects', query: { drawer: 'knowledge' } } },
        { path: 'styles', redirect: { name: 'Projects', query: { drawer: 'styles' } } },
        { path: 'providers', redirect: { name: 'Projects', query: { drawer: 'models' } } },
        { path: 'settings', redirect: { name: 'Projects', query: { drawer: 'settings' } } },
      ],
    },
  ],
})

router.beforeEach(to => {
  const drawer = typeof to.query.drawer === 'string' ? to.query.drawer : ''
  if (!drawer) return true

  const ui = useUiStore()
  if (drawer === 'knowledge' || drawer === 'styles' || drawer === 'models' || drawer === 'settings') {
    ui.openDrawer(drawer)
  }

  const { drawer: _drawer, ...query } = to.query
  return { name: to.name as string, params: to.params, query, replace: true }
})

export default router
