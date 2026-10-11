import { lazy } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { RootLayout } from '@/presentation/components/RootLayout';
import { Home } from '@/presentation/pages/Home';
import { RouteError } from '@/presentation/components/RouteError';
import { LOCALE_PREFIXES } from '@/lib/language';
import { NOT_FOUND_HANDLE } from '@/hooks/use-not-found';

// Home stays in the entry chunk — it's the landing page and LCP-critical, so a lazy round-trip would
// only add a fallback flash. Every other route is code-split into its own chunk so the heavy surfaces
// (the editor, the builder, the admin, and the FFmpeg WASM they pull in) never weigh down first paint.
// `lazyPage` adapts our named page exports to the default export React.lazy expects.
const lazyPage = (factory: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => factory().then((module) => ({ default: module[name] as React.ComponentType })));

const Showcase = lazyPage(() => import('@/presentation/pages/Showcase'), 'Showcase');
const StudioHome = lazyPage(() => import('@/presentation/pages/StudioHome'), 'StudioHome');
const Builder = lazyPage(() => import('@/presentation/pages/Builder'), 'Builder');
const StudioTemplateBuilderPage = lazyPage(
  () => import('@/presentation/pages/StudioTemplateBuilderPage'),
  'StudioTemplateBuilderPage'
);
const Admin = lazyPage(() => import('@/presentation/pages/Admin'), 'Admin');
const TemplateEditorPage = lazyPage(() => import('@/presentation/pages/TemplateEditorPage'), 'TemplateEditorPage');
const PartialsPage = lazyPage(() => import('@/presentation/pages/PartialsPage'), 'PartialsPage');
const Design = lazyPage(() => import('@/presentation/pages/Design'), 'Design');
const About = lazyPage(() => import('@/presentation/pages/static-pages'), 'About');
const CompareRemotion = lazyPage(() => import('@/presentation/pages/compare-remotion'), 'CompareRemotion');
const Legal = lazyPage(() => import('@/presentation/pages/static-pages'), 'Legal');
const Privacy = lazyPage(() => import('@/presentation/pages/static-pages'), 'Privacy');
const NotFound = lazyPage(() => import('@/presentation/pages/NotFound'), 'NotFound');

const DocLayout = lazyPage(() => import('@/presentation/pages/doc'), 'DocLayout');
const DocOverview = lazyPage(() => import('@/presentation/pages/doc'), 'DocOverview');
const DocSections = lazyPage(() => import('@/presentation/pages/doc'), 'DocSections');
const DocTransitions = lazyPage(() => import('@/presentation/pages/doc'), 'DocTransitions');
const DocLooks = lazyPage(() => import('@/presentation/pages/doc'), 'DocLooks');
const DocGrade = lazyPage(() => import('@/presentation/pages/doc'), 'DocGrade');
const DocMotion = lazyPage(() => import('@/presentation/pages/doc'), 'DocMotion');
const DocAudio = lazyPage(() => import('@/presentation/pages/doc'), 'DocAudio');
const DocCaptions = lazyPage(() => import('@/presentation/pages/doc'), 'DocCaptions');
const DocAnimations = lazyPage(() => import('@/presentation/pages/doc'), 'DocAnimations');
const DocFilters = lazyPage(() => import('@/presentation/pages/doc'), 'DocFilters');
const DocExamples = lazyPage(() => import('@/presentation/pages/doc'), 'DocExamples');
const DocSchema = lazyPage(() => import('@/presentation/pages/doc'), 'DocSchema');
const DocCli = lazyPage(() => import('@/presentation/pages/doc'), 'DocCli');
const DocMcp = lazyPage(() => import('@/presentation/pages/doc'), 'DocMcp');
const DocWebMcp = lazyPage(() => import('@/presentation/pages/doc'), 'DocWebMcp');
const DocReference = lazyPage(() => import('@/presentation/pages/doc/References'), 'DocReference');
const DocEffects = lazyPage(() => import('@/presentation/pages/doc/References'), 'DocEffects');
const DocEngine = lazyPage(() => import('@/presentation/pages/doc/References'), 'DocEngine');
const DocCreativeDirection = lazyPage(() => import('@/presentation/pages/doc/References'), 'DocCreativeDirection');

const DocsAlias = () => {
  const location = useLocation();

  return (
    <Navigate to={location.pathname.replace(/^\/docs(?=\/|$)/, '/doc') + location.search + location.hash} replace />
  );
};

// Non-English languages are served under a path prefix (/fr, /de, …). Mounting the router under a
// matching basename lets every existing route work unchanged within the active locale — `/fr/studio`
// resolves to the Studio route. English has no prefix (basename undefined). The locale is read from
// the URL once at load; switching language is a full navigation to the new prefix (see LanguagePicker).
function detectBasename(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const segment = window.location.pathname.split('/')[1];

  return LOCALE_PREFIXES.includes(segment as never) ? `/${segment}` : undefined;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />} errorElement={<RouteError />}>
      <Route path="/" element={<Home />} />
      <Route path="/showcase" element={<Showcase />} />
      <Route path="/studio" element={<StudioHome />} />
      <Route path="/studio/new" element={<Builder />} />
      <Route path="/studio/builder" element={<StudioTemplateBuilderPage />} />
      {/* Legacy path kept so existing bookmarks/links keep working. */}
      <Route path="/builder" element={<Navigate to="/studio/new" replace />} />
      {/* Retired page: the saved projects live on the studio home now; old links land on them. */}
      <Route path="/projects" element={<Navigate to="/studio#projects" replace />} />
      <Route path="/templates" element={<Admin />} />
      <Route path="/templates/new" element={<TemplateEditorPage />} />
      <Route path="/templates/:id/edit" element={<TemplateEditorPage />} />
      <Route path="/partials" element={<PartialsPage />} />
      {/* Legacy path kept so existing bookmarks/links keep working. */}
      <Route path="/admin" element={<Navigate to="/templates" replace />} />
      <Route path="/design" element={<Design />} />
      <Route path="/docs/*" element={<DocsAlias />} />
      <Route path="/doc" element={<DocLayout />}>
        <Route index element={<DocOverview />} />
        <Route path="sections" element={<DocSections />} />
        <Route path="transitions" element={<DocTransitions />} />
        <Route path="looks" element={<DocLooks />} />
        <Route path="grade" element={<DocGrade />} />
        <Route path="motion" element={<DocMotion />} />
        <Route path="audio" element={<DocAudio />} />
        <Route path="captions" element={<DocCaptions />} />
        <Route path="animations" element={<DocAnimations />} />
        <Route path="filters" element={<DocFilters />} />
        <Route path="examples" element={<DocExamples />} />
        <Route path="schema" element={<DocSchema />} />
        <Route path="cli" element={<DocCli />} />
        <Route path="mcp" element={<DocMcp />} />
        <Route path="webmcp" element={<DocWebMcp />} />
        <Route path="reference" element={<DocReference />} />
        <Route path="effects" element={<DocEffects />} />
        <Route path="engine" element={<DocEngine />} />
        <Route path="creative-direction" element={<DocCreativeDirection />} />
      </Route>
      <Route path="/about" element={<About />} />
      <Route path="/compare/remotion" element={<CompareRemotion />} />
      {/* Retired page: its story is the home page's agentic section now; old links land there. */}
      <Route path="/use-cases/agentic-development" element={<Navigate to="/#agentic" replace />} />
      <Route path="/legal" element={<Legal />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="*" element={<NotFound />} handle={NOT_FOUND_HANDLE} />
    </Route>
  ),
  { basename: detectBasename() }
);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
