/** Client-side builder for clean, real PDF receipts and hire agreements (no screenshots). */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

export type Branding = {
  company_name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  kra_pin: string | null;
  website: string | null;
  logo_data_url: string | null;
  extra_logos: unknown;
  accent_color: string;
  receipt_footer: string | null;
  agreement_footer: string | null;
  agreement_extra_terms: string | null;
};

export const DEFAULT_BRANDING: Branding = {
  company_name: "Twende Rides",
  tagline: "Meru, Kenya",
  address: "Meru Town, Kenya",
  phone: null,
  email: "ride@twendemeru.co.ke",
  kra_pin: null,
  website: "twenderides.lovable.app",
  logo_data_url: null,
  extra_logos: [],
  accent_color: "#0F766E",
  receipt_footer: "Thank you for riding with Twende.",
  agreement_footer: "This agreement is binding under the laws of Kenya.",
  agreement_extra_terms: null,
};

export type ReceiptData = {
  kind: "ride" | "hire";
  reference: string;
  customer: string;
  phone: string | null;
  lines: [string, string][];
  total: number;
  paid: number;
  payments: { code: string | null; amount: number; at: string; method: string }[];
  issuedAt: string;
};

export type AgreementSection = { title: string; rows?: [string, string][]; paragraphs: string[] };
export type AgreementPdfData = {
  reference: string;
  modeLabel: string;
  sections: AgreementSection[];
  hirer: { name: string; signature: string | null; at: string | null };
  owner: { name: string; signature: string | null; at: string | null };
  photos: { label: string; url: string | null }[];
};

const A4: [number, number] = [595.28, 841.89];
const M = 48;

/** Helvetica only covers WinAnsi; replace characters it cannot draw. */
function clean(s: string) {
  return s
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00B7\u2022]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, "");
}

function hex(c: string) {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && line) {
        out.push(line);
        line = w;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

async function embedDataImage(doc: PDFDocument, src: string | null): Promise<PDFImage | null> {
  if (!src) return null;
  try {
    let bytes: Uint8Array;
    let png = src.startsWith("data:image/png");
    if (src.startsWith("data:")) {
      bytes = Uint8Array.from(atob(src.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
    } else {
      const r = await fetch(src);
      const ct = r.headers.get("content-type") ?? "";
      png = ct.includes("png");
      if (!png && !ct.includes("jpeg") && !ct.includes("jpg")) return null;
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    return png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    public doc: PDFDocument,
    public font: PDFFont,
    public bold: PDFFont,
    public brand: Branding,
    public logos: PDFImage[],
    public docTitle: string,
    public ref: string,
  ) {}
  get width() {
    return A4[0] - M * 2;
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    this.letterhead();
  }
  letterhead() {
    const p = this.page;
    const accent = hex(this.brand.accent_color);
    p.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: accent });
    let x = M;
    const top = A4[1] - M + 8;
    for (const img of this.logos.slice(0, 3)) {
      const s = img.scaleToFit(70, 44);
      p.drawImage(img, { x, y: top - s.height, width: s.width, height: s.height });
      x += s.width + 8;
    }
    p.drawText(clean(this.brand.company_name), { x, y: top - 16, size: 16, font: this.bold, color: accent });
    if (this.brand.tagline) p.drawText(clean(this.brand.tagline), { x, y: top - 30, size: 9, font: this.font, color: rgb(0.35, 0.35, 0.35) });
    const contact = [this.brand.address, this.brand.phone, this.brand.email, this.brand.website, this.brand.kra_pin ? `KRA PIN ${this.brand.kra_pin}` : null]
      .filter(Boolean)
      .map((s) => clean(String(s)));
    let cy = top - 6;
    for (const c of contact.slice(0, 4)) {
      const w = this.font.widthOfTextAtSize(c, 8);
      p.drawText(c, { x: A4[0] - M - w, y: cy, size: 8, font: this.font, color: rgb(0.35, 0.35, 0.35) });
      cy -= 11;
    }
    this.y = top - 56;
    p.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 1, color: accent });
    this.y -= 22;
    const footer = clean(`${this.docTitle} - Ref ${this.ref} - Page ${this.doc.getPageCount()}`);
    p.drawText(footer, { x: M, y: 24, size: 8, font: this.font, color: rgb(0.5, 0.5, 0.5) });
  }
  ensure(h: number) {
    if (this.y - h < 50) this.newPage();
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const f = opts.bold ? this.bold : this.font;
    const lines = wrap(s, f, size, this.width - (opts.indent ?? 0));
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x: M + (opts.indent ?? 0), y: this.y, size, font: f, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 2;
  }
  rows(rows: [string, string][]) {
    for (const [k, v] of rows) {
      const lines = wrap(v || "-", this.bold, 9.5, this.width - 170);
      this.ensure(lines.length * 13 + 2);
      this.page.drawText(clean(k), { x: M, y: this.y, size: 9.5, font: this.font, color: rgb(0.4, 0.4, 0.4) });
      for (const l of lines) {
        this.page.drawText(l, { x: M + 170, y: this.y, size: 9.5, font: this.bold });
        this.y -= 13;
      }
    }
    this.y -= 4;
  }
}

async function setup(brand: Branding, title: string, ref: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} ${ref}`);
  doc.setAuthor(brand.company_name);
  doc.setCreator(brand.company_name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const extra = Array.isArray(brand.extra_logos) ? (brand.extra_logos as string[]) : [];
  const logos = (await Promise.all([brand.logo_data_url, ...extra].map((l) => embedDataImage(doc, l)))).filter(Boolean) as PDFImage[];
  const w = new Writer(doc, font, bold, brand, logos, title, ref);
  w.newPage();
  return w;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function buildReceiptPdf(brandIn: Branding | null, r: ReceiptData) {
  const brand = brandIn ?? DEFAULT_BRANDING;
  const w = await setup(brand, "Official Receipt", r.reference);
  const accent = hex(brand.accent_color);
  w.text(r.kind === "ride" ? "TRIP RECEIPT" : "CAR HIRE RECEIPT", { size: 18, bold: true, color: accent, gap: 6 });
  w.rows([
    ["Receipt no.", r.reference],
    ["Issued", new Date(r.issuedAt).toLocaleString("en-KE")],
    ["Billed to", r.customer],
    ["Phone", r.phone ?? "-"],
  ]);
  w.y -= 6;
  w.text("Details", { size: 12, bold: true, gap: 4 });
  w.rows(r.lines);
  w.y -= 6;
  w.text("Payments", { size: 12, bold: true, gap: 4 });
  if (!r.payments.length) w.text("No payment recorded yet.", { size: 9.5 });
  for (const p of r.payments) {
    w.rows([[`${p.method}${p.code ? ` ${p.code}` : ""}`, `${kes(p.amount)} - ${new Date(p.at).toLocaleString("en-KE")}`]]);
  }
  w.ensure(70);
  w.y -= 6;
  w.page.drawRectangle({ x: M, y: w.y - 46, width: w.width, height: 52, color: rgb(0.96, 0.97, 0.97), borderColor: accent, borderWidth: 1 });
  w.page.drawText("Total", { x: M + 12, y: w.y - 14, size: 10, font: w.font });
  w.page.drawText(clean(kes(r.total)), { x: M + 12, y: w.y - 36, size: 18, font: w.bold, color: accent });
  const bal = Math.max(0, r.total - r.paid);
  const status = bal <= 0.009 ? "PAID IN FULL" : `BALANCE ${kes(bal)}`;
  const sw = w.bold.widthOfTextAtSize(status, 12);
  w.page.drawText(clean(status), { x: A4[0] - M - 12 - sw, y: w.y - 30, size: 12, font: w.bold, color: bal <= 0.009 ? accent : rgb(0.7, 0.3, 0) });
  w.y -= 70;
  if (brand.receipt_footer) w.text(brand.receipt_footer, { size: 9, color: rgb(0.4, 0.4, 0.4) });
  return w.doc.save();
}

export async function buildAgreementPdf(brandIn: Branding | null, a: AgreementPdfData) {
  const brand = brandIn ?? DEFAULT_BRANDING;
  const w = await setup(brand, "Vehicle Hire Agreement", a.reference);
  const accent = hex(brand.accent_color);
  w.text("DIGITAL VEHICLE HIRE & RENTAL AGREEMENT", { size: 15, bold: true, color: accent });
  w.text(`Booking ${a.reference} - ${a.modeLabel}`, { size: 10, gap: 10 });
  a.sections.forEach((s, i) => {
    w.ensure(40);
    w.text(`${i + 1}. ${s.title}`, { size: 11.5, bold: true, gap: 3 });
    if (s.rows) w.rows(s.rows);
    for (const p of s.paragraphs) w.text(p, { size: 9.5, gap: 4 });
    w.y -= 6;
  });
  const imgs = await Promise.all(a.photos.map(async (p) => ({ label: p.label, img: await embedDataImage(w.doc, p.url) })));
  if (imgs.some((i) => i.img)) {
    w.ensure(130);
    w.text("Walkaround photos at pick-up", { size: 11, bold: true, gap: 4 });
    const cw = (w.width - 24) / 4;
    imgs.forEach((p, i) => {
      const x = M + i * (cw + 8);
      if (p.img) {
        const s = p.img.scaleToFit(cw, 90);
        w.page.drawImage(p.img, { x, y: w.y - s.height, width: s.width, height: s.height });
      }
      w.page.drawText(clean(p.label), { x, y: w.y - 102, size: 8, font: w.font });
    });
    w.y -= 120;
  }
  w.ensure(150);
  w.text("Execution", { size: 11.5, bold: true, gap: 6 });
  const boxW = (w.width - 16) / 2;
  const top = w.y;
  for (const [i, party] of [["Hirer", a.hirer], ["Owner / Twende", a.owner]] as const) {
    const x = M + i * (boxW + 16);
    w.page.drawRectangle({ x, y: top - 110, width: boxW, height: 110, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
    w.page.drawText(clean(`${party === a.hirer ? "Hirer" : "Owner / Twende"} signature`), { x: x + 8, y: top - 14, size: 8, font: w.font, color: rgb(0.4, 0.4, 0.4) });
    if (party.signature?.startsWith("data:image")) {
      const img = await embedDataImage(w.doc, party.signature);
      if (img) {
        const s = img.scaleToFit(boxW - 16, 56);
        w.page.drawImage(img, { x: x + 8, y: top - 76, width: s.width, height: s.height });
      }
    } else if (party.signature) {
      w.page.drawText(clean(party.signature.replace(/^typed:/, "")), { x: x + 8, y: top - 56, size: 18, font: w.bold, color: accent });
    }
    w.page.drawText(clean(party.name), { x: x + 8, y: top - 90, size: 9, font: w.bold });
    w.page.drawText(clean(party.at ? `Signed ${new Date(party.at).toLocaleString("en-KE")}` : "Not signed"), { x: x + 8, y: top - 102, size: 8, font: w.font });
  }
  w.y = top - 126;
  const badge = "DIGITALLY SIGNED BY BOTH PARTIES - VERIFIED";
  w.page.drawRectangle({ x: M, y: w.y - 22, width: w.width, height: 26, color: accent });
  w.page.drawText(badge, { x: M + (w.width - w.bold.widthOfTextAtSize(badge, 10)) / 2, y: w.y - 13, size: 10, font: w.bold, color: rgb(1, 1, 1) });
  w.y -= 40;
  if (brand.agreement_footer) w.text(brand.agreement_footer, { size: 8.5, color: rgb(0.4, 0.4, 0.4) });
  return w.doc.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
