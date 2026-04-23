import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(n: number): string {
  if (!n || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  const v = n / Math.pow(1024, i)
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function fileIcon(kind: string): string {
  switch (kind) {
    case 'cad': return '📐'
    case 'image': return '🖼️'
    case 'pdf': return '📕'
    case 'doc': return '📄'
    case 'sheet': return '📊'
    case 'slides': return '📽️'
    case 'archive': return '🗜️'
    case 'video': return '🎞️'
    case 'audio': return '🎵'
    default: return '📎'
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'open': return 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
    case 'in_progress': return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
    case 'pending_employee': return 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
    case 'resolved': return 'bg-green-500/15 text-green-700 dark:text-green-300'
    case 'closed': return 'bg-gray-500/15 text-gray-700 dark:text-gray-300'
    case 'cancelled': return 'bg-red-500/15 text-red-700 dark:text-red-300'
    default: return 'bg-gray-500/15 text-gray-700 dark:text-gray-300'
  }
}

export function priorityColor(priority: string): string {
  switch (priority) {
    case 'urgent': return 'bg-red-600/15 text-red-700 dark:text-red-300'
    case 'high': return 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
    case 'medium': return 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
    case 'low': return 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
    default: return 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
  }
}
