import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function splitTextIntoChunks(text: string, maxLength = 900): string[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) return [trimmed];

  const chunks: string[] = [];
  const sentences = trimmed.match(/[^.!?。！？]+[.!?。！?]*/g) || [trimmed];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLength) {
      current += sentence;
    } else {
      if (current) chunks.push(current.trim());
      if (sentence.length > maxLength) {
        for (let i = 0; i < sentence.length; i += maxLength) {
          chunks.push(sentence.slice(i, i + maxLength).trim());
        }
        current = '';
      } else {
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

export async function POST(req: NextRequest) {
  try {
    const { text, voice = 'tongtong', speed = 1.0 } = await req.json();

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const chunks = splitTextIntoChunks(text, 900);
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const response = await zai.audio.tts.create({
        input: chunk,
        voice,
        speed,
        response_format: 'wav',
        stream: false,
      });

      const arrayBuffer = await (response as Response).arrayBuffer();
      audioBuffers.push(Buffer.from(new Uint8Array(arrayBuffer)));
    }

    const combined = Buffer.concat(audioBuffers);

    return new NextResponse(combined, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': combined.length.toString(),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('TTS API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to generate speech. Please try again.',
      },
      { status: 500 }
    );
  }
}
