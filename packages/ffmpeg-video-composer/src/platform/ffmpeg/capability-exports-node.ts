// The capability doctor's public surface, re-exported by the Node entry only (it spawns FFmpeg).
export {
  probeCapabilities,
  probeCapabilitiesUncached,
  type ProbeOptions,
  type ProbeOutput,
  type ProbeRunner,
} from './capability-probe-node';
export {
  CAPABILITY_FEATURES,
  type CapabilityFeature,
  type CapabilityReport,
  type FeatureStatus,
  type FeatureUsable,
} from '../../core/capabilities';
