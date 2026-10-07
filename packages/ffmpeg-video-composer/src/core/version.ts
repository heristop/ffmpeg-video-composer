// The engine version recorded in render manifests. Kept as a literal (not read from package.json at
// runtime) so the browser and Hermes bundles carry it too; tests/engine-version.test.ts fails when it
// drifts from package.json, so a release bump updates both together.
export const ENGINE_VERSION = '2.5.0';
