import { createRouter, createMemoryHistory } from 'vue-router'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      name: 'main',
      component: () => import('./pages/MainPage.vue')
    },
    {
      path: '/osc',
      name: 'osc',
      component: () => import('./pages/OscPage.vue')
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('./pages/LogsPage.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./pages/SettingsPage.vue')
    },
    {
      path: '/hyperate',
      name: 'hyperate',
      component: () => import('./pages/HyperatePage.vue')
    },
    {
      path: '/oscleash',
      name: 'oscleash',
      component: () => import('./pages/OscLeashPage.vue')
    },
    {
      path: '/oscgoesbrrr',
      name: 'oscgoesbrrr',
      component: () => import('./pages/OscGoesBrrrPage.vue')
    },
    {
      path: '/autostatus',
      name: 'autostatus',
      component: () => import('./pages/AutoStatusPage.vue')
    },
    {
      path: '/vrchat-api',
      name: 'vrchat-api',
      component: () => import('./pages/VRChatAPIPage.vue')
    },
    {
      path: '/feedback',
      name: 'feedback',
      component: () => import('./pages/FeedbackPage.vue')
    },
    {
      path: '/chatbox',
      name: 'chatbox',
      component: () => import('./pages/ChatboxPage.vue')
    },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('./pages/CalendarPage.vue')
    },
    {
      path: '/openshock',
      name: 'openshock',
      component: () => import('./pages/OpenShockPage.vue')
    },
    {
      path: '/arclink',
      name: 'arclink',
      component: () => import('./pages/ARCLinkPage.vue')
    },
    {
      path: '/lovense',
      name: 'lovense',
      component: () => import('./pages/LovensePage.vue')
    },
    {
      path: '/vosk',
      name: 'vosk',
      component: () => import('./pages/VoskPage.vue')
    },
    {
      path: '/vrc-timeline',
      name: 'vrc-timeline',
      component: () => import('./pages/VRCTimelinePage.vue')
    },
    {
      path: '/auto-inviter',
      name: 'auto-inviter',
      component: () => import('./pages/AutoInviterPage.vue')
    },
    {
      path: '/xsoverlay',
      name: 'xsoverlay',
      component: () => import('./pages/XSOverlayPage.vue')
    }
  ]
})

export default router
