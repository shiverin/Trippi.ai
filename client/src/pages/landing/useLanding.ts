import { useEffect, useMemo, useState } from 'react';
import { faqItems, spotlightFeatures } from './landingContent';

export function useLanding() {
  const [activeFeatureId, setActiveFeatureId] = useState(spotlightFeatures[0].id);
  const [openFaqId, setOpenFaqId] = useState(faqItems[0].id);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousTheme = meta?.getAttribute('content');
    if (meta) meta.setAttribute('content', '#f8fbff');

    return () => {
      if (meta && previousTheme) meta.setAttribute('content', previousTheme);
    };
  }, []);

  const activeFeature = useMemo(
    () => spotlightFeatures.find((feature) => feature.id === activeFeatureId) ?? spotlightFeatures[0],
    [activeFeatureId]
  );

  const toggleFaq = (id: string) => {
    setOpenFaqId((current) => (current === id ? '' : id));
  };

  const closeMobileNav = () => setMobileNavOpen(false);

  return {
    activeFeature,
    activeFeatureId,
    closeMobileNav,
    mobileNavOpen,
    openFaqId,
    setActiveFeatureId,
    setMobileNavOpen,
    toggleFaq,
  };
}
