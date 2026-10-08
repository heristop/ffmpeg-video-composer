// Registers the Node transcription service behind the compile-time `subtitles.transcribe` pass
// (director/transcribe-sections.ts): whisper.cpp through transcribe-media-node.ts, decoding with the
// binary of the FFmpeg adapter the bridge selected. A host (or a test) that registered its own service
// first keeps it. The model is only downloaded with LECLAP_WHISPER_DOWNLOAD=1 (`leclap render
// --download-model` sets it); otherwise a missing model fails the build with whisper_model_missing.

import { container } from 'tsyringe';
import type AbstractFFmpeg from '../../platform/ffmpeg/AbstractFFmpeg';
import { TRANSCRIPTION_SERVICE, type TranscriptionService } from '../../director/transcribe-sections';
import { nodeTranscriptionService } from './transcribe-media-node';

function adapterFfmpeg(): string | undefined {
  return container.isRegistered('ffmpegAdapter')
    ? container.resolve<AbstractFFmpeg>('ffmpegAdapter').binaries?.ffmpeg
    : undefined;
}

export function registerTranscription(): void {
  if (container.isRegistered(TRANSCRIPTION_SERVICE)) return;

  container.registerInstance<TranscriptionService>(TRANSCRIPTION_SERVICE, nodeTranscriptionService(adapterFfmpeg));
}
