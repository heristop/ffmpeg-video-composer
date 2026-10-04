// Type definitions for the application

import type { TemplateOrientation } from '@leclap/creative-kit';

// Single source of truth for the orientation union (landscape | portrait | square) lives in
// @leclap/creative-kit; re-export under the app-local name the screens already use.
export type Orientation = TemplateOrientation;

export interface Template {
  id?: string;
  name: string;
  content: TemplateDescriptor;
  /** `user` = built by the user in the editor; `sample` = a bundled @leclap/creative-kit template. */
  source?: 'sample' | 'user';
}

export interface TemplateDescriptor {
  meta?: { name?: string; description?: string };
  global?: {
    variables?: Record<string, string | string[]>;
    orientation?: Orientation;
    colorsList?: string[];
    musicEnabled?: boolean;
    transition?: {
      type: string;
      duration?: number;
    };
    audio?: {
      sourceVolume?: number;
      musicVolume?: number;
      normalize?: 'loudnorm' | 'dynaudnorm';
      ducking?: boolean | object;
    };
    music?: {
      name: string;
      url?: string;
    };
    allowedMusic?: string[];
    allowUploadMusic?: boolean;
    allowedBackgrounds?: string[];
    allowUploadBackground?: boolean;
  };
  sections?: Section[];
}

export interface FramingGuide {
  type: 'silhouette';
  position: 'left' | 'center' | 'right';
  opacity?: number;
  style?: 'bust' | 'outline';
}

export interface Section {
  name: string;
  type: string;
  options?: {
    upperCase?: boolean;
    lowerCase?: boolean;
    useVideoSection?: string;
    duration?: number;
    musicVolume?: number;
    fields?: Field[];
    speed?: number;
    muteSection?: boolean;
    countdown?: boolean;
    countdownDuration?: number;
    videoUrl?: string;
    logoUrl?: string;
    backgroundUrl?: string;
    backgroundColor?: string;
    forceAspectRatio?: boolean;
    forceOriginalAspectRatio?: boolean;
    framingGuide?: FramingGuide;
  };
  inputs?: { name: string; url: string }[];
  maps?: unknown[]; // Maps for FFMPEG operations
  filters?: unknown[]; // Filters for FFMPEG operations
  title?: { [key: string]: string };
  description?: { [key: string]: string }; // Section description for UI display
}

export interface Field {
  name: string;
  maxLength: number;
  label: { [key: string]: string };
  description?: { [key: string]: string }; // Field description for UI display
}

export interface Project {
  id: string;
  name: string;
  templateName: string;
  templateContent: TemplateDescriptor;
  status: 'draft' | 'processing' | 'completed' | 'failed';
  formData: Record<string, unknown>;
  recordedVideos: Record<
    string,
    {
      path: string;
      orientation: Orientation;
      duration?: number;
      fileSize?: number;
      // User edits chosen on the preview screen. `trim` is in seconds; `crop` is
      // normalized to the source frame (0..1) so it is resolution-independent.
      trim?: { start: number; end: number };
      crop?: { x: number; y: number; w: number; h: number };
    }
  >;
  outputVideoUri?: string;
  thumbnailUri?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A single media pick made by the end-user on the builder's Media step. */
export type MediaChoice = { kind: 'library'; id: string } | { kind: 'upload'; uri: string; name: string };

/** The combined music + background choices a user may make before compiling. */
export interface MediaChoices {
  music?: MediaChoice;
  background?: MediaChoice;
}

/** A resolved media file ready to attach to a multipart POST. */
export interface ResolvedMediaFile {
  uri: string;
  name: string;
  mimeType: string;
}

const TypesExport = {
  name: 'Types',
};
export default TypesExport;
