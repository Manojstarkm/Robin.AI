import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const GIRL = '/home/z/my-project/public/aura-girl.png';
const ICON_SRC = '/home/z/my-project/upload/pasted_image_1792314235498.png';

const JOBS = [
  {
    src: GIRL,
    out: '/home/z/my-project/public/robin-girl-talk-b.png',
    size: '768x1344',
    prompt:
      'Make her laugh warmly with her mouth open a bit wider mid-speech, head tilted very slightly to her left, joyful chatting expression, eyes open looking at the viewer, keep absolutely everything else identical: same waving hand pose, same hair, same white holographic suit, same cyan glow lines, same lighting, same background, same composition',
  },
  {
    src: GIRL,
    out: '/home/z/my-project/public/robin-girl-listen.png',
    size: '768x1344',
    prompt:
      'Make her listen attentively: head tilted gently to her right, warm curious smile, eyes slightly wider looking at the viewer, both hands clasped together in front of her chest, keep absolutely everything else identical: same hair, same white holographic suit, same cyan glow lines, same lighting, same background, same composition',
  },
  {
    src: GIRL,
    out: '/home/z/my-project/public/robin-girl-think.png',
    size: '768x1344',
    prompt:
      'Make her think: one index finger raised touching her chin, eyes glancing up and to the side in thought, soft thoughtful smile, keep absolutely everything else identical: same waving hand lowered, same hair, same white holographic suit, same cyan glow lines, same lighting, same background, same composition',
  },
  {
    src: ICON_SRC,
    out: '/home/z/my-project/public/robin-icon.png',
    size: '1024x1024',
    prompt:
      'Turn this into a clean square app icon: keep the same robotic cyber robin bird with silver metal body, glowing blue mechanical eyes and purple neon glowing wings exactly as designed, centered; remove ALL text, letters, words and labels from the HUD rings; keep the sound waves, radar circles, hexagon grid and particle streams subtle in the deep blue background; glowing neon blue and purple accents, sharp high detail, fills the whole canvas edge to edge',
  },
];

async function main() {
  const zai = await ZAI.create();
  for (const job of JOBS) {
    if (fs.existsSync(job.out)) {
      console.log(`skip (exists): ${job.out}`);
      continue;
    }
    const b64 = fs.readFileSync(job.src).toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        console.log(`editing -> ${job.out} (attempt ${attempt})`);
        const res = await zai.images.generations.edit({
          prompt: job.prompt,
          images: [{ url: dataUrl }],
          size: job.size,
        });
        const buf = Buffer.from(res.data[0].base64, 'base64');
        fs.writeFileSync(job.out, buf);
        console.log(`saved ${job.out} (${buf.length} bytes)`);
        done = true;
      } catch (e) {
        console.error(`attempt ${attempt} failed: ${e.message || e}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!done) {
      console.error(`GIVING UP on ${job.out}`);
      process.exit(1);
    }
  }
  console.log('ALL ASSETS DONE');
}

main().catch((e) => {
  console.error('FATAL', e.message || e);
  process.exit(1);
});
