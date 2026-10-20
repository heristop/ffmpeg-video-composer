import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/presentation/components/ui';

interface ShortcutCheatSheetProps {
  open: boolean;
  onClose: () => void;
}

// The platform modifier symbol: ⌘ on macOS, Ctrl elsewhere. Derived once from the UA; SSR-safe guard.
const modKey = (): string => {
  if (typeof navigator === 'undefined') return 'Ctrl';

  const platform = navigator.platform || navigator.userAgent;

  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';
};

// One row = an i18n label key + the key chips to render for it. `mod` is substituted at render time.
interface Row {
  labelKey: string;
  keys: string[];
}

// Grouped the way the keys are used: editing the template, moving around it, playing it back.
const GROUPS: Array<{ titleKey: string; rows: Row[] }> = [
  {
    titleKey: 'shortcuts.groupEdit',
    rows: [
      { labelKey: 'shortcuts.undo', keys: ['mod', 'Z'] },
      { labelKey: 'shortcuts.redo', keys: ['mod', '⇧', 'Z'] },
      { labelKey: 'shortcuts.save', keys: ['mod', 'S'] },
      { labelKey: 'shortcuts.addScene', keys: ['N'] },
      { labelKey: 'shortcuts.duplicateScene', keys: ['mod', 'D'] },
      { labelKey: 'shortcuts.deleteScene', keys: ['Del'] },
    ],
  },
  {
    titleKey: 'shortcuts.groupMove',
    rows: [
      { labelKey: 'shortcuts.prevScene', keys: ['PgUp'] },
      { labelKey: 'shortcuts.nextScene', keys: ['PgDn'] },
      { labelKey: 'shortcuts.tools', keys: ['[', ']'] },
      { labelKey: 'shortcuts.backToEditing', keys: ['Esc'] },
      { labelKey: 'shortcuts.showHelp', keys: ['?'] },
    ],
  },
  {
    titleKey: 'shortcuts.groupPlay',
    rows: [
      { labelKey: 'shortcuts.playPause', keys: ['Space'] },
      { labelKey: 'shortcuts.shuttle', keys: ['J', 'K', 'L'] },
      { labelKey: 'shortcuts.frameStep', keys: ['←', '→'] },
      { labelKey: 'shortcuts.secondStep', keys: ['⇧', '←', '→'] },
      { labelKey: 'shortcuts.editPoints', keys: ['↑', '↓'] },
    ],
  },
];

const Kbd = ({ children }: { children: string }) => (
  <kbd className="inline-grid min-w-7 place-items-center rounded-md border border-divider bg-surface-2 px-2 py-1 text-[0.7rem] font-semibold text-foreground shadow-[var(--shadow-card)]">
    {children}
  </kbd>
);

// Discoverable keyboard-shortcut reference for the studio editor. Opened by the `?` shortcut; a plain
// controlled dialog (Radix gives focus-trap + ESC for free — the shell disables shortcuts while open).
export const ShortcutCheatSheet = ({ open, onClose }: ShortcutCheatSheetProps) => {
  const { t } = useTranslation('admin');
  const mod = modKey();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Capped to the small-viewport height so the list scrolls instead of clipping offscreen. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.hint')}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.titleKey} className="min-w-0">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
                {t(group.titleKey)}
              </h3>
              <ul className="grid">
                {group.rows.map((row) => (
                  <li
                    key={row.labelKey}
                    className="flex items-center justify-between gap-4 border-b border-foreground/5 py-1.5 last:border-b-0"
                  >
                    <span className="text-sm text-gray-300">{t(row.labelKey)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, i) => (
                        <Kbd key={i}>{k === 'mod' ? mod : k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
