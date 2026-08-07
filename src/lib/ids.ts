export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function referenceCode(prefix = 'APP'): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${n}`;
}

export function invoiceNumber(schoolCode: string, seq: number): string {
  const y = new Date().getFullYear();
  return `INV-${schoolCode}-${y}-${String(seq).padStart(5, '0')}`;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toDateOnly(d: Date | string): string {
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    const parsed = new Date(d);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return d.slice(0, 10);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysUntil(dueDate: string | Date): number {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueNorm = new Date(due);
  dueNorm.setHours(0, 0, 0, 0);
  return Math.ceil((dueNorm.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export type DeadlineColor = 'green' | 'yellow' | 'red';

export function deadlineColor(daysRemaining: number, yellowDays = 7): DeadlineColor {
  if (daysRemaining < 0) return 'red';
  if (daysRemaining <= yellowDays) return 'yellow';
  return 'green';
}
