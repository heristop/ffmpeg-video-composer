export default class defaultConfig {
  static readonly VIDEO_CODEC: string = '';
  static readonly AUDIO_CODEC: string = '';
  static readonly HWACCEL: string | null = null;
  static readonly PRESET: string = 'ultrafast';

  static readonly SAMPLE_RATE: number = 44100;
  static readonly CHANNEL_LAYOUT: string = 'stereo';
  static readonly ORIENTATION: string = 'landscape';
  static readonly SCALE: string = '1280:720';
  static readonly SETSAR: string = '1/1';
  static readonly CURRENT_LOCALE: string = 'en';
}
