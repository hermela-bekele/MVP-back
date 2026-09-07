/**
 * Removes everything created by seedAcademicDemo.ts (all rows tagged with the "demo-std-"
 * student id prefix or the "demo-tch-" teacher id prefix, and their dependent grade
 * entries / academic results / enrollments).
 *
 * Run this once before go-live, or any time you want the 50 demo students gone without
 * touching real data — nothing here matches a real student or teacher id.
 */
import { pathToFileURL } from 'url';
import { pool, query } from '../db/pool.js';

export async function unseedAcademicDemo() {
  // Order matters: student_grade_entries and enrollments have no ON DELETE CASCADE back to
  // students, so they must be cleared before the student rows themselves. Same for the
  // demo-only teacher rows, which every demo grade entry/result has already been removed
  // from referencing by the time we get to them.
  const entries = await query(`DELETE FROM student_grade_entries WHERE student_id LIKE 'demo-std-%' RETURNING id`);
  const results = await query(`DELETE FROM subject_term_results WHERE student_id LIKE 'demo-std-%' RETURNING id`);
  const summaries = await query(`DELETE FROM student_term_summaries WHERE student_id LIKE 'demo-std-%' RETURNING id`);
  const enrollments = await query(`DELETE FROM enrollments WHERE student_id LIKE 'demo-std-%' RETURNING id`);
  const students = await query(`DELETE FROM students WHERE id LIKE 'demo-std-%' RETURNING id`);
  const teachers = await query(`DELETE FROM teachers WHERE id LIKE 'demo-tch-%' RETURNING id`);

  console.log(
    `Removed ${students.rows.length} demo students, ${teachers.rows.length} demo teachers, ` +
      `${entries.rows.length} grade entries, ${results.rows.length} subject-term results, ` +
      `${summaries.rows.length} term summaries, ${enrollments.rows.length} enrollments.`
  );
  return students.rows.length;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  unseedAcademicDemo()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
