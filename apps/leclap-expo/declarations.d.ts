/// <reference types="vitest/globals" />

// Vitest globals (describe/it/expect/vi/...) for the colocated *.test.ts files,
// which use them without importing. Type-only — does not affect the Metro bundle.

// Ambient declarations for static asset imports (bundled by Metro at runtime).
// Lets the type-checker resolve `import logo from '@/assets/images/logo.png'`
// without falling back to relative paths.
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.webp';
declare module '*.svg';
declare module '*.mp3';
declare module '*.mp4';
declare module '*.apng';
declare module '*.html';
