import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
try {
  const zai = await ZAI.create();
  const response = await zai.audio.tts.create({
    input: 'Hello world, this is a test.',
    voice: 'tongtong',
    speed: 1.0,
    response_format: 'wav',
    stream: false,
  });
  console.log('Response status:', response?.status);
  const contentType = response?.headers?.get('content-type');
  console.log('Content-Type:', contentType);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(new Uint8Array(arrayBuffer));
  console.log('Buffer size:', buffer.length, 'bytes');
  console.log('First bytes (hex):', buffer.slice(0, 12).toString('hex'));
  fs.writeFileSync('/home/z/my-project/scripts/test-tts.wav', buffer);
  console.log('Saved to test-tts.wav');
} catch (e) {
  console.error('ERROR:', e.message);
}
