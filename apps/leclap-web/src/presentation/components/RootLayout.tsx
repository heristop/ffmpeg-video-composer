import { Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { haptic } from '@/lib/haptics';
import { Header } from '@/presentation/components/Header';
import { Footer } from '@/presentation/components/Footer';
import { LanguageSuggestion } from '@/presentation/components/LanguageSuggestion';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useNotFound } from '@/hooks/use-not-found';
import { useDarkSurface } from '@/hooks/use-dark-surface';
import { useSmoothScroll } from '@/hooks/use-smooth-scroll';
import { suspendSmoothScroll } from '@/lib/route-scroll';

// Onboarding pulls in the compile pipeline (and FFmpeg WASM); it only shows on the first studio
// visit, so lazy-loading it keeps that weight out of the entry chunk and off the landing page.
const Onboarding = lazy(() =>
  import('@/presentation/components/Onboarding').then((module) => ({ default: module.Onboarding }))
);

// React Router resets the scroll on every page change, and the root's `scroll-behavior: smooth` played that
// reset as a visible ~800 ms scroll to the top. This snaps it instead: scroll-behavior goes to auto for the
// navigation's own scroll (reset or back/forward restore), and back to smooth on the next frame, for in-page
// anchors. It must render before <ScrollRestoration />, so its layout effect runs first.
const InstantRouteScroll = () => {
  const { key } = useLocation();

  useLayoutEffect(() => {
    const resume = suspendSmoothScroll(document.documentElement);
    const frame = requestAnimationFrame(resume);

    return () => {
      cancelAnimationFrame(frame);
      resume();
    };
  }, [key]);

  return null;
};

// The shared chrome (skip link, header, footer, onboarding) wraps every route via <Outlet />.
// <ScrollRestoration /> gives native scroll behavior: top on forward navigations, restored position
// on back/forward — the browser default that client-side routing otherwise loses.
export function RootLayout() {
  const { t } = useTranslation();
  const { show, dismiss, openIfFirstTime } = useOnboarding();
  const location = useLocation();

  // Eased scrolling, marketing routes only — the hero's scroll-driven film only reads as film if the
  // scroll carrying it has weight. Mounted here so it spans the whole page, not just the hero.
  useSmoothScroll(location.pathname);

  // The guided intro stays off the landing page: it auto-opens once the visitor first reaches the
  // studio — where orientation is useful — then never again, and never over a 404 that merely starts
  // like a studio address. openIfFirstTime() no-ops for bots and for anyone who has already seen it.
  const notFound = useNotFound();
  const onDarkSurface = useDarkSurface();

  useEffect(() => {
    if (!notFound && location.pathname.startsWith('/studio')) {
      openIfFirstTime();
    }
  }, [location.pathname, notFound, openIfFirstTime]);

  // App-wide tactile feedback: a subtle haptic on every press of an interactive
  // element gives the web app a native, responsive feel (web-haptics).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = event.target as Element | null;

      if (el?.closest('button, a, [role="button"], input[type="range"], .tap')) {
        haptic('selection');
      }
    };
    document.addEventListener('pointerdown', onPointerDown, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  return (
    <>
      <InstantRouteScroll />
      <ScrollRestoration />
      <div className="flex min-h-screen flex-col bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-brand-600 focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/80"
        >
          {t('skipToContent')}
        </a>
        <Header />

        {/* tabIndex={-1} so the skip link can move keyboard focus here, not just scroll — without it
            focus stays on the link and the next Tab falls back into the header nav.
            `flex-1` makes main absorb the leftover column space, so a short page (404, an error) can
            fill the gap with `flex-1` of its own instead of hard-coding `100vh - header` — which
            overshoots by exactly the footer's height and pushes it below the fold. */}
        <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          {/* Lazy routes resolve under this boundary; null fallback avoids a flash on fast chunk loads. */}
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>

        {/* The footer owns the way back to the consent question — an answer nobody can revisit is not
            really a choice, and the bar itself is gone once given. */}
        {/* Under the studio's dark app surfaces the footer goes dark too, instead of ending on a light band. */}
        <div className={onDarkSurface ? 'dark' : undefined}>
          <Footer />
        </div>
      </div>

      {/* Offers the visitor's browser language instead of redirecting them (index.html). */}
      <LanguageSuggestion />

      {/* First-studio-visit guided intro (record → compile a sample → download). */}
      {show && (
        <Suspense fallback={null}>
          <Onboarding onDone={dismiss} />
        </Suspense>
      )}
    </>
  );
}
