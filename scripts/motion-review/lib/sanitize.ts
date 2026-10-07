import { existsSync } from 'node:fs';
import path from 'node:path';
import { assetFile, footageUrl, isLfsPointer, REVIEW_DIR } from './media.ts';
import type { Format, Json, JsonObject } from './types.ts';

// Make a descriptor renderable offline and without LFS, recording every substitution as a note so the
// index says exactly what a sheet does NOT show: music off, remote clips → local stand-ins, pointer
// footage/pictures → stand-ins, pointer animations dropped ("pointer, not rendered").

const REMOTE_MEDIA = /^https?:\/\/.+\.(mp4|mov|webm|png|jpe?g|apng|gif)$/i;
const PICTURE = /\.(png|jpe?g|webp)$/i;

export interface Sanitized {
  descriptor: JsonObject;
  notes: string[];
  /** Animation URLs dropped because their asset is an LFS pointer (or missing). */
  dropped: string[];
}

interface Context {
  assetsRoot: string;
  format: Format;
  notes: Set<string>;
  dropped: Set<string>;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unavailableAnimation(url: string, ctx: Context): boolean {
  if (!url.toLowerCase().endsWith('.apng')) return false;

  const file = assetFile(ctx.assetsRoot, url);

  return file !== null && (!existsSync(file) || isLfsPointer(file));
}

function localUrl(url: string, ctx: Context): string {
  const local = `/assets/${PICTURE.test(url) ? 'pictures' : 'videos'}/${path.basename(url)}`;
  const file = assetFile(ctx.assetsRoot, local);

  if (file !== null && existsSync(file)) return local;

  return PICTURE.test(url) ? `/assets/${REVIEW_DIR}/picture.png` : footageUrl(ctx.format);
}

function rewriteString(value: string, ctx: Context): string {
  if (REMOTE_MEDIA.test(value)) {
    const local = localUrl(value, ctx);

    ctx.notes.add(`remote ${path.basename(value)} → ${local}`);

    return rewriteString(local, ctx);
  }

  const file = assetFile(ctx.assetsRoot, value);

  if (file !== null && isLfsPointer(file) && !value.endsWith('.apng')) {
    ctx.notes.add(`LFS pointer ${value.slice('/assets/'.length)} → stand-in`);
  }

  return value;
}

function keep(item: Json, ctx: Context): boolean {
  if (!isObject(item) || typeof item.url !== 'string' || !unavailableAnimation(item.url, ctx)) return true;

  ctx.dropped.add(item.url);

  return false;
}

function walk(value: Json, ctx: Context): Json {
  if (typeof value === 'string') return rewriteString(value, ctx);

  if (Array.isArray(value)) return value.filter((item) => keep(item, ctx)).map((item) => walk(item, ctx));

  if (!isObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, ctx)]));
}

export function sanitize(descriptor: JsonObject, assetsRoot: string, format: Format): Sanitized {
  const ctx: Context = { assetsRoot, format, notes: new Set(), dropped: new Set() };
  const out = walk(descriptor, ctx) as JsonObject;
  const global = isObject(out.global) ? out.global : {};

  if (global.musicEnabled !== false) ctx.notes.add('music off');

  out.global = { ...global, musicEnabled: false };

  for (const url of ctx.dropped) ctx.notes.add(`pointer, not rendered: ${url.slice('/assets/'.length)}`);

  return { descriptor: out, notes: [...ctx.notes], dropped: [...ctx.dropped] };
}
