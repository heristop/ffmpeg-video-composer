import {
  FFmpegAvailability,
  FFmpegDetector,
  probeCapabilities,
  TemplateValidator,
  type CapabilityReport,
  type ValidationError,
} from 'ffmpeg-video-composer';

// The capability report of the FFmpeg compose_video renders with (system first, then ffmpeg-static, as
// the engine picks it). The engine caches the probe per binary and version, so after the first call this
// costs one `-version` spawn. Never rejects: a probe that cannot run says so feature by feature.
export async function localCapabilities(): Promise<CapabilityReport> {
  const detection = await FFmpegDetector.detect();
  const binary = detection.availability === FFmpegAvailability.STATIC && detection.path ? detection.path : 'ffmpeg';

  return probeCapabilities({ binary });
}

// `feature_unavailable` findings for validate_template, or undefined when there are none (or the probe
// itself failed — an advisory never turns a valid template into a tool error).
export async function capabilityWarnings(template: unknown): Promise<ValidationError[] | undefined> {
  try {
    const warnings = new TemplateValidator().getCapabilityWarnings(template, await localCapabilities());

    return warnings.length > 0 ? warnings : undefined;
  } catch {
    return undefined;
  }
}
