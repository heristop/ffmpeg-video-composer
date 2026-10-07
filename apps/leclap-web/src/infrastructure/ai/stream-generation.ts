// Shared text generation over the AI SDK: streams the reply so the dialog can show live progress,
// then maps the finish reason (refusal, truncation) and any failure to a ProviderError. Retries are
// off — the dialog owns retrying, and a silent backoff would look like a hang.
import { streamText, type LanguageModel, type OutputInterface, type SystemModelMessage } from 'ai';
import { ProviderError, type GenerateRequest } from '@/application/usecases/ai-template/model-provider';
import { toProviderError } from './provider-errors';

export interface StreamOptions {
  instructions: string | SystemModelMessage;
  maxOutputTokens?: number;
  output?: OutputInterface;
}

function checkFinish(finishReason: string): void {
  if (finishReason === 'content-filter') throw new ProviderError('refused');

  if (finishReason === 'length') throw new ProviderError('truncated');
}

async function run(model: LanguageModel, request: GenerateRequest, options: StreamOptions): Promise<string> {
  let streamError: unknown;
  let text = '';
  const result = streamText({
    model,
    instructions: options.instructions,
    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
    maxOutputTokens: options.maxOutputTokens,
    output: options.output,
    abortSignal: request.signal,
    maxRetries: 0,
    // Capture instead of the SDK's default console logging.
    onError: ({ error }) => {
      streamError = error;
    },
  });

  for await (const delta of result.textStream) {
    text += delta;
    request.onProgress?.(text.length);
  }

  if (streamError !== undefined) throw streamError;

  checkFinish(await result.finishReason);

  return text;
}

export async function streamGeneration(
  model: LanguageModel,
  request: GenerateRequest,
  options: StreamOptions
): Promise<string> {
  try {
    return await run(model, request, options);
  } catch (error) {
    throw toProviderError(error, request.signal);
  }
}
