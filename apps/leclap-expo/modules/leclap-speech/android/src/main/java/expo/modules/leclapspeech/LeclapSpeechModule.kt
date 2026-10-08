package expo.modules.leclapspeech

import android.Manifest
import android.net.Uri
import android.os.Build
import android.speech.SpeechRecognizer
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale

/**
 * On-device transcription of a recorded clip for auto-captions. Only the on-device recogniser is used
 * (SpeechRecognizer.createOnDeviceSpeechRecognizer, Android 13+): without it the calls refuse with a
 * reason instead of streaming audio to a server. The clip's audio is decoded to 16 kHz mono PCM and fed
 * to the recogniser as its audio source in one segmented session.
 */
class LeclapSpeechModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LeclapSpeech")

    AsyncFunction("isAvailable") { _: String? -> availability() }

    AsyncFunction("requestPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.RECORD_AUDIO)
    }

    AsyncFunction("transcribeFile") { uri: String, options: Map<String, Any?>, promise: Promise ->
      val language = options["language"] as? String ?: Locale.getDefault().toLanguageTag()
      transcribe(uri, language, promise)
    }
  }

  private fun availability(): Map<String, Any> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return mapOf("available" to false, "onDevice" to false, "reason" to NEEDS_ANDROID_13)
    }

    if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
      return mapOf(
        "available" to false,
        "onDevice" to false,
        "reason" to "This device has no on-device speech recognizer (install or update Google's Speech Services).",
      )
    }

    return mapOf("available" to true, "onDevice" to true)
  }

  private fun transcribe(uri: String, language: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.reject("ERR_SPEECH_UNAVAILABLE", NEEDS_ANDROID_13, null)
      return
    }

    val source = Uri.parse(if (uri.startsWith("/")) "file://$uri" else uri)
    val pcm = File(context.cacheDir, "leclap-speech-${System.nanoTime()}.pcm")

    try {
      val decoded = PcmDecoder.decode(context, source, pcm)
      val digest = FileDigest.sha256(context, source)
      OnDeviceTranscription(context, pcm, decoded.seconds, language, digest, promise).start()
    } catch (error: Throwable) {
      pcm.delete()
      promise.reject("ERR_SPEECH_AUDIO", error.message ?: "Cannot read the audio of this clip", error)
    }
  }

  companion object {
    const val NEEDS_ANDROID_13 = "On-device speech recognition needs Android 13 or newer."
  }
}
