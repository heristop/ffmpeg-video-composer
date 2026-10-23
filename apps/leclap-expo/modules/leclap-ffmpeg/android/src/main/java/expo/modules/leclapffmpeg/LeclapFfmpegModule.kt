package expo.modules.leclapffmpeg

import android.system.Os
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.leclap_ffmpeg_core.cancel as nativeCancel
import uniffi.leclap_ffmpeg_core.probe as nativeProbe
import uniffi.leclap_ffmpeg_core.run as nativeRun
import uniffi.leclap_ffmpeg_core.version as nativeVersion

/**
 * Bridges the embedded FFmpeg CLI engine (Rust + fftools) to JS. `run`/`probe` execute an ffmpeg /
 * ffprobe command; both block for the whole job so they run off the JS thread via AsyncFunction.
 */
class LeclapFfmpegModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LeclapFfmpeg")

    // The engine captures ffmpeg's stderr and ffprobe's stdout through a file in Rust's temp_dir(),
    // which reads TMPDIR. Android sets none, so Rust falls back to /data/local/tmp (shell-owned, not
    // writable by the app): the capture silently fails and every log comes back empty.
    OnCreate {
      appContext.reactContext?.cacheDir?.let { Os.setenv("TMPDIR", it.absolutePath, true) }
    }

    Function("version") { nativeVersion() }

    // Cooperative cancel of the in-flight run: sets the static shutdown flags (same effect as SIGTERM); returns before ffmpeg exits.
    Function("cancel") { nativeCancel() }

    AsyncFunction("run") { args: List<String>, promise: Promise ->
      try {
        val result = nativeRun(args)
        promise.resolve(mapOf("code" to result.code, "log" to result.log))
      } catch (e: Throwable) {
        promise.reject("ERR_RUN", e.message ?: "ffmpeg run failed", e)
      }
    }

    AsyncFunction("probe") { args: List<String>, promise: Promise ->
      try {
        val result = nativeProbe(args)
        promise.resolve(mapOf("code" to result.code, "output" to result.output))
      } catch (e: Throwable) {
        promise.reject("ERR_PROBE", e.message ?: "ffprobe failed", e)
      }
    }
  }
}
