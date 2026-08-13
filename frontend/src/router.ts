import {createRouter, createWebHistory} from 'vue-router'
import DashboardView from './views/DashboardView.vue'
import SettingsView from './views/SettingsView.vue'
import AnalysisView from './views/AnalysisView.vue'

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: '/', name: 'dashboard', component: DashboardView},
        {path: '/settings', name: 'settings', component: SettingsView}
        , {path: '/analysis', name: 'analysis', component: AnalysisView}
    ]
})
