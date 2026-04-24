'use client'

import { create } from 'zustand'

interface UIState {
  // Mobile sidebar overlay
  sidebarOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  toggleSidebar: () => void

  // Global "New Ticket" slide-over
  newTicketOpen: boolean
  openNewTicket: () => void
  closeNewTicket: () => void

  // Global Settings drawer (Slack-style modal)
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void

  // Notifications panel
  notificationsOpen: boolean
  toggleNotifications: () => void
  closeNotifications: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  newTicketOpen: false,
  openNewTicket: () => set({ newTicketOpen: true }),
  closeNewTicket: () => set({ newTicketOpen: false }),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  notificationsOpen: false,
  toggleNotifications: () =>
    set((s) => ({ notificationsOpen: !s.notificationsOpen })),
  closeNotifications: () => set({ notificationsOpen: false }),
}))
