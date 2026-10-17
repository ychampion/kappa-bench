/**
 * The files the "files in" tasks attach, made here so their facts are known
 * exactly: an invoice and a two-page contract (PDF), a year of shop sales
 * (CSV), a till receipt and a bar chart (PNG, drawn in a large pixel font so a
 * vision model can read them). `bun run fixtures` writes them to
 * fixtures/ for inspection; the runner makes them in memory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writePdf, writePng } from './files.ts';

export const FIXTURE_DIR = resolve(import.meta.dir, '..', 'fixtures');

/* ------------------------------- the facts ------------------------------- */
export const INVOICE = {
  from: 'Northwind Design Studio',
  number: 'INV-20417',
  total: 2340,
  due: 'November 14, 2026',
  dueDay: { y: 2026, m: 11, d: 14 },
};
export const CONTRACT = { noticeDays: 45, fee: 1200, law: 'California' };
export const SALES_ROWS: [string, number, number][] = [
  ['2025-01', 182, 9464], ['2025-02', 165, 8745], ['2025-03', 201, 10854],
  ['2025-04', 214, 11342], ['2025-05', 238, 12852], ['2025-06', 226, 12430],
  ['2025-07', 251, 13554], ['2025-08', 266, 14896], ['2025-09', 240, 12720],
  ['2025-10', 233, 12582], ['2025-11', 289, 16762], ['2025-12', 312, 19032],
];
export const SALES = (() => {
  const revenue = SALES_ROWS.reduce((s, r) => s + r[2], 0);
  const orders = SALES_ROWS.reduce((s, r) => s + r[1], 0);
  const best = [...SALES_ROWS].sort((a, b) => b[2] - a[2])[0] as [string, number, number];
  return { revenue, orders, aov: Math.round((revenue / orders) * 100) / 100, bestMonth: 'December', bestRevenue: best[2] };
})();
export const RECEIPT = {
  store: 'BAYSIDE MARKET',
  date: '09/27/2026',
  total: 33.06,
  priciest: 'COFFEE BEANS',
  priciestPrice: 14.99,
  lines: [
    'BAYSIDE MARKET',
    '1420 HARBOR ST OAKLAND CA',
    'DATE 09/27/2026  14:32',
    '',
    'OAT MILK 1L          4.29',
    'SOURDOUGH LOAF       6.50',
    'AVOCADOS X3          5.97',
    'COFFEE BEANS 12OZ   14.99',
    '',
    'SUBTOTAL            31.75',
    'TAX                  1.31',
    'TOTAL              $33.06',
    '',
    'THANK YOU',
  ],
};
export const CHART = {
  title: 'QUARTERLY SIGNUPS 2026',
  bars: [
    ['Q1', 1200],
    ['Q2', 1850],
    ['Q3', 1430],
    ['Q4', 980],
  ] as [string, number][],
  best: 'Q2',
  bestValue: 1850,
  /** Q3 to Q4, percent. */
  q3q4: Math.round(((980 - 1430) / 1430) * 1000) / 10,
};

/* ------------------------------ pixel font ------------------------------ */
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f], '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c], ',': [0, 0, 0, 0, 0x0c, 0x04, 0x08], ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04], '-': [0, 0, 0, 0x1f, 0, 0, 0], '/': [0, 0x01, 0x02, 0x04, 0x08, 0x10, 0],
  '#': [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a], '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

class Canvas {
  pixels: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height).fill(255);
  }
  rect(x: number, y: number, w: number, h: number, shade = 0) {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) this.pixels[yy * this.width + xx] = shade;
  }
  text(x: number, y: number, text: string, scale: number) {
    let cx = x;
    for (const ch of text.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT[' '];
      glyph?.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++) if (row & (0x10 >> rx)) this.rect(cx + rx * scale, y + ry * scale, scale, scale);
      });
      cx += 6 * scale;
    }
  }
  png() {
    return writePng(this.width, this.height, this.pixels);
  }
}

function receiptPng(): Uint8Array {
  const scale = 3;
  const lineH = 10 * scale;
  const canvas = new Canvas(560, 40 + RECEIPT.lines.length * lineH);
  RECEIPT.lines.forEach((line, i) => canvas.text(30, 20 + i * lineH, line, scale));
  return canvas.png();
}

function chartPng(): Uint8Array {
  const canvas = new Canvas(640, 460);
  canvas.text(40, 20, CHART.title, 3);
  const base = 400;
  const max = 2000;
  CHART.bars.forEach(([label, value], i) => {
    const x = 70 + i * 140;
    const h = Math.round((value / max) * 300);
    canvas.rect(x, base - h, 80, h, 90);
    canvas.text(x + 2, base - h - 30, String(value), 3);
    canvas.text(x + 22, base + 14, label, 3);
  });
  canvas.rect(50, base, 560, 3, 0);
  return canvas.png();
}

function invoicePdf(): Uint8Array {
  return writePdf([
    [
      INVOICE.from,
      '88 Mission Street, San Francisco, CA 94105',
      '',
      `INVOICE ${INVOICE.number}`,
      'Issued: October 15, 2026',
      `Due date: ${INVOICE.due}`,
      '',
      'Bill to: Riya Sharma, 501 Valencia Street, San Francisco, CA',
      '',
      'Brand refresh - logo concepts (3)            $1,200.00',
      'Website hero illustrations (4)               $  800.00',
      'Revisions, 2 rounds                          $  340.00',
      '',
      'Total due: $2,340.00',
      'Pay by bank transfer within 30 days. Late fee 1.5% per month.',
    ],
  ]);
}

function contractPdf(): Uint8Array {
  return writePdf([
    [
      'SERVICES AGREEMENT',
      'Between Riya Sharma ("Client") and Brightline Cleaning LLC ("Provider").',
      '1. Services. Provider cleans the Client home every other Friday.',
      '2. Fees. $160 per visit, invoiced monthly, payable within 15 days.',
      '3. Term. The agreement starts November 1, 2026 and renews monthly.',
      '(continued on page 2)',
    ],
    [
      '4. Termination. Either party may end this agreement with',
      `   ${CONTRACT.noticeDays} days written notice.`,
      `5. Early termination fee: $${CONTRACT.fee.toLocaleString('en-US')}.00 if the Client ends`,
      '   the agreement within the first six months.',
      `6. Governing law. The laws of the State of ${CONTRACT.law} govern this agreement.`,
      'Signed: Riya Sharma, Dana Brightline',
    ],
  ]);
}

function salesCsv(): string {
  return ['month,orders,revenue_usd', ...SALES_ROWS.map((r) => r.join(','))].join('\n') + '\n';
}

export const FIXTURES: Record<string, { mime: string; make: () => Uint8Array | string }> = {
  'invoice.pdf': { mime: 'application/pdf', make: invoicePdf },
  'contract.pdf': { mime: 'application/pdf', make: contractPdf },
  'shop-sales-2025.csv': { mime: 'text/csv', make: salesCsv },
  'receipt.png': { mime: 'image/png', make: receiptPng },
  'signups-chart.png': { mime: 'image/png', make: chartPng },
};

const made = new Map<string, Uint8Array>();
/** A fixture's bytes, made in memory (deterministic, so every run sends the same file). */
export function fixture(name: string): { name: string; mime: string; bytes: Uint8Array } {
  const spec = FIXTURES[name];
  if (!spec) throw new Error(`unknown fixture ${name}`);
  let bytes = made.get(name);
  if (!bytes) {
    const raw = spec.make();
    bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
    made.set(name, bytes);
  }
  return { name, mime: spec.mime, bytes };
}

export function writeFixtures(): string[] {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  return Object.entries(FIXTURES).map(([name, spec]) => {
    const made = spec.make();
    writeFileSync(join(FIXTURE_DIR, name), made);
    return `${name} (${typeof made === 'string' ? made.length : made.length} bytes)`;
  });
}

if (import.meta.main) for (const line of writeFixtures()) console.log(`wrote fixtures/${line}`);
