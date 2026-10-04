// Keep the authored soundtrack; sources without audio remain valid via the optional map.
export function previewVideoArgs(source: string, destination: string): string[] {
  return [
    '-i',
    source,
    '-vf',
    'scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=0x141416,fps=24',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    destination,
  ];
}
