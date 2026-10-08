package expo.modules.leclapspeech

import android.content.Context
import android.net.Uri
import java.security.MessageDigest

/** sha256 of the transcribed clip ("sha256:<hex>"), recorded with the pin to detect a stale transcript. */
object FileDigest {
  fun sha256(context: Context, uri: Uri): String? {
    val stream = context.contentResolver.openInputStream(uri) ?: return null
    val digest = MessageDigest.getInstance("SHA-256")

    stream.use { input ->
      val buffer = ByteArray(1 shl 20)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }

    return "sha256:" + digest.digest().joinToString("") { "%02x".format(it) }
  }
}
