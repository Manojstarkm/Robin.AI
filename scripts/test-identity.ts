// Unit test for the identity lock (src/lib/persona.ts)
const {
  isIdentityQuestion,
  enforceIdentity,
  IDENTITY_EN,
  IDENTITY_TA,
} = await import("../src/lib/persona");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

console.log('--- isIdentityQuestion ---');
check('EN: who created you?', isIdentityQuestion('who created you?'));
check('EN: who made you', isIdentityQuestion('who made you'));
check('EN: who developed you?', isIdentityQuestion('who developed you?'));
check("EN: who's your developer", isIdentityQuestion("who's your developer"));
check('EN: who is your creator', isIdentityQuestion('who is your creator'));
check('EN: which company made you', isIdentityQuestion('which company made you'));
check('Tanglish: yaar unna pannathu', isIdentityQuestion('yaar unna pannathu'));
check('Tanglish: unna yaar create pannathu', isIdentityQuestion('unna yaar create pannathu'));
check('Tamil: உன்னை யார் பண்ணது', isIdentityQuestion('உன்னை யார் பண்ணது'));
check('Tamil: உன்னை யார் உருவாக்கியது', isIdentityQuestion('உன்னை யார் உருவாக்கியது'));
check('not identity: what is the weather', !isIdentityQuestion('what is the weather'));
check('not identity: tell me a joke', !isIdentityQuestion('tell me a joke'));
check('not identity: who is the president of india', !isIdentityQuestion('who is the president of india'));
check('not identity: hi', !isIdentityQuestion('hi'));

console.log('--- enforceIdentity ---');
// Wrong creator → replaced
check(
  'wrong creator (Google) replaced with EN identity',
  enforceIdentity('who created you?', 'I was made by Google, a leading AI company.') === IDENTITY_EN
);
check(
  'no creator credit at all → replaced',
  enforceIdentity('who made you?', "I'm an AI assistant here to help you!") === IDENTITY_EN
);
check(
  'manoj but missing stark+glm → replaced',
  enforceIdentity('who created you?', 'I was developed by Manoj.') === IDENTITY_EN
);
check(
  'full correct answer kept',
  enforceIdentity(
    'who created you?',
    'I am developed by Manoj M, founder of Stark Industry, with GLM!'
  ) === 'I am developed by Manoj M, founder of Stark Industry, with GLM!'
);
check(
  'Tamil reply with wrong creator → Tamil identity',
  enforceIdentity('உன்னை யார் பண்ணது', 'என்னை Google நிறுவனம் உருவாக்கியது.') === IDENTITY_TA
);
check(
  'Tanglish question + Tamil reply kept when correct',
  enforceIdentity('yaar unna pannathu', IDENTITY_TA) === IDENTITY_TA
);
// Non-identity questions untouched
check(
  'normal reply untouched',
  enforceIdentity('tell me a joke', 'Why did the chicken cross the road?') === 'Why did the chicken cross the road?'
);
check(
  'empty reply untouched',
  enforceIdentity('who created you?', '') === ''
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
