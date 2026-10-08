// The section background (an image_background picture, a video's clip URL) is injected by
// AssetManager.prepareAssets as the section's first input, named after the section. That name is the
// author's too: an overlay input may legitimately share it. So the background is recognized by
// identity, never by name, wherever inputs are numbered, staged or referenced.
const backgrounds = new WeakSet<object>();

export function markBackgroundInput<T extends object>(input: T): T {
  backgrounds.add(input);

  return input;
}

export function isBackgroundInput(input: object | undefined): boolean {
  return input !== undefined && backgrounds.has(input);
}
