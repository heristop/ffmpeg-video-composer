import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ChevronLeft,
  Clapperboard,
  Film,
  Layers,
  Monitor,
  Music,
  Proportions,
  Scissors,
  Sparkles,
  type LucideIcon,
} from '@/presentation/components/icons';
import { SegmentedControl } from '@/presentation/components/ui';
import { KineticHeading, GradientMeter, PressableScale, ratio01 } from '@/presentation/components/kinetic';
import {
  ToolDock,
  ProgramMonitor,
  MobileViewTabs,
  type ToolItem,
  type ShellView,
  type ViewTab,
} from '@/presentation/components/editor-shell';
import { templateService, type Template, type InputSection, type QualityTier } from '@/services/templateService';
import type { VideoEdit } from '@/domain/valueObjects/videoEdits';
import type { MediaChoice } from '@/presentation/components/admin/templateEditorModel';
import { resolveTranslation } from '@/lib/i18nText';
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll';
import { withViewTransition } from '@/lib/viewTransition';
import { nextCue, hubProgress, type SceneModel } from './sceneStatus';
import { sectionKindMeta } from './sectionKind';
import { ScenePanel, MediaToolPanel, FormatPanel, orientationOf } from './editorPanels';
import { SectionPreview } from './SectionPreview';
import { SceneFilmstrip } from './SceneFilmstrip';
import { SaveStatusIndicator, type SaveStatus } from './SaveStatusIndicator';
import { TimelineEditor } from '@/features/editor/TimelineEditor';

type Tool = 'content' | 'media' | 'format';
type Phase = 'edit' | 'processing' | 'result';

interface EditorShellProps {
  template: Template;
  model: SceneModel;
  clipCount: number;
  showMedia: boolean;
  allComplete: boolean;
  phase: Phase;
  phaseContent: ReactNode;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  qualityTier: QualityTier;
  onQualityTierChange: (tier: QualityTier) => void;
  onFormDataChange: (d: Record<string, string>) => void;
  onClipChange: (sectionName: string, file: File | undefined) => void;
  onAddRush: (sectionName: string, file: File) => void;
  onSelectRush: (sectionName: string, file: File) => void;
  onRemoveRush: (sectionName: string, file: File) => void;
  onEditChange: (sectionName: string, edit: VideoEdit | undefined) => void;
  onMusicChange: (c: MediaChoice | null) => void;
  onBackgroundChange: (c: MediaChoice | null) => void;
  onCreate: () => void;
  onCancel: () => void;
  onExit: () => void;
}

interface RailItem {
  tool: Tool;
  icon: LucideIcon;
  label: string;
}

// Render-readiness as the shared gradient meter — a quick, glanceable "how close am I to Create" in
// the titlebar, reading in the same lavender→pink progress vocabulary as the cards and the scrubbers.
const ReadyMeter = ({ done, total, t }: { done: number; total: number; t: TFunction<'builder'> }) => {
  if (total === 0) return null;

  return (
    <div className="mr-1 hidden items-center gap-2 md:flex">
      <div className="w-24">
        <GradientMeter
          progress={ratio01(done, total)}
          variant="bar"
          size={5}
          label={t('editor.ready', { done, total })}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
};

// draft/standard/high render quality — an engine-resolved CRF/bitrate bundle (see resolveTier in
// encoding.ts). Arms the NEXT render; changing it mid-compile has no effect on one already running.
const QUALITY_TIERS: QualityTier[] = ['draft', 'standard', 'high'];

function useProgramAreaView(sectionName: string | undefined, clipFile: File | undefined) {
  const [viewState, setViewState] = useState({ sectionName, clipFile, editMode: false });

  if (viewState.sectionName !== sectionName || viewState.clipFile !== clipFile) {
    setViewState({ sectionName, clipFile, editMode: false });
  }

  const setEditMode = (next: boolean) => {
    setViewState((current) => ({ ...current, editMode: next }));
  };

  return {
    editMode: viewState.sectionName === sectionName && viewState.clipFile === clipFile ? viewState.editMode : false,
    setEditMode,
  };
}

const QualityTierControl = ({
  value,
  onChange,
  t,
}: {
  value: QualityTier;
  onChange: (tier: QualityTier) => void;
  t: TFunction<'builder'>;
}) => (
  <SegmentedControl
    ariaLabel={t('hub.quality.label')}
    value={value}
    onChange={(next) => {
      onChange(next as QualityTier);
    }}
    options={QUALITY_TIERS.map((tier) => ({ value: tier, label: t(`hub.quality.${tier}`) }))}
    classNames={{ button: 'px-2 py-1 text-xs' }}
  />
);

const EditorTopBar = ({
  template,
  phase,
  allComplete,
  done,
  total,
  saveStatus,
  lastSavedAt,
  qualityTier,
  onQualityTierChange,
  onCreate,
  onExit,
  t,
}: {
  template: Template;
  phase: Phase;
  allComplete: boolean;
  done: number;
  total: number;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  qualityTier: QualityTier;
  onQualityTierChange: (tier: QualityTier) => void;
  onCreate: () => void;
  onExit: () => void;
  t: TFunction<'builder'>;
}) => (
  <header className="flex items-center gap-2.5 border-b border-foreground/10 bg-surface-2/70 px-4 py-2.5 shadow-[inset_0_1px_0_0_oklch(1_0_0/0.04)] backdrop-blur-md short:py-1 sm:px-6">
    {/* Back affordance as a subtle pill — harmonized with the hub's "Change template" wording. */}
    <button
      type="button"
      onClick={() => {
        withViewTransition(onExit);
      }}
      className="tap inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 motion-reduce:transition-none"
    >
      <ChevronLeft size={16} />
      <span className="hidden sm:inline">{t('hub.changeTemplate')}</span>
    </button>

    <span aria-hidden="true" className="h-5 w-px shrink-0 bg-foreground/15" />

    {/* Project breadcrumb — a brand chip + the template name, reading as the thing being edited. */}
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-brand-500 ring-1 ring-brand-500/20"
    >
      <Clapperboard className="size-4" />
    </span>
    {/* Template name as a kinetic heading — the words rise in on open, the signature editorial
        entrance; the shared `studio-title` view-transition name rides the wrapper for the gallery→
        editor morph. Clipped horizontally so long names never wrap the compact titlebar — use
        `overflow-x-clip`, not `-hidden`, so it doesn't force overflow-y to `auto` and crop descenders. */}
    <span style={{ viewTransitionName: 'studio-title' }} className="min-w-0 flex-1 overflow-x-clip">
      <KineticHeading text={template.name} level="s" as="span" className="flex-nowrap whitespace-nowrap" />
    </span>

    {phase === 'edit' && <SaveStatusIndicator status={saveStatus} lastSavedAt={lastSavedAt} />}
    {phase === 'edit' && <ReadyMeter done={done} total={total} t={t} />}
    {phase === 'edit' && (
      <div className="hidden sm:block">
        <QualityTierControl value={qualityTier} onChange={onQualityTierChange} t={t} />
      </div>
    )}
    {phase === 'edit' && (
      // Icon-only on phones: spelled out, this CTA took roughly half the titlebar and truncated the
      // project name to a couple of characters. The label returns as soon as there's room.
      <PressableScale
        onClick={onCreate}
        disabled={!allComplete}
        hoverLift
        haptic="success"
        aria-label={t('hub.createCta')}
        title={t('hub.createCta')}
        className="brand-gradient group inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-900/30 transition-shadow hover:shadow-brand-500/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 disabled:pointer-events-none disabled:opacity-50 sm:px-5 [&_svg]:size-4"
      >
        <Sparkles size={16} /> <span className="hidden sm:inline">{t('hub.createCta')}</span>
      </PressableScale>
    )}
  </header>
);

interface ToolPanelProps extends EditorShellProps {
  tool: Tool;
  section: InputSection | null;
}

// The contextual panel for the active rail tool.
const ToolPanel = (p: ToolPanelProps) => {
  if (p.tool === 'media') {
    return (
      <MediaToolPanel
        template={p.template}
        model={p.model}
        onMusicChange={p.onMusicChange}
        onBackgroundChange={p.onBackgroundChange}
      />
    );
  }

  if (p.tool === 'format') {
    return (
      <FormatPanel template={p.template} qualityTier={p.qualityTier} onQualityTierChange={p.onQualityTierChange} />
    );
  }

  if (!p.section) return null;

  return (
    <ScenePanel
      template={p.template}
      section={p.section}
      model={p.model}
      clipCount={p.clipCount}
      onFormDataChange={p.onFormDataChange}
      onClipChange={p.onClipChange}
      onAddRush={p.onAddRush}
      onSelectRush={p.onSelectRush}
      onRemoveRush={p.onRemoveRush}
      onEditChange={p.onEditChange}
    />
  );
};

interface EditorBodyProps extends EditorShellProps {
  sections: InputSection[];
  tool: Tool;
  setTool: (tool: Tool) => void;
  section: InputSection | null;
  onSelectScene: (name: string) => void;
  panelTitle: string | null;
  panelEyebrow: string | null;
  rail: RailItem[];
  // Which surface the phone layout is showing. Ignored from `md` up, where both are on screen.
  mobileView: ShellView;
  t: TFunction<'builder'>;
}

interface ProgramAreaProps {
  clipFile: File | undefined;
  section: InputSection | null;
  editForClip: VideoEdit | undefined;
  onEditChange: EditorShellProps['onEditChange'];
  template: Template;
  model: SceneModel;
  t: TFunction<'builder'>;
}

// Right column: template preview by default; toggle to trim/crop editor when a clip is present.
const ProgramArea = ({ clipFile, section, editForClip, onEditChange, template, model, t }: ProgramAreaProps) => {
  const { editMode, setEditMode } = useProgramAreaView(section?.name, clipFile);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {clipFile && section && (
        <div className="flex shrink-0 items-center justify-center border-b border-foreground/10 px-3 py-2">
          <SegmentedControl
            ariaLabel={t('editor.viewMode')}
            value={editMode ? 'edit' : 'preview'}
            onChange={(value) => {
              setEditMode(value === 'edit');
            }}
            options={[
              {
                value: 'preview',
                ariaLabel: t('editor.preview'),
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Monitor className="h-3.5 w-3.5" />
                    {t('editor.preview')}
                  </span>
                ),
              },
              {
                value: 'edit',
                ariaLabel: t('stepClip.editorLabel'),
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Scissors className="h-3.5 w-3.5" />
                    {t('stepClip.editorLabel')}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}
      <div className="min-h-0 flex-1">
        {editMode && clipFile && section ? (
          // Scrolls only when the viewport is too short for the editor's own fit (a phone on its side).
          <div className="h-full overflow-y-auto p-3 sm:p-4">
            <TimelineEditor
              file={clipFile}
              label={t('stepClip.editorLabel')}
              edit={editForClip}
              onChange={(edit) => {
                onEditChange(section.name, edit);
              }}
            />
          </div>
        ) : (
          <ProgramMonitor
            label={t('editor.preview')}
            note={t('editor.approx')}
            meta={t(`stepMedia.aspect.${orientationOf(template)}`)}
            swapKey={section?.name}
          >
            <SectionPreview template={template} section={section} model={model} />
          </ProgramMonitor>
        )}
      </div>
    </div>
  );
};

// The panel's title block: one row, the scene's title on the left and its kind (Record / Details) as a
// quiet meta on the right, the same header the template builder's panels use.
const PanelHeader = ({ title, eyebrow }: { title: string | null; eyebrow: string | null }) => {
  if (!title) return null;

  return (
    <header className="flex shrink-0 items-baseline justify-between gap-3 border-b border-divider px-4 py-3 short:py-1.5 sm:px-5">
      <h2 className="min-w-0 truncate font-display text-base font-semibold text-foreground short:text-sm sm:text-lg">
        {title}
      </h2>
      {eyebrow ? <span className="shrink-0 text-xs text-muted-foreground">{eyebrow}</span> : null}
    </header>
  );
};

// The three-pane edit surface: tool dock · contextual panel · program monitor, with the scene
// timeline lane below.
const clipForEditor = (p: EditorBodyProps) =>
  p.tool === 'content' && p.section?.kind === 'clip' ? p.model.clipsBySection[p.section.name] : undefined;
const editForEditor = (p: EditorBodyProps) => (p.section ? p.model.editsBySection[p.section.name] : undefined);
const selectEditorScene = (
  name: string,
  setSceneName: (value: string) => void,
  setTool: (value: Tool) => void,
  setMobileView: (value: ShellView) => void
) => {
  setSceneName(name);
  setTool('content');
  setMobileView('panel');
};
const selectEditorTool = (next: Tool, setTool: (value: Tool) => void, setMobileView: (value: ShellView) => void) => {
  setTool(next);
  setMobileView('panel');
};
function editorShellViewState(
  tool: Tool,
  showMedia: boolean,
  section: InputSection | null,
  language: string,
  t: ReturnType<typeof useTranslation<'builder'>>['t']
) {
  const rail: RailItem[] = [
    { tool: 'content', icon: Film, label: t('editor.content') },
    ...(showMedia ? [{ tool: 'media' as const, icon: Music, label: t('editor.media') }] : []),
    { tool: 'format', icon: Proportions, label: t('editor.format') },
  ];
  const activeRail = rail.find((r) => r.tool === tool) ?? rail[0];
  const viewTabs: [ViewTab, ViewTab] = [
    { id: 'panel', icon: activeRail.icon, label: activeRail.label },
    { id: 'monitor', icon: Monitor, label: t('editor.preview') },
  ];
  const onContent = tool === 'content';
  const sceneTitle = section && (resolveTranslation(section.title, language) ?? t('hub.section'));

  return {
    rail,
    viewTabs,
    panelTitle: onContent ? sceneTitle : t(`editor.${tool}`),
    panelEyebrow: onContent && section ? t(sectionKindMeta(section).labelKey) : null,
  };
}

const EditorBody = (p: EditorBodyProps) => {
  const clipFile = clipForEditor(p);
  const editForClip = editForEditor(p);
  // Phones show one surface at a time (see MobileViewTabs); the other is unmounted from the flow, not
  // merely shrunk, so whichever one you are on gets the full height between the tabs and the lane.
  const onMonitor = p.mobileView === 'monitor';

  return (
    // One grid holds all regions. Stacked (flex-col): the tab-selected surface → timeline → dock
    // (the dock is a bottom tab bar, order-last). At `desk` both surfaces are on screen at once and
    // the grid takes over: the timeline spans the full second row below dock·panel·monitor. The
    // switch is `desk`, not `md`, because it needs viewport HEIGHT as well as width — a landscape
    // phone is wide enough for the grid and nowhere near tall enough to live in it. Same tiers as
    // ShellChrome: icon-only dock + narrow panel on the first desk tier, widening at lg/xl so the
    // monitor keeps priority.
    <div className="flex min-h-0 flex-1 flex-col desk:grid desk:grid-cols-[3.75rem_19rem_minmax(0,1fr)] desk:grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[5rem_22rem_minmax(0,1fr)] xl:grid-cols-[5rem_24rem_minmax(0,1fr)]">
      <ToolDock
        items={p.rail.map((r): ToolItem<Tool> => ({ id: r.tool, icon: r.icon, label: r.label }))}
        active={p.tool}
        onSelect={p.setTool}
        ariaLabel={p.t('editor.tools')}
      />

      <section
        className={`order-3 min-h-0 flex-1 flex-col overflow-hidden border-foreground/10 bg-surface/30 animate-surface-in-left motion-reduce:animate-none desk:order-none desk:flex desk:animate-none desk:border-r ${onMonitor ? 'hidden' : 'flex'}`}
      >
        <PanelHeader title={p.panelTitle} eyebrow={p.panelEyebrow} />
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {/* Keyed by tool + scene so swapping either cross-fades the body instead of hard-cutting. */}
          <div key={`${p.tool}:${p.section?.name ?? ''}`} className="panel-swap motion-reduce:animate-none">
            <ToolPanel {...p} />
          </div>
        </div>
      </section>

      <div
        className={`order-1 min-h-0 flex-1 animate-surface-in-right motion-reduce:animate-none desk:order-none desk:block desk:animate-none ${onMonitor ? 'block' : 'hidden'}`}
      >
        <ProgramArea
          clipFile={clipFile}
          section={p.section}
          editForClip={editForClip}
          onEditChange={p.onEditChange}
          template={p.template}
          model={p.model}
          t={p.t}
        />
      </div>

      <footer className="track-lane order-4 flex items-stretch border-t border-foreground/10 desk:order-none desk:col-span-3">
        {/* The lane's label spine. It is the tallest thing in the footer (icon + word + count), and
            it is pure signage — the cells beside it already read as a timeline — so a viewport too
            short to afford the rows gets the cells alone. */}
        <div className="hidden w-20 shrink-0 flex-col items-center justify-center gap-1.5 border-r border-foreground/10 bg-surface-2/30 short:hidden sm:flex">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-brand-500/12 text-brand-500 ring-1 ring-brand-500/20"
          >
            <Layers size={17} />
          </span>
          <span className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {p.t('editor.timeline')}
          </span>
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-500/15 px-1.5 text-[0.62rem] font-bold tabular-nums text-brand-600 ring-1 ring-brand-500/20 dark:text-brand-300">
            {p.sections.length}
          </span>
        </div>
        <SceneFilmstrip
          template={p.template}
          sections={p.sections}
          model={p.model}
          showMedia={p.showMedia}
          activeName={p.section?.name ?? null}
          onSelect={p.onSelectScene}
        />
      </footer>
    </div>
  );
};

// Fullscreen, app-style montage studio: an app titlebar over a dock · panel · program-monitor surface
// with a scene timeline below. One shell hosts editing, the compile, and the result (the latter two
// render `phaseContent` in-body).
export const EditorShell = (p: EditorShellProps) => {
  const { template, model, showMedia, phase } = p;
  const { t, i18n } = useTranslation('builder');
  useLockBodyScroll();

  const sections = templateService.orderedInputSections(template.descriptor);
  const [tool, setTool] = useState<Tool>('content');
  const [sceneName, setSceneName] = useState<string | null>(() => {
    const { nextSectionIndex } = nextCue(sections, template, model, showMedia);

    return sections[nextSectionIndex >= 0 ? nextSectionIndex : 0]?.name ?? null;
  });

  const section: InputSection | null = sections.find((s) => s.name === sceneName) ?? sections.at(0) ?? null;
  const { doneItems, totalItems } = hubProgress(sections, template, model, showMedia);

  // Which surface the phone shows. It opens on the editing panel because that is where the work is —
  // the monitor has nothing to show until a clip or a field exists. Ignored from `md` up.
  const [mobileView, setMobileView] = useState<ShellView>('panel');

  // Choosing a scene or a tool is an intent to edit it, so both pull the phone back to the panel;
  // otherwise the tap would silently change what the hidden surface is showing.
  const onSelectScene = (name: string) => {
    selectEditorScene(name, setSceneName, setTool, setMobileView);
  };
  const onSelectTool = (next: Tool) => {
    selectEditorTool(next, setTool, setMobileView);
  };

  const { rail, viewTabs, panelTitle, panelEyebrow } = editorShellViewState(tool, showMedia, section, i18n.language, t);
  // Editing sits left, the monitor right — the same order as the desktop columns, so the phone is a
  // narrowed version of the same room rather than a different arrangement. The editing tab is named
  // for the tool it will show (Content / Media / Format) rather than a generic "Edit", so the label
  // always says what is behind it.
  // Sit BELOW the global LeClap header (fixed, ~4rem, z-50) rather than covering it — the site header
  // stays visible and on top. The shell fills the rest of the viewport with its own toolbar + panels.
  // The exception is a short viewport (a phone held sideways): there the site header's 4rem is the
  // difference between a usable editing panel and a two-line sliver, and the shell already carries
  // its own way out ("Change template"), so the editor goes properly full-screen and takes the row
  // back. It has to out-rank the header's z-50 to do it.
  return createPortal(
    <div className="dark fixed inset-x-0 bottom-0 top-16 z-30 flex flex-col bg-background text-foreground short:top-0 short:z-[60]">
      <EditorTopBar
        template={template}
        phase={phase}
        allComplete={p.allComplete}
        done={doneItems}
        total={totalItems}
        saveStatus={p.saveStatus}
        lastSavedAt={p.lastSavedAt}
        qualityTier={p.qualityTier}
        onQualityTierChange={p.onQualityTierChange}
        onCreate={p.onCreate}
        onExit={p.onExit}
        t={t}
      />

      {phase === 'edit' && (
        <MobileViewTabs
          tabs={viewTabs}
          active={mobileView}
          onSelect={setMobileView}
          ariaLabel={t('editor.mobileView')}
        />
      )}

      {phase === 'edit' ? (
        <EditorBody
          {...p}
          sections={sections}
          tool={tool}
          setTool={onSelectTool}
          section={section}
          onSelectScene={onSelectScene}
          panelTitle={panelTitle}
          panelEyebrow={panelEyebrow}
          rail={rail}
          mobileView={mobileView}
          t={t}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-5 short:py-3 sm:py-8">{p.phaseContent}</div>
        </div>
      )}
    </div>,
    document.body
  );
};
