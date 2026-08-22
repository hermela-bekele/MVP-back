/** School year runs roughly September through July; a date in Sept–Dec belongs to the
 * year starting that calendar year, a date in Jan–Aug belongs to the year that started
 * the previous calendar year. Formatted like "2025/26". */
export function currentAcademicYear(d: Date = new Date()): string {
  const month = d.getMonth() + 1; // 1-12
  const startYear = month >= 9 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function nextAcademicYear(year: string): string {
  const startYear = Number(year.split('/')[0]);
  if (!Number.isFinite(startYear)) return year;
  return `${startYear + 1}/${String((startYear + 2) % 100).padStart(2, '0')}`;
}
