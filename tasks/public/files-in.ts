import type { Kit, Task } from 'kappa-bench';

/** Files in: the person attaches a document or a photo; facts are checked against the generated fixture. */
export default (k: Kit): Task[] => {
  const IN_S = 300;
  const { INVOICE, CONTRACT, SALES, RECEIPT } = k;
  return [
    {
      id: 'in-invoice',
      category: 'files_in',
      title: 'PDF invoice: from whom, total, due date',
      budget_s: IN_S,
      requires: ['attach.file'],
      steps: [{ attach: ['invoice.pdf'], text: () => 'Who is this invoice from, what do I owe in total, and when is it due?' }],
      check: (ev) => [k.replyHas(ev, 'names the sender', /northwind/i), k.ok('total $2,340', k.hasNumberNear(ev.reply, INVOICE.total, 0.0001)), k.ok('due date', k.mentionsDay(ev.reply, INVOICE.dueDay), INVOICE.due)],
      fake: () => [{ reply: `It's from ${INVOICE.from}: $2,340.00 in total, due ${INVOICE.due}.` }],
    },
    {
      id: 'in-contract',
      category: 'files_in',
      title: 'Two-page contract: notice, fee, governing law',
      budget_s: IN_S,
      requires: ['attach.file'],
      steps: [{ attach: ['contract.pdf'], text: () => "How much notice do I need to give to cancel this, is there an early termination fee, and which state's law applies?" }],
      check: (ev) => [k.ok('45 days notice', /\b45\b/.test(ev.reply) && /day/i.test(ev.reply)), k.ok('$1,200 fee', k.hasNumberNear(ev.reply, CONTRACT.fee, 0.0001)), k.replyHas(ev, 'California law', /california/i)],
      fake: () => [{ reply: '45 days written notice. Yes: $1,200 if you end it in the first six months. California law applies.' }],
    },
    {
      id: 'in-csv',
      category: 'files_in',
      title: 'CSV of a year of sales: best month, total, AOV',
      budget_s: IN_S,
      requires: ['attach.file'],
      steps: [{ attach: ['shop-sales-2025.csv'], text: () => 'Which month had the highest revenue, what was total revenue for the year, and what was the average order value?' }],
      check: (ev) => {
        const nums = k.numbersIn(ev.reply);
        return [
          k.replyHas(ev, 'December', /december|dec\b|2025-12/i),
          k.ok(`total $${SALES.revenue}`, nums.some((n) => Math.abs(n - SALES.revenue) <= 1), String(SALES.revenue)),
          k.ok(`average order $${SALES.aov}`, nums.some((n) => Math.abs(n - SALES.aov) <= 0.02), String(SALES.aov)),
        ];
      },
      fake: () => [{ reply: `December was best ($19,032). Total revenue: $${SALES.revenue.toLocaleString('en-US')}. Average order value: $${SALES.aov}.` }],
    },
    {
      id: 'in-receipt',
      category: 'files_in',
      title: 'Photo of a receipt: store, date, total, priciest item',
      budget_s: IN_S,
      requires: ['attach.image'],
      steps: [{ attach: ['receipt.png'], text: () => 'What store is this receipt from, what date was it, what was the total, and which item cost the most?' }],
      check: (ev) => [
        k.replyHas(ev, 'store', /bayside/i),
        k.ok('date 27 Sep 2026', /09\/27\/2026|sept?(?:ember)?\.?\s+27|27\s+sept?/i.test(ev.reply)),
        k.ok(`total $${RECEIPT.total}`, k.hasNumberNear(ev.reply, RECEIPT.total, 0.0001)),
        k.replyHas(ev, 'priciest item', /coffee/i),
      ],
      fake: () => [{ reply: 'Bayside Market, September 27, 2026. Total $33.06. The priciest item was the coffee beans at $14.99.' }],
    },
  ];
};
