import { createElement, useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Monitor,
  Globe,
  ChevronDown,
  Lightbulb,
} from '@/presentation/components/icons';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Card, Badge } from '@/presentation/components/ui';

type CheckId = 'wasm' | 'sab' | 'coi' | 'fileApi' | 'workers';
type CheckStatus = 'supported' | 'unsupported' | 'partial' | 'checking';

interface CompatibilityCheck {
  id: CheckId;
  status: CheckStatus;
  required: boolean;
}

interface BrowserInfo {
  name: string;
  version: string;
  recommendation?: string;
}

const INITIAL_CHECKS = [
  { id: 'wasm', status: 'checking', required: true },
  { id: 'sab', status: 'checking', required: true },
  { id: 'coi', status: 'checking', required: true },
  { id: 'fileApi', status: 'checking', required: true },
  { id: 'workers', status: 'checking', required: false },
] as const satisfies readonly CompatibilityCheck[];

const runCompatibilityChecks = (current: CompatibilityCheck[]): CompatibilityCheck[] => {
  const newChecks = [...current];
  newChecks[0] = { ...newChecks[0], status: typeof WebAssembly === 'object' ? 'supported' : 'unsupported' };
  newChecks[1] = { ...newChecks[1], status: typeof SharedArrayBuffer === 'undefined' ? 'unsupported' : 'supported' };
  newChecks[2] = { ...newChecks[2], status: crossOriginIsolated ? 'supported' : 'unsupported' };
  newChecks[3] = {
    ...newChecks[3],
    status: typeof File !== 'undefined' && typeof FileReader !== 'undefined' ? 'supported' : 'unsupported',
  };
  newChecks[4] = { ...newChecks[4], status: typeof Worker === 'undefined' ? 'unsupported' : 'supported' };

  return newChecks;
};

const resolveBrowserVersion = (userAgent: string, pattern: RegExp): string =>
  userAgent.match(pattern)?.[1] ?? 'Unknown';

const buildRecommendation = (t: TFunction<'browser'>, browser: string, version: string): string =>
  t('updateBrowser', { browser, version });

const resolveChrome = (userAgent: string, t: TFunction<'browser'>): BrowserInfo => {
  const version = resolveBrowserVersion(userAgent, /Chrome\/(\d+)/);
  const versionNum = parseInt(version, 10);

  return {
    name: 'Chrome',
    version,
    ...(versionNum < 88 && { recommendation: buildRecommendation(t, 'Chrome', '88') }),
  };
};

const resolveFirefox = (userAgent: string, t: TFunction<'browser'>): BrowserInfo => {
  const version = resolveBrowserVersion(userAgent, /Firefox\/(\d+)/);
  const versionNum = parseInt(version, 10);

  return {
    name: 'Firefox',
    version,
    ...(versionNum < 79 && { recommendation: buildRecommendation(t, 'Firefox', '79') }),
  };
};

const resolveSafari = (userAgent: string, t: TFunction<'browser'>): BrowserInfo => {
  const version = resolveBrowserVersion(userAgent, /Version\/(\d+)/);
  const versionNum = parseInt(version, 10);

  return {
    name: 'Safari',
    version,
    ...(versionNum < 14 && { recommendation: buildRecommendation(t, 'Safari', '14') }),
  };
};

const detectBrowser = (t: TFunction<'browser'>): BrowserInfo => {
  const userAgent = navigator.userAgent;

  if (userAgent.includes('Chrome')) return resolveChrome(userAgent, t);

  if (userAgent.includes('Firefox')) return resolveFirefox(userAgent, t);

  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return resolveSafari(userAgent, t);

  return { name: 'Unknown', version: 'Unknown' };
};

const getBrowserIcon = (name: string) => {
  switch (name) {
    case 'Safari':
      return Globe;
    case 'Firefox':
      return Monitor;
    case 'Chrome':
      return Monitor;
    default:
      return Info;
  }
};

const statusColor: Record<CheckStatus, string> = {
  supported: 'text-[var(--color-success)]',
  unsupported: 'text-[var(--color-error)]',
  partial: 'text-[var(--color-warning)]',
  checking: 'text-gray-500',
};

const CheckItem = ({ check, t }: { check: CompatibilityCheck; t: TFunction<'browser'> }) => (
  <div className="flex items-center gap-3 p-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/10">
    <span className={clsx('shrink-0', statusColor[check.status])}>
      {check.status === 'supported' && <CheckCircle2 className="w-4 h-4" />}
      {check.status === 'unsupported' && <XCircle className="w-4 h-4" />}
      {check.status === 'partial' && <AlertTriangle className="w-4 h-4" />}
      {check.status === 'checking' && (
        <span className="block w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
      )}
    </span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-foreground truncate">{t(`checks.${check.id}.name`)}</p>
        {check.required && (
          <Badge variant="neutral" className="px-1.5 py-0.5 text-[0.6rem] tracking-wide text-gray-500 rounded">
            {t('required')}
          </Badge>
        )}
      </div>
      <p className="text-xs text-gray-500">{t(`checks.${check.id}.description`)}</p>
    </div>
  </div>
);

interface RecommendationsProps {
  browserInfo: BrowserInfo | null;
  overallStatus: 'supported' | 'partial';
  t: TFunction<'browser'>;
}

const Recommendations = ({ browserInfo, overallStatus, t }: RecommendationsProps) => {
  if (!browserInfo?.recommendation && overallStatus === 'supported') {
    return null;
  }

  return (
    <div className="p-3.5 rounded-xl bg-brand-500/[0.06] border border-brand-500/20">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-300 mb-2">
        <Lightbulb className="w-4 h-4" /> {t('recommendations')}
      </h4>
      <ul className="text-sm text-gray-400 space-y-1">
        {browserInfo?.recommendation && <li>• {browserInfo.recommendation}</li>}
        {overallStatus !== 'supported' && (
          <>
            <li>• {t('recommendBrowsers')}</li>
            <li>• {t('recommendFeatures')}</li>
            <li>• {t('recommendHttps')}</li>
          </>
        )}
      </ul>
    </div>
  );
};

interface ExpandedContentProps {
  checks: CompatibilityCheck[];
  supportedCount: number;
  overallStatus: 'supported' | 'partial';
  isExpanded: boolean;
  browserInfo: BrowserInfo | null;
  t: TFunction<'browser'>;
}

const ExpandedContent = ({
  checks,
  supportedCount,
  overallStatus,
  isExpanded,
  browserInfo,
  t,
}: ExpandedContentProps) => (
  <div
    className={clsx(
      'grid transition-all duration-300 ease-in-out',
      isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
    )}
  >
    <div className="overflow-hidden">
      <div className="p-4 pt-0 space-y-4 border-t border-foreground/10">
        <div className="pt-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium text-gray-400">
              {t('featuresSupported', { count: supportedCount, total: checks.length })}
            </span>
            <span
              className={clsx(
                'font-semibold',
                overallStatus === 'supported' ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'
              )}
            >
              {Math.round((supportedCount / checks.length) * 100)}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-foreground/10 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-500',
                overallStatus === 'supported' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'
              )}
              style={{ width: `${(supportedCount / checks.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {checks.map((check) => (
            <CheckItem key={check.id} check={check} t={t} />
          ))}
        </div>

        <Recommendations browserInfo={browserInfo} overallStatus={overallStatus} t={t} />
      </div>
    </div>
  </div>
);

interface StatusPillProps {
  checked: boolean;
  browserInfo: BrowserInfo | null;
  onOpen: () => void;
  t: TFunction<'browser'>;
}

// The status as one quiet line: a light (grey while checking, green when ready), the verdict and the
// browser. It opens the full panel for anyone who wants the per-feature detail.
const StatusPill = ({ checked, browserInfo, onOpen, t }: StatusPillProps) => (
  <button
    type="button"
    onClick={onOpen}
    disabled={!checked}
    aria-expanded={false}
    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-foreground/10 bg-surface-2/60 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-default"
  >
    <span
      aria-hidden="true"
      className={clsx(
        'size-2 shrink-0 rounded-full',
        checked ? 'bg-[var(--color-success)]' : 'animate-pulse bg-foreground/30 motion-reduce:animate-none'
      )}
    />
    <span className="sr-only">{t('title')}: </span>
    {checked ? t('ready') : t('checking')}
    {checked && browserInfo && (
      <>
        <span aria-hidden="true" className="text-foreground/25">
          ·
        </span>
        <span>
          {browserInfo.name} {browserInfo.version}
        </span>
      </>
    )}
    {checked && <ChevronDown aria-hidden="true" className="size-3.5" />}
  </button>
);

const BrowserSummaryCard = ({
  isOk,
  isExpanded,
  setIsExpanded,
  browserInfo,
  BrowserIcon,
  checks,
  supportedCount,
  overallStatus,
  t,
}: {
  isOk: boolean;
  isExpanded: boolean;
  setIsExpanded: (value: boolean) => void;
  browserInfo: BrowserInfo | null;
  BrowserIcon: typeof Info;
  checks: CompatibilityCheck[];
  supportedCount: number;
  overallStatus: 'supported' | 'partial';
  t: ReturnType<typeof useTranslation<'browser'>>['t'];
}) => (
  <div className="mb-8 fade-in">
    <Card
      elevation="flat"
      className={clsx(
        'transition-colors duration-300 overflow-hidden',
        isOk
          ? 'bg-[var(--color-success)]/[0.07] border-[var(--color-success)]/25'
          : 'bg-[var(--color-warning)]/[0.07] border-[var(--color-warning)]/25'
      )}
    >
      <Button
        variant="ghost"
        type="button"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-4 p-4 text-left rounded-2xl rounded-b-none font-normal hover:bg-foreground/[0.03] [&_svg]:size-auto"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={clsx(
              'grid place-items-center w-10 h-10 rounded-xl shadow-sm shrink-0',
              isOk
                ? 'bg-[var(--color-success)] shadow-[var(--color-success)]/20'
                : 'bg-[var(--color-warning)] shadow-[var(--color-warning)]/20'
            )}
          >
            {isOk ? <CheckCircle2 className="w-5 h-5 text-white" /> : <AlertTriangle className="w-5 h-5 text-white" />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
            <p className="text-xs text-gray-400 truncate">{isOk ? t('statusOk') : t('statusLimited')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {browserInfo ? (
            <Badge
              variant="neutral"
              className="hidden sm:inline-flex gap-1.5 text-xs normal-case tracking-normal font-normal text-gray-400 px-3 py-1.5"
            >
              {createElement(BrowserIcon, { className: 'w-3.5 h-3.5' })}
              {browserInfo.name} {browserInfo.version}
            </Badge>
          ) : null}
          <ChevronDown
            className={clsx('w-5 h-5 text-gray-400 transition-transform duration-300', isExpanded && 'rotate-180')}
          />
        </div>
      </Button>
      <ExpandedContent
        checks={checks}
        supportedCount={supportedCount}
        overallStatus={overallStatus}
        isExpanded={isExpanded}
        browserInfo={browserInfo}
        t={t}
      />
    </Card>
  </div>
);

export const BrowserCompatibility = () => {
  const { t } = useTranslation('browser');
  const [checks, setChecks] = useState<CompatibilityCheck[]>(() => INITIAL_CHECKS.map((check) => ({ ...check })));
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const checksRef = useRef(checks);
  useEffect(() => {
    // The checks are instant; the timer only moves the state update out of the effect's own pass.
    const timer = setTimeout(() => {
      const newChecks = runCompatibilityChecks(checksRef.current);
      setChecks(newChecks);
      setBrowserInfo(detectBrowser(t));
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [t]);

  const supportedCount = checks.filter((check) => check.status === 'supported').length;
  const requiredCount = checks.filter((check) => check.required).length;
  const requiredSupported = checks.filter((check) => check.required && check.status === 'supported').length;
  const overallStatus: 'supported' | 'partial' = requiredSupported === requiredCount ? 'supported' : 'partial';
  const isOk = overallStatus === 'supported';
  // Until the checks have run, "partial" only means "not checked yet": show nothing alarming.
  const checked = checks.every((check) => check.status !== 'checking');

  const BrowserIcon = browserInfo ? getBrowserIcon(browserInfo.name) : Info;

  // A browser that can render needs no panel on every visit: while the checks run, and whenever they all
  // pass, the status is one quiet pill. The full panel opens on demand — and by itself when something is
  // missing, the one case worth the room.
  if (!checked || (isOk && !isExpanded)) {
    return (
      <div className="mb-8 fade-in">
        <StatusPill
          checked={checked}
          browserInfo={browserInfo}
          onOpen={() => {
            setIsExpanded(true);
          }}
          t={t}
        />
      </div>
    );
  }

  return (
    <BrowserSummaryCard
      isOk={isOk}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      browserInfo={browserInfo}
      BrowserIcon={BrowserIcon}
      checks={checks}
      supportedCount={supportedCount}
      overallStatus={overallStatus}
      t={t}
    />
  );
};
