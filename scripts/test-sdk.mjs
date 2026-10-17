import ZAI from 'z-ai-web-dev-sdk';
try {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: 'You are a helpful assistant. Reply in one short sentence.' },
      { role: 'user', content: 'Say hello in 5 words.' }
    ],
    thinking: { type: 'disabled' }
  });
  console.log('FULL RESPONSE:', JSON.stringify(completion, null, 2));
} catch (e) {
  console.error('ERROR:', e.message);
  console.error('STACK:', e.stack);
}
