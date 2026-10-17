import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    const base64Audio = buffer.toString('base64');

    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const response = await zai.audio.asr.create({
      file_base64: base64Audio,
    });

    const text =
      (response as { text?: string }).text?.trim() ?? '';

    if (!text) {
      return NextResponse.json(
        { success: false, error: 'Could not transcribe audio. Please try again.' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      text,
    });
  } catch (error) {
    console.error('ASR API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Speech recognition failed. Please try again.',
      },
      { status: 500 }
    );
  }
}
