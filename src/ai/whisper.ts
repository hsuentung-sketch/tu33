import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';

/**
 * Transcribe audio buffer to text using OpenAI Whisper API.
 * Input: raw audio buffer (from LINE voice message, m4a format).
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  opts: { language?: string; filename?: string } = {},
): Promise<string> {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const filename = opts.filename ?? 'audio.m4a';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audioBuffer)]), filename);
  form.append('model', 'whisper-1');
  if (opts.language) form.append('language', opts.language);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('Whisper API error', { status: response.status, body: errText });
    throw new Error(`Whisper API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
