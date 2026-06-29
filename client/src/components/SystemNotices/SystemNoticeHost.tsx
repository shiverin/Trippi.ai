import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore.js';
import { useSystemNoticeStore } from '../../store/systemNoticeStore.js';
import { BannerRenderer, ToastRenderer } from './SystemNoticeBanner.js';
import { ModalRenderer } from './SystemNoticeModal.js';

export function SystemNoticeHost() {
  const { notices, loaded } = useSystemNoticeStore();
  const overlaysDisabled = useAuthStore((s) => s.overlaysDisabled);

  // Notices are fetched by authStore after login (see App.tsx / authStore modification).
  // Cold-session fetch (page reload with valid session) is triggered here:
  useEffect(() => {
    if (overlaysDisabled) {
      if (loaded || notices.length > 0) {
        useSystemNoticeStore.getState().reset();
      }
      return;
    }
    // Only fetch if not already loaded (authStore may have already triggered)
    if (!loaded) {
      useSystemNoticeStore.getState().fetch();
    }
  }, [loaded, notices.length, overlaysDisabled]);

  if (overlaysDisabled) return null;

  if (!loaded) return null;

  const modals = notices.filter((n) => n.display === 'modal');
  const banners = notices.filter((n) => n.display === 'banner');
  const toasts = notices.filter((n) => n.display === 'toast');

  return (
    <>
      <BannerRenderer notices={banners} />
      <ModalRenderer notices={modals} />
      <ToastRenderer notices={toasts} />
    </>
  );
}
