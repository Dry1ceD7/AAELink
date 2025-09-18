'use client';

import dynamic from 'next/dynamic';

const OfflineIndicator = dynamic(() => import('@/components/offline-indicator').then(mod => ({ default: mod.OfflineIndicator })), {
  ssr: false,
  loading: () => null
});

const ServiceWorkerRegistration = dynamic(() => import('@/components/service-worker-registration').then(mod => ({ default: mod.ServiceWorkerRegistration })), {
  ssr: false,
  loading: () => null
});

export function ClientOnlyComponents() {
  return (
    <>
      <OfflineIndicator showDetails={true} />
      <ServiceWorkerRegistration />
    </>
  );
}
