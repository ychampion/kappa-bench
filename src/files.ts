/**
 * Opening files without dependencies: a ZIP reader and writer (for .docx,
 * .xlsx and .pptx), a PDF text reader and writer, a PNG writer, and CSV. The
 * graders use the readers to decide that a file the agent made really opens
 * and holds what was asked; the fixtures and the fake install use the writers.
 */
import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib';

/* ---------------------------------- crc32 ---------------------------------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array, start = 0xffffffff): number {
  let c = start;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ----------------------------------- zip ----------------------------------- */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('broken central directory');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + size);
    out.set(name, method === 0 ? data : method === 8 ? new Uint8Array(inflateRawSync(data)) : new Uint8Array());
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** A stored (uncompressed) zip, enough for valid OOXML. */
export function writeZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}
export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const xmlText = (xml: string) =>
  [...xml.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([^<]*)<\/(?:w:t|a:t|t)>/g)]
    .map((m) => unescapeXml(m[1] ?? ''))
    .join(' ');
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export type DocxInfo = { text: string; paragraphs: number; headings: number };
export function docxInfo(bytes: Uint8Array): DocxInfo {
  const zip = readZip(bytes);
  const doc = zip.get('word/document.xml');
  if (!doc) throw new Error('no word/document.xml');
  const xml = dec.decode(doc);
  return {
    text: xml.split(/<\/w:p>/).map(xmlText).join('\n'),
    paragraphs: (xml.match(/<w:p[\s>]/g) ?? []).length,
    headings: (xml.match(/<w:pStyle w:val="(?:Heading|Title)[^"]*"/g) ?? []).length,
  };
}

export type XlsxInfo = { sheets: number; text: string; formulas: string[]; numbers: number[] };
export function xlsxInfo(bytes: Uint8Array): XlsxInfo {
  const zip = readZip(bytes);
  if (!zip.has('xl/workbook.xml')) throw new Error('no xl/workbook.xml');
  const shared = zip.get('xl/sharedStrings.xml');
  const strings = shared
    ? [...dec.decode(shared).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1] ?? ''))
    : [];
  const sheetNames = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  const texts: string[] = [];
  const formulas: string[] = [];
  const numbers: number[] = [];
  for (const name of sheetNames) {
    const xml = dec.decode(zip.get(name) as Uint8Array);
    for (const cell of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const body = cell[2] ?? '';
      const f = body.match(/<f[^>]*>([^<]*)<\/f>/);
      if (f) formulas.push(unescapeXml(f[1] ?? ''));
      else if (/<f[^>]*\/>/.test(body)) formulas.push('(shared)');
      const v = body.match(/<v>([^<]*)<\/v>/)?.[1];
      if (/t="s"/.test(attrs) && v !== undefined) texts.push(strings[Number(v)] ?? '');
      else if (/t="inlineStr"/.test(attrs)) texts.push(xmlText(body));
      else if (/t="str"/.test(attrs) && v !== undefined) texts.push(unescapeXml(v));
      else if (v !== undefined && Number.isFinite(Number(v))) numbers.push(Number(v));
    }
  }
  return { sheets: sheetNames.length, text: texts.join('\n'), formulas, numbers };
}

export type PptxInfo = { slides: number; titles: string[]; text: string };
export function pptxInfo(bytes: Uint8Array): PptxInfo {
  const zip = readZip(bytes);
  const slides = [...zip.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/g)?.pop()) - Number(b.match(/\d+/g)?.pop()));
  if (!slides.length) throw new Error('no slides');
  const texts = slides.map((k) => dec.decode(zip.get(k) as Uint8Array));
  return {
    slides: slides.length,
    titles: texts.map((xml) => {
      const title = xml.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/);
      return xmlText(title?.[0] ?? xml).split(' ').slice(0, 12).join(' ');
    }),
    text: texts.map(xmlText).join('\n'),
  };
}

/** A PDF's header, end marker, page count and readable text (plain and Flate streams). */
export function pdfInfo(bytes: Uint8Array): { ok: boolean; pages: number; text: string } {
  const head = dec.decode(bytes.subarray(0, 8));
  const tail = dec.decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  const latin = Buffer.from(bytes).toString('latin1');
  const pages = (latin.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  const chunks: string[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const dict = latin.slice(Math.max(0, m.index - 300), m.index);
    let raw = Buffer.from(latin.slice(start, end), 'latin1');
    if (/FlateDecode/.test(dict.slice(dict.lastIndexOf('<<')))) {
      try {
        raw = inflateSync(raw);
      } catch {
        continue;
      }
    }
    chunks.push(raw.toString('latin1'));
  }
  const text = chunks
    .flatMap((c) => [...c.matchAll(/\((?:\\.|[^\\)])*\)/g)].map((s) => s[0].slice(1, -1).replace(/\\(.)/g, '$1')))
    .join(' ');
  return { ok: head.startsWith('%PDF-') && /%%EOF/.test(tail), pages, text };
}

/** A small valid PDF: one array of lines per page, Helvetica. */
export function writePdf(pages: string[][]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then per page: content, page.
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let next = 4;
  for (const lines of pages) {
    const body = ['BT', '/F1 12 Tf', '16 TL', '56 760 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
    const contentId = next++;
    const pageId = next++;
    objects[contentId] = `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/* ----------------------------------- png ----------------------------------- */
/** An 8-bit grayscale PNG from a pixel buffer (0 black … 255 white). */
export function writePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(enc.encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array()),
  ]);
}

/* ----------------------------------- csv ----------------------------------- */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

/* ------------------------------ minimal OOXML ------------------------------ */
/** Tiny but valid files of each kind, for the fake install and the self-test. */
export function minimalDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map((p, i) =>
      `<w:p>${i === 0 ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t xml:space="preserve">${escXml(p)}</w:t></w:r></w:p>`,
    )
    .join('');
  return writeZip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}
export function minimalXlsx(rows: (string | number | { f: string; v: number })[][]): Uint8Array {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = rows
    .map(
      (r, y) =>
        `<row r="${y + 1}">${r
          .map((c, x) => {
            const ref = `${col(x)}${y + 1}`;
            if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
            if (typeof c === 'object') return `<c r="${ref}"><f>${escXml(c.f)}</f><v>${c.v}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t>${escXml(c)}</t></is></c>`;
          })
          .join('')}</row>`,
    )
    .join('');
  return writeZip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  });
}
export function minimalPptx(slides: { title: string; body: string }[]): Uint8Array {
  const entries: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    'ppt/presentation.xml': '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
  };
  slides.forEach((s, i) => {
    entries[`ppt/slides/slide${i + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${escXml(s.title)}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>${escXml(s.body)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return writeZip(entries);
}
const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
