package expo.modules.leclapspeech

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognitionPart
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.annotation.RequiresApi
import expo.modules.kotlin.Promise
import java.io.File

/**
 * One on-device recognition session over a decoded PCM file (Android 13+). The file is the recogniser's
 * audio source in a segmented session, so the whole clip is transcribed, not just its first utterance.
 * Android 14+ reports per-word timings (RecognitionPart); older on-device recognisers give phrases only,
 * which are spread over the clip by character count and flagged `segmentsOnly` (coarse). On Android 14+,
 * a phrase that still comes without word parts is spread over the gap between its timed neighbours.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
class OnDeviceTranscription(
  private val context: Context,
  private val pcm: File,
  private val seconds: Double,
  private val language: String,
  private val digest: String?,
  private val promise: Promise,
) : RecognitionListener {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var source: ParcelFileDescriptor? = null
  /** A recognised phrase and its timed words, or null words when the recogniser gave no parts. */
  private class Utterance(val text: String, val words: List<Map<String, Any>>?)

  private val utterances = mutableListOf<Utterance>()
  private var settled = false

  fun start() {
    main.post {
      try {
        listen()
      } catch (error: Exception) {
        fail("ERR_SPEECH", "Speech recognition could not start: ${error.message ?: error.javaClass.simpleName}")
      }
    }
  }

  private fun listen() {
    if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
      fail("ERR_SPEECH_UNAVAILABLE", "This device has no on-device speech recognizer.")
      return
    }

    val descriptor = ParcelFileDescriptor.open(pcm, ParcelFileDescriptor.MODE_READ_ONLY)
    source = descriptor
    recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context).also {
      it.setRecognitionListener(this)
      it.startListening(intent(descriptor))
    }
    // Safety net: a recogniser that never ends its session settles with what it heard.
    main.postDelayed({ resolve() }, ((seconds * 2 + 30) * 1000).toLong())
  }

  private fun intent(descriptor: ParcelFileDescriptor) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, descriptor)
    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, PcmDecoder.RATE)
    putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_TIMING, true)
      putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_CONFIDENCE, true)
    }
  }

  private fun collect(results: Bundle?) {
    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()

    if (text.isNullOrEmpty()) return

    val timed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) collectParts(results) else null

    utterances.add(Utterance(text, timed))
  }

  @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun collectParts(results: Bundle): List<Map<String, Any>>? {
    val parts = results.getParcelableArrayList(SpeechRecognizer.RECOGNITION_PARTS, RecognitionPart::class.java)

    if (parts.isNullOrEmpty()) return null

    val words = mutableListOf<Map<String, Any>>()

    parts.forEachIndexed { index, part ->
      val start = part.timestampMillis / 1000.0
      val text = part.formattedText ?: part.rawText
      val next = parts.getOrNull(index + 1)?.timestampMillis?.div(1000.0)
      val spoken = start + maxOf(0.15, 0.07 * text.length)
      val word = mutableMapOf<String, Any>("text" to text, "start" to start, "end" to minOf(spoken, next ?: spoken))
      if (part.confidenceLevel > 0) word["confidence"] = part.confidenceLevel / 5.0
      words.add(word)
    }

    return words
  }

  // Pieces of text laid end to end over [from, to] by character count (coarse).
  private fun spread(pieces: List<String>, from: Double, to: Double): List<Map<String, Any>> {
    val total = pieces.sumOf { it.length }.coerceAtLeast(1)
    val span = (to - from).coerceAtLeast(0.0)
    var cursor = from

    return pieces.map { piece ->
      val start = cursor
      cursor += span * piece.length / total
      mapOf("text" to piece, "start" to start, "end" to cursor)
    }
  }

  // Timed words in order; a phrase without parts fills the gap between its timed neighbours, word by word.
  private fun timedWords(): List<Map<String, Any>> {
    val result = mutableListOf<Map<String, Any>>()

    utterances.forEachIndexed { index, utterance ->
      if (utterance.words != null) {
        result.addAll(utterance.words)
        return@forEachIndexed
      }

      val from = (result.lastOrNull()?.get("end") as? Double) ?: 0.0
      val next = utterances.drop(index + 1).firstNotNullOfOrNull { it.words?.firstOrNull()?.get("start") as? Double }
      val to = maxOf(from, next ?: seconds)
      result.addAll(spread(utterance.text.split(Regex("\\s+")).filter { it.isNotEmpty() }, from, to))
    }

    return result
  }

  private fun resolve() {
    if (settled) return
    settled = true
    cleanup()

    val payload = mutableMapOf<String, Any>("language" to language)
    val timed = utterances.any { it.words != null }
    payload["words"] = if (timed) timedWords() else emptyList<Map<String, Any>>()
    payload["segmentsOnly"] = !timed
    if (!timed) payload["segments"] = spread(utterances.map { it.text }, 0.0, seconds)
    digest?.let { payload["digest"] = it }
    promise.resolve(payload)
  }

  private fun fail(code: String, message: String) {
    if (settled) return
    settled = true
    cleanup()
    promise.reject(code, message, null)
  }

  private fun cleanup() {
    main.removeCallbacksAndMessages(null)
    recognizer?.destroy()
    recognizer = null
    source?.close()
    source = null
    pcm.delete()
  }

  private fun languageMissing() {
    source?.let { recognizer?.triggerModelDownload(intent(it)) }
    fail(
      "ERR_SPEECH_LANGUAGE",
      "The on-device model for $language is not installed; its download was requested. Try again once it is done.",
    )
  }

  override fun onSegmentResults(segmentResults: Bundle) = collect(segmentResults)

  override fun onEndOfSegmentedSession() = resolve()

  override fun onResults(results: Bundle?) {
    collect(results)
    resolve()
  }

  override fun onError(error: Int) {
    when (error) {
      SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> languageMissing()
      SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> resolve()
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> fail("ERR_SPEECH_PERMISSION", "Microphone permission is required")
      else -> if (utterances.isNotEmpty()) resolve() else fail("ERR_SPEECH", "Speech recognition failed (code $error)")
    }
  }

  override fun onReadyForSpeech(params: Bundle?) = Unit

  override fun onBeginningOfSpeech() = Unit

  override fun onRmsChanged(rmsdB: Float) = Unit

  override fun onBufferReceived(buffer: ByteArray?) = Unit

  override fun onEndOfSpeech() = Unit

  override fun onPartialResults(partialResults: Bundle?) = Unit

  override fun onEvent(eventType: Int, params: Bundle?) = Unit
}
