import type { Kit, Task } from 'agent-bench';

/**
 * Memory across chats: told in one conversation, used in a new one. Judged
 * only by what the bot says in the new conversation, never by what its memory
 * store holds, so every product is held to the same observable bar.
 */
export default (k: Kit): Task[] => {
  const MEM_S = 240;
  const NAMES = ['Anouk', 'Saoirse', 'Ottilie', 'Ines', 'Mireille', 'Liesel', 'Ingrid', 'Noor', 'Thea', 'Yara', 'Zofia', 'Maren'];
  const name = () => k.pick(NAMES, k.token());
  return [
    {
      id: 'mem-locker',
      category: 'memory',
      title: 'A code told in one chat, asked in a new one',
      budget_s: MEM_S,
      requires: ['memory'],
      vars: () => ({ code: `${Math.floor(1000 + Math.random() * 9000)}-${k.token().slice(0, 2)}` }),
      steps: [
        { chat: 'a', text: (v) => `Please remember this: my gym locker code is ${v.code}.` },
        { chat: 'b', wait_memory: 'code', text: () => "What's my gym locker code?" },
      ],
      check: (ev, ctx) => [k.replyHas(ev, 'recalls the code in a new chat', new RegExp((ctx.vars.code as string).replace('-', '\\W?')))],
      fake: (v) => [
        { tools: [k.fake.remembered(`gym locker code ${v.code}`)], reply: `Got it, your gym locker code is ${v.code}.` },
        { tools: [k.fake.recalled('gym locker code')], reply: `Your gym locker code is ${v.code}.` },
      ],
    },
    {
      id: 'mem-allergy',
      category: 'memory',
      title: 'Diet and allergy carried into a new chat',
      budget_s: MEM_S,
      requires: ['memory'],
      vars: () => ({ marker: 'peanut' }),
      steps: [
        { chat: 'a', text: () => "Something to remember about me: I'm vegetarian and I have a severe peanut allergy." },
        { chat: 'b', wait_memory: 'marker', text: () => 'Suggest three dinner ideas for tonight.' },
      ],
      rubric: 'Three dinner ideas that are vegetarian and free of peanuts, ideally noting the allergy was taken into account. Friendly and brief.',
      check: (ev) => [k.ok('no meat or fish', !k.meatIn(ev.reply), k.meatIn(ev.reply) ?? 'none'), k.ok('no peanut as an ingredient', !k.peanutAsIngredient(ev.reply), k.peanutAsIngredient(ev.reply) ?? 'none')],
      fake: () => [
        { tools: [k.fake.remembered('vegetarian; severe peanut allergy')], reply: "Noted: vegetarian, and a severe peanut allergy. I'll keep both in mind." },
        { tools: [k.fake.recalled('vegetarian, peanut allergy')], reply: 'Three peanut-free vegetarian ideas: mushroom risotto, chickpea curry, halloumi tacos.' },
      ],
    },
    {
      id: 'mem-correct',
      category: 'memory',
      title: 'A corrected birthday is the one recalled',
      budget_s: MEM_S,
      requires: ['memory'],
      vars: () => ({ sister: name() }),
      steps: [
        { chat: 'a', text: (v) => `My sister ${v.sister}'s birthday is March 3.` },
        { chat: 'a', text: (v) => `Sorry, I got that wrong: ${v.sister}'s birthday is March 13.` },
        { chat: 'b', wait_memory: 'sister', text: (v) => `When is my sister ${v.sister}'s birthday?` },
      ],
      check: (ev) => [
        k.replyHas(ev, 'says March 13', /march 13|13(?:th)? (?:of )?march|3\/13/i),
        // March 3 may be named as the earlier, corrected date ("you first said March 3, then March 13"), not given as the answer.
        k.ok(
          'does not give March 3 as the date',
          !ev.reply
            .split(/(?<=[.!?])\s+|\n+/)
            .some(
              (s) =>
                /(?<!not |never |wasn't |instead of )(?:march 3(?!\d)|3(?:rd)? march)/i.test(s) &&
                !(/march 13|13(?:th)? (?:of )?march/i.test(s) && /\b(?:first|earlier|originally|before|corrected|changed|updated|wrong|mistake|instead|not)\b/i.test(s)),
            ),
          '',
        ),
      ],
      fake: (v) => [
        { tools: [k.fake.remembered(`${v.sister}'s birthday March 3`)], reply: `Noted: ${v.sister}'s birthday is March 3.` },
        { tools: [{ kind: 'memory', title: `Updated: ${v.sister}'s birthday is March 13` }], reply: `Fixed: ${v.sister}'s birthday is March 13.` },
        { tools: [k.fake.recalled(`${v.sister}'s birthday`)], reply: `${v.sister}'s birthday is March 13.` },
      ],
    },
    {
      id: 'mem-forget',
      category: 'memory',
      title: 'Forget a password, and it stays forgotten',
      budget_s: MEM_S,
      requires: ['memory'],
      vars: () => ({ pw: `tulip-${k.token().toLowerCase()}` }),
      steps: [
        { chat: 'a', text: (v) => `My home wifi password is ${v.pw}. Remember it for me.` },
        { chat: 'a', wait_memory: 'pw', text: () => 'Please forget my wifi password.' },
        { chat: 'b', text: () => "What's my home wifi password?" },
      ],
      check: (ev, ctx) => [k.replyLacks(ev, 'does not recall the forgotten password', new RegExp(ctx.vars.pw as string, 'i'))],
      after: async (ctx) => {
        const holds = ctx.adapter.memoryHolds ? await ctx.adapter.memoryHolds((ctx.vars.pw as string).toLowerCase()).catch(() => null) : null;
        return [k.info('memory store no longer holds it', holds === false, holds === null ? 'not observable on this bot' : holds ? 'still stored' : 'gone')];
      },
      fake: (v) => [
        { tools: [k.fake.remembered('wifi password')], reply: `Saved, I'll remember your wifi password (${String(v.pw).slice(0, 3)}…).` },
        { tools: [{ kind: 'memory', title: 'Forgot: wifi password' }], reply: "Done, I've forgotten your wifi password." },
        { reply: "I don't have your wifi password; you asked me to forget it." },
      ],
    },
  ];
};
