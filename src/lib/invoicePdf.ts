/**
 * Minimal PDF builder for invoice attachments (no native deps).
 * Generates a single-page Helvetica invoice suitable for email.
 */

type LineItem = {
  description: string;
  lineTotal: number;
  lineType?: string;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  schoolName: string;
  studentName?: string;
  parentName?: string;
  invoiceType: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: number;
  lateFeeTotal: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string | null;
  lineItems: LineItem[];
};

function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function money(n: number, currency: string): string {
  return `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Build a simple one-page PDF buffer for an invoice. */
export function buildInvoicePdf(data: InvoicePdfData): Buffer {
  const lines: string[] = [];
  const push = (text: string, x: number, y: number, size = 11) => {
    lines.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`);
  };

  let y = 780;
  push(data.schoolName || 'School', 50, y, 16);
  y -= 22;
  push('INVOICE', 50, y, 14);
  y -= 28;
  push(`Invoice #: ${data.invoiceNumber}`, 50, y);
  y -= 16;
  push(`Type: ${data.invoiceType}`, 50, y);
  y -= 16;
  push(`Issued: ${data.issueDate}    Due: ${data.dueDate}`, 50, y);
  y -= 16;
  if (data.studentName) {
    push(`Student: ${data.studentName}`, 50, y);
    y -= 16;
  }
  if (data.parentName) {
    push(`Bill to: ${data.parentName}`, 50, y);
    y -= 16;
  }
  y -= 12;
  push('Line items', 50, y, 12);
  y -= 18;
  push('Description', 50, y, 10);
  push('Amount', 420, y, 10);
  y -= 14;
  push('------------------------------------------------', 50, y, 10);
  y -= 16;

  for (const li of data.lineItems) {
    const desc = (li.description || '').slice(0, 55);
    push(desc, 50, y, 10);
    push(money(li.lineTotal, data.currency), 400, y, 10);
    y -= 14;
    if (y < 120) break;
  }

  y -= 10;
  push(`Subtotal: ${money(data.subtotal, data.currency)}`, 50, y);
  y -= 14;
  if (data.lateFeeTotal > 0) {
    push(`Late fees: ${money(data.lateFeeTotal, data.currency)}`, 50, y);
    y -= 14;
  }
  push(`Amount paid: ${money(data.amountPaid, data.currency)}`, 50, y);
  y -= 14;
  push(`Balance due: ${money(data.balanceDue, data.currency)}`, 50, y, 12);
  y -= 22;
  if (data.notes) {
    push(`Notes: ${String(data.notes).slice(0, 80)}`, 50, y, 9);
    y -= 14;
  }
  push('Pay in the parent portal before the deadline to confirm enrollment.', 50, y - 6, 9);

  const content = lines.join('\n');
  const objects: string[] = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj');
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj'
  );
  objects.push(`4 0 obj<< /Length ${Buffer.byteLength(content, 'utf8')} >>stream\n${content}\nendstream\nendobj`);
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj + '\n';
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export function invoicePdfFilename(invoiceNumber: string): string {
  const safe = String(invoiceNumber || 'invoice').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `${safe}.pdf`;
}
