/**
 * DEMO / DEV DATA ONLY.
 *
 * Seeds 50 fully-detailed students (Grades 9-12, sections A/B at school "sch-1") with
 * multi-year grade-entry history across the real Ethiopian secondary curriculum — the
 * common Grade 9-10 subject list (Amharic, English, Mathematics, Biology, Chemistry,
 * Physics, Civics and Ethical Education, Geography, History, Information Technology,
 * Physical Education), and the streamed Grade 11-12 Natural Science / Social Science
 * subject lists. Every student has every one of their subjects fully graded and
 * finalized for every term/year, including the current one — so report-card and
 * transcript generation always has real, complete data to work with, at a class-sized
 * volume instead of the handful of rows the base db:seed leaves behind.
 *
 * Safe to re-run: it wipes its own previously-seeded rows first (see unseedAcademicDemo.ts)
 * before inserting fresh ones, and never touches real data — everything it creates is
 * tagged with the "demo-" id prefix.
 *
 * MUST be removed before go-live: run `npm run db:unseed:academic-demo` once real student
 * enrollment begins. None of this is wired into migrate.ts / ensureSchema.ts, so a fresh
 * production database never sees it unless this script is run explicitly.
 */
import { pool, query } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { currentAcademicYear } from '../lib/academicYear.js';
import { computeOverallAverage, computeRankings, computeSubjectAverage } from '../services/academicResults.js';
import { unseedAcademicDemo } from './unseedAcademicDemo.js';

const SCHOOL_ID = 'sch-1';
const CURRENT_TERM = 'Term 2 · 2026'; // must match src/lib/teacherPortal.ts CURRENT_TERM
const GRADES = ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
const SECTIONS = ['A', 'B'] as const;
const STUDENTS_PER_GRADE: Record<string, number> = { 'Grade 9': 13, 'Grade 10': 13, 'Grade 11': 12, 'Grade 12': 12 };

/**
 * Ethiopian secondary curriculum, grades 9-12. Grades 9-10 share one common (unstreamed)
 * subject list; grades 11-12 (preparatory) split into Natural Science / Social Science
 * streams, each with its own subject list — matching the real MoE structure.
 *
 * Some of these subjects have no matching teacher in the base seed data at all (Amharic,
 * Civics, Geography, History, ICT, Physical Education, Economics), and sch-1 specifically
 * has no Biology teacher — so this script creates a small number of additional demo
 * teachers (see EXTRA_TEACHERS) to cover them.
 */
type Stream = 'natural' | 'social';

const EXTRA_TEACHERS = [
  { id: 'demo-tch-amharic', name: 'Meseret Alemu', email: 'demo.tch.amharic@prime.edu.et', subject: 'Amharic', grades: ['Grade 9', 'Grade 10'] },
  { id: 'demo-tch-civics', name: 'Fikru Wondimu', email: 'demo.tch.civics@prime.edu.et', subject: 'Civics and Ethical Education', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
  { id: 'demo-tch-geography', name: 'Bethlehem Girma', email: 'demo.tch.geography@prime.edu.et', subject: 'Geography', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
  { id: 'demo-tch-history', name: 'Yared Mekonnen', email: 'demo.tch.history@prime.edu.et', subject: 'History', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
  { id: 'demo-tch-ict', name: 'Rahel Tesfaye', email: 'demo.tch.ict@prime.edu.et', subject: 'Information Technology', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
  { id: 'demo-tch-hpe', name: 'Dawit Assefa', email: 'demo.tch.hpe@prime.edu.et', subject: 'Physical Education', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
  { id: 'demo-tch-economics', name: 'Hana Berhanu', email: 'demo.tch.economics@prime.edu.et', subject: 'Economics', grades: ['Grade 11', 'Grade 12'] },
  { id: 'demo-tch-biology', name: 'Solomon Girma', email: 'demo.tch.biology@prime.edu.et', subject: 'Biology', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
];

const G9_10_SUBJECTS = [
  { subject: 'Amharic', teacherId: 'demo-tch-amharic' },
  { subject: 'English Language', teacherId: 'tch-4' },
  { subject: 'Mathematics', teacherId: 'tch-1' },
  { subject: 'Biology', teacherId: 'demo-tch-biology' },
  { subject: 'Chemistry', teacherId: 'tch-6' },
  { subject: 'Physics', teacherId: 'tch-8' },
  { subject: 'Civics and Ethical Education', teacherId: 'demo-tch-civics' },
  { subject: 'Geography', teacherId: 'demo-tch-geography' },
  { subject: 'History', teacherId: 'demo-tch-history' },
  { subject: 'Information Technology', teacherId: 'demo-tch-ict' },
  { subject: 'Physical Education', teacherId: 'demo-tch-hpe' },
];

const NATURAL_SCIENCE_SUBJECTS = [
  { subject: 'English Language', teacherId: 'tch-english-1' },
  { subject: 'Mathematics', teacherId: 'tch-7' },
  { subject: 'Biology', teacherId: 'demo-tch-biology' },
  { subject: 'Chemistry', teacherId: 'tch-6' },
  { subject: 'Physics', teacherId: 'tch-6' },
  { subject: 'Civics and Ethical Education', teacherId: 'demo-tch-civics' },
  { subject: 'Information Technology', teacherId: 'demo-tch-ict' },
  { subject: 'Physical Education', teacherId: 'demo-tch-hpe' },
];

const SOCIAL_SCIENCE_SUBJECTS = [
  { subject: 'English Language', teacherId: 'tch-english-1' },
  { subject: 'Mathematics', teacherId: 'tch-7' },
  { subject: 'Civics and Ethical Education', teacherId: 'demo-tch-civics' },
  { subject: 'Geography', teacherId: 'demo-tch-geography' },
  { subject: 'History', teacherId: 'demo-tch-history' },
  { subject: 'Economics', teacherId: 'demo-tch-economics' },
  { subject: 'Information Technology', teacherId: 'demo-tch-ict' },
  { subject: 'Physical Education', teacherId: 'demo-tch-hpe' },
];

/** Streaming starts at Grade 11 in the Ethiopian system — grades 9-10 always use the
 *  common list regardless of a student's eventual stream. */
function subjectsFor(grade: string, stream: Stream | undefined): { subject: string; teacherId: string }[] {
  if (gradeNumber(grade) <= 10) return G9_10_SUBJECTS;
  return stream === 'social' ? SOCIAL_SCIENCE_SUBJECTS : NATURAL_SCIENCE_SUBJECTS;
}

async function insertExtraTeachers() {
  for (const t of EXTRA_TEACHERS) {
    await query(
      `INSERT INTO teachers (id, name, email, phone, department_id, school_id, status, subjects, grades, certification, training_progress, years_experience)
       VALUES ($1,$2,$3,$4,NULL,$5,'Active',$6,$7,'',0,$8)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.name, t.email, `+2519${randomInt(10000000, 39999999)}`, SCHOOL_ID, JSON.stringify([t.subject]), JSON.stringify(t.grades), randomInt(2, 15)]
    );
  }
}

const FIRST_NAMES = [
  'Abebe', 'Kebede', 'Almaz', 'Tigist', 'Yohannes', 'Selamawit', 'Dawit', 'Hana',
  'Mekonnen', 'Rahel', 'Solomon', 'Bethlehem', 'Fikru', 'Meron', 'Girma', 'Sara',
  'Bereket', 'Eden', 'Tesfaye', 'Helen', 'Yared', 'Sofia', 'Henok', 'Liya',
  'Samuel', 'Kalkidan', 'Daniel', 'Mihret', 'Nathan', 'Ruth', 'Elias', 'Betelhem',
  'Nahom', 'Wude', 'Amanuel', 'Frehiwot', 'Kidus', 'Tsion', 'Robel', 'Netsanet',
  'Biniam', 'Aster', 'Yosef', 'Marta', 'Tewodros', 'Zewditu', 'Getachew', 'Lidya',
  'Alazar', 'Rediet',
];
const LAST_NAMES = [
  'Alemu', 'Bekele', 'Girma', 'Hailu', 'Tesfaye', 'Wolde', 'Assefa', 'Tadesse',
  'Mengistu', 'Desta', 'Gebremedhin', 'Haile', 'Demeke', 'Kassahun', 'Tekle',
  'Fikadu', 'Ayele', 'Berhanu', 'Yimer', 'Negash',
];

function percentToGpa(avgPercent: number): number {
  if (avgPercent >= 93) return 4.0;
  if (avgPercent >= 90) return 3.7;
  if (avgPercent >= 87) return 3.3;
  if (avgPercent >= 83) return 3.0;
  if (avgPercent >= 80) return 2.7;
  if (avgPercent >= 77) return 2.3;
  if (avgPercent >= 73) return 2.0;
  if (avgPercent >= 70) return 1.7;
  if (avgPercent >= 67) return 1.3;
  if (avgPercent >= 65) return 1.0;
  return 0.0;
}

function academicYearMinus(year: string, n: number): string {
  const startYear = Number(year.split('/')[0]);
  const start = startYear - n;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

function gradeNumber(grade: string): number {
  return Number((grade.match(/\d+/) || ['0'])[0]);
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

interface DemoStudent {
  id: string;
  studentId: string;
  name: string;
  grade: string;
  section: string;
  /** Only meaningful from Grade 11 on — Ethiopian streaming starts at preparatory level. */
  stream?: Stream;
  ability: number; // hidden 55-96 skill level driving realistic score spread
  parentName: string;
  parentPhone: string;
  parentEmail: string;
}

let studentIdCounter = 5000;

function buildStudents(): DemoStudent[] {
  const students: DemoStudent[] = [];
  let seq = 1;
  for (const grade of GRADES) {
    const total = STUDENTS_PER_GRADE[grade];
    const perSection = Math.ceil(total / SECTIONS.length);
    let created = 0;
    for (const section of SECTIONS) {
      const count = Math.min(perSection, total - created);
      for (let i = 0; i < count; i++) {
        const first = pick(FIRST_NAMES);
        const last = pick(LAST_NAMES);
        const parentFirst = pick(FIRST_NAMES);
        const parentLast = pick(LAST_NAMES);
        const idNum = String(seq).padStart(3, '0');
        students.push({
          id: `demo-std-${idNum}`,
          studentId: `PTS/${studentIdCounter++}/25`,
          name: `${first} ${last}`,
          grade,
          section,
          stream: gradeNumber(grade) >= 11 ? (randomInt(1, 100) <= 60 ? 'natural' : 'social') : undefined,
          ability: randomInt(55, 96),
          parentName: `${parentFirst} ${parentLast}`,
          parentPhone: `+2519${randomInt(10000000, 39999999)}`,
          parentEmail: `${parentFirst.toLowerCase()}.${parentLast.toLowerCase()}${seq}@example.com`,
        });
        seq++;
        created++;
      }
    }
  }
  return students;
}

function scoreFor(ability: number, maxScore: number): number {
  const noise = randomInt(-10, 10);
  const pct = Math.min(100, Math.max(30, ability + noise));
  return Math.round((pct / 100) * maxScore * 10) / 10;
}

async function insertStudent(s: DemoStudent, academicYear: string) {
  const birthYear = new Date().getFullYear() - (14 + (gradeNumber(s.grade) - 9)) - randomInt(0, 1);
  const dob = `${birthYear}-${String(randomInt(1, 12)).padStart(2, '0')}-${String(randomInt(1, 28)).padStart(2, '0')}`;
  await query(
    `INSERT INTO students
       (id, student_id, name, email, grade, section, school_id, parent_name, parent_phone, parent_email,
        status, gpa, attendance_rate, medical_info, emergency_contact, date_of_birth, academic_year)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active',0,$11,NULL,$12,$13,$14)`,
    [
      s.id,
      s.studentId,
      s.name,
      `${s.name.toLowerCase().replace(/\s+/g, '.')}@students.prime.edu.et`,
      s.grade,
      s.section,
      SCHOOL_ID,
      s.parentName,
      s.parentPhone,
      s.parentEmail,
      randomInt(85, 100),
      s.parentPhone,
      dob,
      academicYear,
    ]
  );
}

async function insertEnrollment(studentId: string, grade: string, section: string, academicYear: string, status: string) {
  await query(
    `INSERT INTO enrollments (id, school_id, student_id, grade, section, status, academic_year, activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOW())`,
    [newId('enr'), SCHOOL_ID, studentId, grade, section, status, academicYear]
  );
}

/** Inserts weighted grade entries for one student/subject/term and returns their computed average. */
async function seedSubjectEntries(
  student: DemoStudent,
  subject: string,
  teacherId: string,
  gradeLevel: string,
  term: string,
): Promise<number | null> {
  const assessments = [
    { type: 'Quiz', title: `${subject} Quiz 1`, max: 10, weight: 10 },
    { type: 'Mid Exam', title: `${subject} Mid Exam`, max: 50, weight: 30 },
    { type: 'Final Exam', title: `${subject} Final Exam`, max: 100, weight: 60 },
  ];
  const entries: { score: number; maxScore: number; weight: number }[] = [];
  for (const a of assessments) {
    const score = scoreFor(student.ability, a.max);
    entries.push({ score, maxScore: a.max, weight: a.weight });
    await query(
      `INSERT INTO student_grade_entries
         (id, student_id, teacher_id, subject, grade_level, section, entry_type, title, score, max_score, weight, term, recorded_at, school_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_DATE,$13)`,
      [newId('demo-ge'), student.id, teacherId, subject, gradeLevel, student.section, a.type, a.title, score, a.max, a.weight, term, SCHOOL_ID]
    );
  }
  return computeSubjectAverage(entries);
}

/**
 * Computes and writes student_term_summaries from whichever subject_term_results rows are
 * ALREADY status='finalized' in this scope. Every row this seed script writes gets its
 * terminal status set directly at insert time (unlike the real /finalize endpoint, which
 * promotes 'submitted' -> 'finalized' first) — so this never touches status itself, which
 * matters here because some subjects are deliberately left 'submitted' or entirely
 * un-submitted to give the Academic Head view a realistic mix to review.
 */
async function writeSummariesFromFinalized(gradeLevel: string, section: string, academicYear: string, term: string) {
  const { rows: allFinalized } = await query(
    `SELECT student_id, average_percent FROM subject_term_results
     WHERE grade_level = $1 AND section = $2 AND academic_year = $3 AND term = $4 AND status = 'finalized'`,
    [gradeLevel, section, academicYear, term]
  );
  const byStudent = new Map<string, number[]>();
  for (const r of allFinalized) {
    const list = byStudent.get(r.student_id) ?? [];
    if (r.average_percent != null) list.push(Number(r.average_percent));
    byStudent.set(r.student_id, list);
  }
  const overallByStudent = Array.from(byStudent.entries()).map(([studentId, averages]) => ({
    id: studentId,
    average: computeOverallAverage(averages),
  }));
  const rankings = computeRankings(overallByStudent);
  for (const r of rankings) {
    await query(
      `INSERT INTO student_term_summaries
         (id, school_id, student_id, grade_level, section, academic_year, term, overall_average, rank, rank_population, finalized_at, finalized_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),'demo-seed')
       ON CONFLICT (student_id, grade_level, section, academic_year, term)
       DO UPDATE SET overall_average = EXCLUDED.overall_average, rank = EXCLUDED.rank,
         rank_population = EXCLUDED.rank_population, finalized_at = NOW(), finalized_by = 'demo-seed'`,
      [newId('demo-sts'), SCHOOL_ID, r.id, gradeLevel, section, academicYear, term, r.average, r.rank, r.population]
    );
  }
  return rankings.length;
}

/**
 * Seeds one completed, fully-finalized grade-year of history for students whose CURRENT
 * grade is `currentGrade` — but tags every row with `historicalGrade` (a grade below their
 * current one, e.g. a Grade 12 student's Grade 9 history), which is what makes the
 * transcript's Grade 9-12 range aggregation have real depth to show.
 */
async function seedHistoricalYear(
  students: DemoStudent[],
  currentGrade: string,
  historicalGrade: string,
  section: string,
  academicYear: string,
) {
  const roster = students.filter((s) => s.grade === currentGrade && s.section === section);
  for (const term of ['Semester I', 'Semester II']) {
    for (const student of roster) {
      for (const { subject, teacherId } of subjectsFor(historicalGrade, student.stream)) {
        const avg = await seedSubjectEntries(student, subject, teacherId, historicalGrade, term);
        await query(
          `INSERT INTO subject_term_results
             (id, school_id, student_id, teacher_id, subject, grade_level, section, academic_year, term,
              average_percent, status, submitted_at, submitted_by, finalized_at, finalized_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'finalized',NOW(),'demo-seed',NOW(),'demo-seed',NOW())
           ON CONFLICT (student_id, subject, grade_level, section, academic_year, term) DO NOTHING`,
          [newId('demo-str'), SCHOOL_ID, student.id, teacherId, subject, historicalGrade, section, academicYear, term, avg]
        );
      }
    }
    await writeSummariesFromFinalized(historicalGrade, section, academicYear, term);
  }
}

/**
 * Current grade/term — every student gets every subject, fully submitted and finalized,
 * exactly like a completed historical year. Report-card and transcript generation only
 * ever reads finalized data, so any gap here (a skipped student, a subject left in
 * draft/submitted) shows up to a user as "no grade entries" — this seed intentionally
 * leaves none.
 */
async function seedCurrentYear(students: DemoStudent[], grade: string, academicYear: string) {
  for (const section of SECTIONS) {
    const roster = students.filter((s) => s.grade === grade && s.section === section);
    if (!roster.length) continue;

    for (const student of roster) {
      for (const { subject, teacherId } of subjectsFor(grade, student.stream)) {
        const avg = await seedSubjectEntries(student, subject, teacherId, grade, CURRENT_TERM);
        await query(
          `INSERT INTO subject_term_results
             (id, school_id, student_id, teacher_id, subject, grade_level, section, academic_year, term,
              average_percent, status, submitted_at, submitted_by, finalized_at, finalized_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'finalized',NOW(),'demo-seed',NOW(),'demo-seed',NOW())
           ON CONFLICT (student_id, subject, grade_level, section, academic_year, term) DO NOTHING`,
          [newId('demo-str'), SCHOOL_ID, student.id, teacherId, subject, grade, section, academicYear, CURRENT_TERM, avg]
        );
      }
    }

    await writeSummariesFromFinalized(grade, section, academicYear, CURRENT_TERM);
  }
}

async function main() {
  console.log('Removing any previously-seeded demo academic data...');
  await unseedAcademicDemo();

  const academicYear = currentAcademicYear();
  console.log(`Seeding 50 demo students for academic year ${academicYear}...`);

  await insertExtraTeachers();
  console.log(`Inserted ${EXTRA_TEACHERS.length} additional subject teachers.`);

  const students = buildStudents();
  for (const s of students) {
    await insertStudent(s, academicYear);
    await insertEnrollment(s.id, s.grade, s.section, academicYear, 'active');
  }
  console.log(`Inserted ${students.length} students.`);

  // Historical (completed, fully finalized) grade-years, one per grade below the student's
  // current grade, so Grade 10-12 students have real transcript depth immediately.
  for (const grade of GRADES) {
    const gradesBelow = GRADES.filter((g) => gradeNumber(g) < gradeNumber(grade));
    for (const belowGrade of gradesBelow) {
      const yearsAgo = gradeNumber(grade) - gradeNumber(belowGrade);
      const historicalYear = academicYearMinus(academicYear, yearsAgo);
      for (const section of SECTIONS) {
        const roster = students.filter((s) => s.grade === grade && s.section === section);
        if (!roster.length) continue;
        // Historical enrollment record for that earlier grade/year.
        for (const s of roster) {
          await insertEnrollment(s.id, belowGrade, section, historicalYear, 'completed');
        }
        console.log(`  Historical: ${belowGrade} · ${section} · ${historicalYear} (${roster.length} students)`);
        await seedHistoricalYear(students, grade, belowGrade, section, historicalYear);
      }
    }
  }

  // Current in-progress grade/term — mixed draft/submitted/finalized so there's live work
  // for both the teacher and Academic Head portals to act on.
  for (const grade of GRADES) {
    console.log(`  Current term: ${grade} · ${CURRENT_TERM}`);
    await seedCurrentYear(students, grade, academicYear);
  }

  // GPA, matching the same weighted-average-across-all-entries formula the app's own
  // recalculate-gpa endpoint uses, so existing GPA-based dashboards look realistic too.
  for (const s of students) {
    const { rows: entries } = await query(
      `SELECT score, max_score, weight FROM student_grade_entries WHERE student_id = $1`,
      [s.id]
    );
    if (!entries.length) continue;
    const totalWeight = entries.reduce((a, e) => a + Number(e.weight), 0);
    if (totalWeight === 0) continue;
    const weighted = entries.reduce((a, e) => {
      const max = Number(e.max_score);
      const pct = max > 0 ? (Number(e.score) / max) * 100 : 0;
      return a + pct * Number(e.weight);
    }, 0);
    const gpa = percentToGpa(weighted / totalWeight);
    await query('UPDATE students SET gpa = $1 WHERE id = $2', [gpa, s.id]);
  }

  console.log('Done. Run `npm run db:unseed:academic-demo` to remove this data before go-live.');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
