/**
 * Toast Hook
 * Global toast notification system
 */

import { create } from 'zustand';

export interface Toast {
  id: string;
  title?: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  dismissible?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = {
      id,
      duration: 5000,
      dismissible: true,
      ...toast,
    };
    
    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));
    
    // Auto-remove toast after duration
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, newToast.duration);
    }
  },
  
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
  
  clearToasts: () => {
    set({ toasts: [] });
  },
}));

export const useToast = () => {
  const { addToast, removeToast, clearToasts } = useToastStore();
  
  const toast = {
    success: (message: string, options?: Partial<Omit<Toast, 'id' | 'message' | 'type'>>) => {
      addToast({ message, type: 'success', ...options });
    },
    
    error: (message: string, options?: Partial<Omit<Toast, 'id' | 'message' | 'type'>>) => {
      addToast({ message, type: 'error', duration: 7000, ...options });
    },
    
    warning: (message: string, options?: Partial<Omit<Toast, 'id' | 'message' | 'type'>>) => {
      addToast({ message, type: 'warning', ...options });
    },
    
    info: (message: string, options?: Partial<Omit<Toast, 'id' | 'message' | 'type'>>) => {
      addToast({ message, type: 'info', ...options });
    },
    
    custom: (toast: Omit<Toast, 'id'>) => {
      addToast(toast);
    },
    
    dismiss: (id: string) => {
      removeToast(id);
    },
    
    clear: () => {
      clearToasts();
    },
  };
  
  return { toast };
};

export const useToasts = () => {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);
  
  return { toasts, removeToast };
};
