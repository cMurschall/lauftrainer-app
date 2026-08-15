import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from './views/DashboardView.vue'
import SettingsView from './views/SettingsView.vue'
import AnalysisView from './views/AnalysisView.vue'
import ImprintView from './views/ImprintView.vue'
import PrivacyView from './views/PrivacyView.vue'
import PricingView from './views/PricingView.vue'
import WelcomeView from './views/WelcomeView.vue'
import RestoreView from './views/RestoreView.vue'

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to) {
    if (to.hash && /^#[A-Za-z][\w-]*$/.test(to.hash)) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  },
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/analysis', name: 'analysis', component: AnalysisView },
    { path: '/impressum', name: 'imprint', component: ImprintView },
    { path: '/datenschutz', name: 'privacy', component: PrivacyView },
    { path: '/pricing', name: 'pricing', component: PricingView },
    { path: '/welcome', name: 'welcome', component: WelcomeView },
    { path: '/restore', name: 'restore', component: RestoreView },
  ],
})
