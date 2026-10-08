import type { McpServer } from '@modelcontextprotocol/server';

import type { McpConfig } from '../config.js';
import { registerProbe } from './probeMedia.js';
import { registerExtractStyle } from './extractStyle.js';
import { registerAnalyzeMusic } from './analyzeMusic.js';
import { registerAnalyzeSound } from './analyzeSound.js';
import { registerTranscribeMedia } from './transcribe-media.js';

// Media inspection and measurement: probe a file, extract a reference style, time music, hear a sound,
// transcribe speech.
export function registerMediaAnalysis(server: McpServer, config: McpConfig): void {
  registerProbe(server, config);
  registerExtractStyle(server, config);
  registerAnalyzeMusic(server, config);
  registerAnalyzeSound(server, config);
  registerTranscribeMedia(server, config);
}
