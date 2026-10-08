import AVFoundation
import CryptoKit
import ExpoModulesCore
import Speech

// On-device transcription of a recorded clip for auto-captions. Recognition is pinned to the device
// (requiresOnDeviceRecognition = true): when the locale has no on-device model this refuses with a
// reason instead of sending audio to Apple's servers. Word timings come from the segments (substring,
// timestamp, duration, confidence) of every final utterance: a long file can end several utterances,
// and the task delegate reports each one before it finishes. Video files are exported to an m4a first
// so the request reads plain audio.
public class LeclapSpeechModule: Module {
  // The in-flight recognition, kept alive until its final result.
  private var task: SFSpeechRecognitionTask?
  private var recognizer: SFSpeechRecognizer?
  private var collector: RecognitionCollector?

  public func definition() -> ModuleDefinition {
    Name("LeclapSpeech")

    AsyncFunction("isAvailable") { (language: String?) -> [String: Any] in
      return Self.availability(language)
    }

    AsyncFunction("requestPermission") { (promise: Promise) in
      SFSpeechRecognizer.requestAuthorization { status in
        promise.resolve(["granted": status == .authorized])
      }
    }

    AsyncFunction("transcribeFile") { (uri: String, options: [String: Any], promise: Promise) in
      let language = options["language"] as? String ?? Locale.current.identifier
      self.transcribe(uri: uri, language: language, promise: promise)
    }
  }

  private static func availability(_ language: String?) -> [String: Any] {
    let locale = Locale(identifier: language ?? Locale.current.identifier)

    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
      return ["available": false, "onDevice": false, "reason": "No speech recognizer for \(locale.identifier)"]
    }

    guard recognizer.supportsOnDeviceRecognition else {
      return [
        "available": false,
        "onDevice": false,
        "reason": "On-device recognition is not available for \(locale.identifier) on this device. "
          + "Add the language under Settings > General > Keyboard > Dictation Languages.",
      ]
    }

    return ["available": recognizer.isAvailable, "onDevice": true]
  }

  private static func fileURL(_ uri: String) -> URL {
    if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
    return URL(fileURLWithPath: uri)
  }

  private static func digest(_ url: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    defer { try? handle.close() }

    var hasher = SHA256()
    while true {
      let chunk = handle.readData(ofLength: 1 << 20)
      if chunk.isEmpty { break }
      hasher.update(data: chunk)
    }

    return "sha256:" + hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  // Exports the clip's audio track to an m4a in the caches directory (audio files pass through).
  private static func audioFile(_ url: URL, completion: @escaping (URL?, String?) -> Void) {
    let audioExtensions: Set<String> = ["m4a", "wav", "caf", "aac", "mp3", "aiff"]
    if audioExtensions.contains(url.pathExtension.lowercased()) {
      completion(url, nil)
      return
    }

    let asset = AVURLAsset(url: url)
    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
      completion(nil, "Cannot read the audio of this clip")
      return
    }

    let target = FileManager.default.temporaryDirectory.appendingPathComponent("leclap-speech-\(UUID().uuidString).m4a")
    export.outputURL = target
    export.outputFileType = .m4a
    export.exportAsynchronously {
      if export.status == .completed {
        completion(target, nil)
        return
      }
      completion(nil, export.error?.localizedDescription ?? "Audio export failed")
    }
  }

  private func transcribe(uri: String, language: String, promise: Promise) {
    let source = Self.fileURL(uri)
    let locale = Locale(identifier: language)

    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.supportsOnDeviceRecognition else {
      promise.reject("ERR_SPEECH_UNAVAILABLE", "On-device recognition is not available for \(language)")
      return
    }

    Self.audioFile(source) { audio, failure in
      guard let audio else {
        promise.reject("ERR_SPEECH_AUDIO", failure ?? "Cannot read the audio of this clip")
        return
      }
      self.recognize(audio: audio, source: source, recognizer: recognizer, language: language, promise: promise)
    }
  }

  private func recognize(
    audio: URL, source: URL, recognizer: SFSpeechRecognizer, language: String, promise: Promise
  ) {
    let request = SFSpeechURLRecognitionRequest(url: audio)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    if #available(iOS 16, *) { request.addsPunctuation = true }

    let collector = RecognitionCollector { segments, error in
      self.finish(audio: audio, source: source)

      if let error {
        promise.reject("ERR_SPEECH", error.localizedDescription)
        return
      }

      // Hashing a long clip takes a while: keep it off the queue the recognizer reports on (main).
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(Self.transcript(segments, language: language, source: source))
      }
    }
    self.recognizer = recognizer
    self.collector = collector
    self.task = recognizer.recognitionTask(with: request, delegate: collector)
  }

  private func finish(audio: URL, source: URL) {
    task = nil
    recognizer = nil
    collector = nil
    if audio != source { try? FileManager.default.removeItem(at: audio) }
  }

  private static func transcript(_ segments: [SFTranscriptionSegment], language: String, source: URL) -> [String: Any] {
    let words: [[String: Any]] = segments.map { segment in
      var word: [String: Any] = [
        "text": segment.substring,
        "start": segment.timestamp,
        "end": segment.timestamp + segment.duration,
      ]
      // 0 means "not reported" for on-device results, not "certainly wrong".
      if segment.confidence > 0 { word["confidence"] = Double(segment.confidence) }
      return word
    }

    var payload: [String: Any] = ["language": language, "words": words, "segmentsOnly": false]
    if let digest = digest(source) { payload["digest"] = digest }
    return payload
  }
}

// Collects the segments of every final utterance and settles once, when the task finishes. A final
// result that restarts before the collected end (a cumulative transcription) replaces the overlap
// instead of duplicating it.
private final class RecognitionCollector: NSObject, SFSpeechRecognitionTaskDelegate {
  private var segments: [SFTranscriptionSegment] = []
  private var settled = false
  private let settle: ([SFTranscriptionSegment], Error?) -> Void

  init(settle: @escaping ([SFTranscriptionSegment], Error?) -> Void) {
    self.settle = settle
  }

  func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishRecognition result: SFSpeechRecognitionResult) {
    let utterance = result.bestTranscription.segments
    guard let first = utterance.first else { return }

    segments = segments.filter { $0.timestamp < first.timestamp } + utterance
  }

  func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishSuccessfully successfully: Bool) {
    if settled { return }
    settled = true

    if successfully {
      settle(segments, nil)
      return
    }

    settle([], task.error ?? NSError(domain: "LeclapSpeech", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "Speech recognition failed",
    ]))
  }
}
