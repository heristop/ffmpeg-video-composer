package expo.modules.leclapspeech

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteOrder
import kotlin.math.roundToLong

/**
 * Decodes a clip's first audio track to raw 16 kHz mono 16-bit little-endian PCM (the audio-source
 * format the recogniser is told), downmixing channels and resampling linearly.
 */
object PcmDecoder {
  const val RATE = 16000
  private const val TIMEOUT_US = 10_000L

  data class Decoded(val seconds: Double)

  /** Streams mono samples at any rate out as 16 kHz PCM. */
  private class Resampler(private val out: BufferedOutputStream) {
    var sourceRate = RATE
    private var index = 0L
    private var next = 0.0
    private var previous = 0f
    var written = 0L

    fun push(sample: Float) {
      val step = sourceRate.toDouble() / RATE
      while (next <= index) {
        val fraction = (next - (index - 1)).coerceIn(0.0, 1.0)
        write(previous + (sample - previous) * fraction.toFloat())
        next += step
      }
      previous = sample
      index += 1
    }

    /** Silence before the first sample, so PCM time 0 stays clip time 0. */
    fun pad(seconds: Double) {
      repeat((seconds * RATE).roundToLong().toInt()) { write(0f) }
    }

    private fun write(value: Float) {
      val clamped = (value.coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt()
      out.write(clamped and 0xff)
      out.write((clamped shr 8) and 0xff)
      written += 1
    }
  }

  /**
   * Output layout, plus where the first decoded sample sits: a track starting late (positive
   * presentationTimeUs) is padded with silence, encoder priming (negative) is skipped.
   */
  private class Frame(var channels: Int, var float: Boolean) {
    var started = false
    var skip = 0L
  }

  fun decode(context: Context, uri: Uri, target: File): Decoded {
    val extractor = MediaExtractor()
    extractor.setDataSource(context, uri, null)

    try {
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IllegalArgumentException("This clip has no audio track")

      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)

      try {
        codec.configure(format, null, null, 0)
        codec.start()

        BufferedOutputStream(FileOutputStream(target)).use { out ->
          val resampler = Resampler(out)
          resampler.sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          val frame = Frame(format.getInteger(MediaFormat.KEY_CHANNEL_COUNT), false)
          pump(extractor, codec, resampler, frame)
          return Decoded(resampler.written.toDouble() / RATE)
        }
      } finally {
        // stop() throws when the codec never started (configure failed); release() must run regardless.
        runCatching { codec.stop() }
        codec.release()
      }
    } finally {
      extractor.release()
    }
  }

  private fun pump(extractor: MediaExtractor, codec: MediaCodec, resampler: Resampler, frame: Frame) {
    val info = MediaCodec.BufferInfo()
    var inputDone = false

    while (true) {
      if (!inputDone) inputDone = feed(extractor, codec)

      val output = codec.dequeueOutputBuffer(info, TIMEOUT_US)

      if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        readFormat(codec.outputFormat, resampler, frame)
        continue
      }

      if (output < 0) continue

      drain(codec, output, info, resampler, frame)

      if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
    }
  }

  private fun feed(extractor: MediaExtractor, codec: MediaCodec): Boolean {
    val input = codec.dequeueInputBuffer(TIMEOUT_US)

    if (input < 0) return false

    val buffer = codec.getInputBuffer(input) ?: return false
    val size = extractor.readSampleData(buffer, 0)

    if (size < 0) {
      codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
      return true
    }

    codec.queueInputBuffer(input, 0, size, extractor.sampleTime, 0)
    extractor.advance()
    return false
  }

  private fun readFormat(format: MediaFormat, resampler: Resampler, frame: Frame) {
    resampler.sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    frame.channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    frame.float = format.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
      format.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
  }

  private fun drain(codec: MediaCodec, output: Int, info: MediaCodec.BufferInfo, resampler: Resampler, frame: Frame) {
    val buffer = codec.getOutputBuffer(output)

    if (buffer != null && info.size > 0) {
      buffer.position(info.offset)
      buffer.limit(info.offset + info.size)
      buffer.order(ByteOrder.LITTLE_ENDIAN)
      val channels = frame.channels.coerceAtLeast(1)

      if (!frame.started) start(frame, info.presentationTimeUs, resampler)

      while (buffer.remaining() >= channels * (if (frame.float) 4 else 2)) {
        var sum = 0f
        repeat(channels) { sum += if (frame.float) buffer.float else buffer.short / 32768f }
        if (frame.skip > 0) {
          frame.skip -= 1
          continue
        }
        resampler.push(sum / channels)
      }
    }

    codec.releaseOutputBuffer(output, false)
  }

  private fun start(frame: Frame, presentationTimeUs: Long, resampler: Resampler) {
    frame.started = true
    val offset = presentationTimeUs / 1_000_000.0

    if (offset > 0) resampler.pad(offset)
    if (offset < 0) frame.skip = (-offset * resampler.sourceRate).roundToLong()
  }
}
