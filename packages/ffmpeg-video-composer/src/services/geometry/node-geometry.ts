import { fontAssetUrl } from '@/core/asset-source';
import { parseFontMetrics } from '@/core/font-metrics';
import { findFontByFile } from '@/core/fonts';
import FilesystemNodeAdapter from '../../platform/filesystem/FilesystemNodeAdapter';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import type { TemplateDescriptor } from '../../schemas/template.schemas';
import { TemplateValidator } from '../TemplateValidator';
import { createBundledFontLoader, type FontLoader } from './bundled-font-loader';
import type { GeometryWarning } from './rules';
import { htmlOverflowWarnings } from '../html-node/html-overflow-node';

// Node-only: the one place the geometry check is allowed to reach disk and network. Exported from
// the Node entry alone, so the geometry module itself stays reachable from the browser and
// React-Native builds. The CLI and the MCP server both call `nodeGeometryWarnings` rather than
// wiring the loader themselves — two hand-rolled copies had already drifted apart.

// Appended to a finding drawn from an estimate, saying WHY — "estimated" alone left the author no way
// to make it exact. Agents parse it out of the MCP `geometry` array, so the CLI and the MCP server
// print it through this one function.
const APPROX_NOTES: Record<string, string> = {
  font: ' (approx: font unavailable, width estimated)',
  variable: ' (approx: {{ variable }} length unknown until render)',
  duration: ' (approx: section duration assumed)',
};

export function geometryApproxNote(warning: Pick<GeometryWarning, 'approx' | 'approxReason'>): string {
  if (!warning.approx) {
    return '';
  }

  return APPROX_NOTES[warning.approxReason ?? ''] ?? ' (approx: estimated)';
}

// A catalog download that makes no progress for this long is abandoned and its font measured
// approximately: validation is a dry run, and `leclap validate` / `validate_template` must answer
// even when the asset host blackholes the connection or stalls mid-body — a stalled promise would
// otherwise sit in cachedFontLoader and hang every later call that needs the same font. No catalog
// font comes near the size cap.
const FONT_FETCH_LIMITS = { timeoutMs: 5000, maxBytes: 4 * 1024 * 1024 };

// What the Node loader needs from a filesystem: the bundled-font lookup, and a download that lands
// in memory. Not `fetch()`: that stages at `tempDir/<basename>`, the very path AssetManager.stageFont
// downloads a catalog font to before moving it into a render's fontsDir — so a validate running
// beside a render (an MCP compose_video worker, another `leclap` process) truncated and deleted the
// file the render was about to stage.
export interface NodeFontSource extends Pick<AbstractFilesystem, 'resolveBundledFont' | 'readFile'> {
  fetchBytes(url: string, limits: { timeoutMs: number; maxBytes: number }): Promise<Uint8Array>;
}

// Bundled first, then the catalog URL the renderer stages from (AssetManager.stageFont). A published
// install ships no fonts, so without the fetch every `pnpm dlx @leclap/cli validate` measured the
// estimate while the render used the real typeface. Offline, or a file the catalog does not know,
// degrades to null — the caller measures approximately and flags it.
export function createNodeFontLoader(filesystem: NodeFontSource): FontLoader {
  const bundled = createBundledFontLoader(filesystem);

  return async (fontFile: string): Promise<Uint8Array | null> => {
    const local = await bundled(fontFile);

    if (local || !findFontByFile(fontFile)) {
      return local;
    }

    try {
      const bytes = await filesystem.fetchBytes(fontAssetUrl(fontFile), FONT_FETCH_LIMITS);

      // Only a font is a successful load. A 200 that is really a captive-portal page, an empty body,
      // or a redirect's body would otherwise be kept by cachedFontLoader for the life of the process:
      // approximate measurements until restart, the exact failure its eviction exists to prevent.
      return parseFontMetrics(bytes) ? bytes : null;
    } catch {
      return null;
    }
  };
}

// Only a SUCCESSFUL read is kept for the life of the process. A null or a rejection evicts: caching
// one transient failure — an EMFILE under load, a dropped connection — would pin a long-lived MCP
// server to approximate measurements until restart, with nothing in the output to say why.
export function cachedFontLoader(loader: FontLoader): FontLoader {
  const cache = new Map<string, Promise<Uint8Array | null>>();

  return (fontFile: string): Promise<Uint8Array | null> => {
    const cached = cache.get(fontFile);

    if (cached) {
      return cached;
    }

    const pending = loader(fontFile).then(
      (bytes) => {
        if (!bytes) {
          cache.delete(fontFile);
        }

        return bytes;
      },
      (error: unknown) => {
        cache.delete(fontFile);

        throw error;
      }
    );

    cache.set(fontFile, pending);

    return pending;
  };
}

// The loader's filesystem adapter never logs — resolveBundledFont, readFile and fetchBytes are all
// silent — so it gets a no-op logger. A PinoLogAdapter here read LECLAP_LOG_LEVEL at construction and
// threw on a level pino does not know ('off', 'warning'); inside nodeGeometryWarnings' degrade path
// that dropped every finding, font-free rules included, and the template was reported clean.
const SILENT_LOGGER: AbstractLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

let defaultLoader: FontLoader | undefined;

// Built on first use rather than at import, so merely importing the engine constructs nothing. Shared
// with the rendered check, so both measure with the same cached fonts.
export function nodeFontLoader(): FontLoader {
  defaultLoader ??= cachedFontLoader(createNodeFontLoader(new FilesystemNodeAdapter(SILENT_LOGGER)));

  return defaultLoader;
}

interface NodeGeometryOptions {
  validator?: Pick<TemplateValidator, 'getGeometryWarnings'>;
  loadFont?: FontLoader;
}

// Advisory, so it must never fail the caller: a throw degrades to no findings. Not in silence —
// every expected failure is already absorbed by the loader and the parser, so anything landing here
// is a bug, and stderr keeps it visible without corrupting `--json` or the MCP protocol on stdout.
export async function nodeGeometryWarnings(
  descriptor: TemplateDescriptor,
  options: NodeGeometryOptions = {}
): Promise<GeometryWarning[]> {
  try {
    const validator = options.validator ?? new TemplateValidator();
    const loadFont = options.loadFont ?? nodeFontLoader();
    const measured = await validator.getGeometryWarnings(descriptor, loadFont);

    // HTML layers are laid out by Satori here (Node only), loaded only when the template has one.
    return [...measured, ...(await htmlOverflowWarnings(descriptor, loadFont))];
  } catch (error) {
    process.stderr.write(`geometry checks skipped: ${error instanceof Error ? error.message : String(error)}\n`);

    return [];
  }
}
