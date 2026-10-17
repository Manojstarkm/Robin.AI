import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const BASE = '/home/z/my-project/public/aura-girl.png';

const EDITS = [
  {
    out: '/home/z/my-project/public/aura-girl-blink.png',
    prompt:
      'Make her close both eyes completely, eyelids gently closed in a relaxed natural blink, keep absolutely everything else identical: same waving hand pose, same hair, same white holographic suit, same cyan glow lines, same lighting, same background, same smile, same composition',
  },
  {
    out: '/home/z/my-project/public/aura-girl-talk.png',
    prompt:
      'Make her mouth open mid-speech as if talking, lips parted showing a hint of teeth, cheerful speaking expression, eyes still open looking at viewer, keep absolutely everything else identical: same waving hand pose, same hair, same white holographic suit, same cyan glow lines, same lighting, same background, same composition',
  },
];

async function main() {
  const zai = await ZAI.create();
  const b64 = fs.readFileSync(BASE).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;

  for (const edit of EDITS) {
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const res = await zai.images.generations.edit({
          prompt: edit.prompt,
          images: [{ url: dataUrl }],
          size: '768x1344',
        });
        const buf = Buffer.from(res.data[0].base64, 'base64');
        fs.writeFileSync(edit.out, buf);
        console.log(`saved ${edit.out} (${buf.length} bytes)`);
        done = true;
      } catch (e) {
        console.error(`attempt ${attempt} failed: ${e.message || e}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!done) process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e.message || e);
  process.exit(1);
});
