import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const TAMIL = 'வணக்கம்! நான் ஆரா, உங்கள் குரல் உதவியாளர். உங்களுக்கு எப்படி உதவ முடியும்?';
const ENGLISH = 'Hello! I am Aura, your voice assistant. How can I help you today?';

async function tts(zai, text, tag) {
  const res = await zai.audio.tts.create({
    input: text,
    voice: 'tongtong',
    speed: 1.0,
    response_format: 'wav',
    stream: false,
  });
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  const out = `/home/z/my-project/scripts/${tag}.wav`;
  fs.writeFileSync(out, buf);
  console.log(`[${tag}] wav bytes: ${buf.length}`);
  return buf;
}

async function asr(zai, buf, tag) {
  try {
    const res = await zai.audio.asr.create({ file_base64: buf.toString('base64') });
    console.log(`[${tag}] ASR heard: "${res.text}"`);
  } catch (e) {
    console.log(`[${tag}] ASR failed: ${e.message || e}`);
  }
}

async function main() {
  const zai = await ZAI.create();

  // 1. English control
  const en = await tts(zai, ENGLISH, 'english-test');

  // 2. Tamil with default voice
  let ta;
  try {
    ta = await tts(zai, TAMIL, 'tamil-test');
  } catch (e) {
    console.log('[tamil] TTS failed:', e.message || e);
  }

  // 3. Round-trip: feed the generated wavs back through ASR
  await asr(zai, en, 'english');
  if (ta) await asr(zai, ta, 'tamil');
}

main().catch((e) => {
  console.error('FATAL', e.message || e);
  process.exit(1);
});
