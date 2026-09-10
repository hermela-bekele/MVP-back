import { query } from './pool.js';
import { isPrivilegedStaff } from '../lib/roles.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  mapSchool,
  mapDepartment,
  mapTeacher,
  mapStudent,
  mapSchoolClass,
  mapLessonPlan,
  mapAssessment,
  mapAttendance,
  mapTeacherTraining,
  mapSchoolCheckIn,
  mapExam,
  mapTrainingMaterial,
  mapTrainingPlan,
  mapTrainingPlanAssignment,
  mapTeachingNote,
  mapAcademicCalendar,
  mapStudentGradeEntry,
  mapTeacherResource,
  mapTeacherFeedback,
  mapParentMessage,
  mapTeacherCheckInPrompt,
  mapNotification,
  mapLessonDelivery,
  mapCommunityPost,
  mapCommunityReply,
  mapStaffMessage,
  mapTeacherSelfAssessment,
  mapTeacherTrainingAssignment,
  mapHrEmployee,
  mapLeaveRequest,
  mapPayrollRecord,
  mapJobPosting,
  mapJobApplication,
  mapPerformanceReview,
  mapOnboardingTask,
  mapStaffAttendanceRecord,
  mapMoeCalendarDraft,
} from '../lib/serialize.js';

export async function loadBootstrap(caller: AuthUser) {
  const [
    schools,
    departments,
    teachers,
    students,
    classes,
    lessonPlans,
    assessments,
    attendance,
    trainings,
    checkIns,
    exams,
    trainingMaterials,
    trainingPlans,
    trainingPlanAssignments,
    teachingNotes,
    studentGradeEntries,
    teacherResources,
    teacherFeedbacks,
    parentMessages,
    teacherCheckInPrompts,
    notifications,
    academicCalendars,
    lessonDeliveries,
    communityPosts,
    communityReplies,
    staffMessages,
    teacherSelfAssessments,
    teacherTrainingAssignments,
    hrEmployees,
    leaveRequests,
    payrollRecords,
    jobPostings,
    jobApplications,
    performanceReviews,
    onboardingTasks,
    staffAttendance,
    regions,
    moeCalendarRows,
  ] = await Promise.all([
    query('SELECT * FROM schools ORDER BY name'),
    query('SELECT * FROM departments ORDER BY name'),
    query('SELECT * FROM teachers ORDER BY name'),
    query('SELECT * FROM students ORDER BY name'),
    query('SELECT * FROM school_classes ORDER BY grade, section'),
    query('SELECT * FROM lesson_plans ORDER BY created_at DESC'),
    query('SELECT * FROM assessments ORDER BY created_at DESC'),
    query('SELECT * FROM attendance ORDER BY date DESC'),
    query('SELECT * FROM teacher_trainings ORDER BY start_date'),
    query('SELECT * FROM school_check_ins ORDER BY date DESC'),
    query('SELECT * FROM exams ORDER BY created_at DESC'),
    query('SELECT * FROM training_materials ORDER BY uploaded_at DESC'),
    query('SELECT * FROM training_plans ORDER BY start_date DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM training_plan_assignments ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM teaching_notes ORDER BY created_at DESC'),
    query('SELECT * FROM student_grade_entries ORDER BY recorded_at DESC'),
    // TE-010: /bootstrap is unauthenticated, so it must never leak resources awaiting
    // (or denied) HoD review to peer teachers/students. A teacher's own non-approved
    // uploads are fetched separately via the authenticated /teacher-resources/mine route.
    query("SELECT * FROM teacher_resources WHERE status = 'APPROVED' ORDER BY created_at DESC"),
    query('SELECT * FROM teacher_feedbacks ORDER BY date DESC'),
    query('SELECT * FROM parent_messages ORDER BY sent_at DESC'),
    query('SELECT * FROM teacher_check_in_prompts ORDER BY due_date'),
    // Cross-portal audit finding: this used to return every notification ever
    // created to every logged-in user regardless of role or school. A row is
    // now visible only if it targets this user directly, this user's school,
    // or is a legacy/intentionally-global row (both user_id and school_id null).
    query(
      `SELECT * FROM notifications
       WHERE user_id = $1
          OR (user_id IS NULL AND school_id IS NULL)
          OR (user_id IS NULL AND school_id = $2)
       ORDER BY created_at DESC`,
      [caller.id, caller.schoolId ?? null]
    ),
    query('SELECT * FROM academic_calendars ORDER BY created_at DESC'),
    query('SELECT * FROM lesson_deliveries ORDER BY delivered_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM community_posts ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM community_replies ORDER BY created_at ASC').catch(() => ({ rows: [] })),
    query('SELECT * FROM staff_messages ORDER BY created_at ASC').catch(() => ({ rows: [] })),
    query('SELECT * FROM teacher_self_assessments ORDER BY submitted_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM teacher_training_assignments ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM hr_employees ORDER BY name').catch(() => ({ rows: [] })),
    query('SELECT * FROM leave_requests ORDER BY submitted_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM payroll_records ORDER BY month DESC').catch(() => ({ rows: [] })),
    query(
      `SELECT jp.*, COALESCE(ja.applicant_count, 0) AS applicant_count
       FROM job_postings jp
       LEFT JOIN (
         SELECT job_id, COUNT(*)::int AS applicant_count FROM job_applications GROUP BY job_id
       ) ja ON ja.job_id = jp.id
       ORDER BY jp.posted_at DESC`
    ).catch(() => ({ rows: [] })),
    query('SELECT * FROM job_applications ORDER BY applied_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM performance_reviews ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    query('SELECT * FROM onboarding_tasks ORDER BY due_date').catch(() => ({ rows: [] })),
    query('SELECT * FROM staff_attendance ORDER BY date DESC').catch(() => ({ rows: [] })),
    query('SELECT id, name FROM regions ORDER BY name').catch(() => ({ rows: [] })),
    // §6: MOE sees its own latest draft (to resume editing); every other role
    // only ever sees the latest Published one — the same rule as GET /moe-calendar.
    query(
      caller.role === 'moe'
        ? 'SELECT * FROM moe_calendar_drafts ORDER BY created_at DESC LIMIT 1'
        : "SELECT * FROM moe_calendar_drafts WHERE status = 'Published' ORDER BY created_at DESC LIMIT 1"
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    schools: schools.rows.map(mapSchool),
    regions: regions.rows.map((r) => ({ id: r.id, name: r.name })),
    moeCalendar: moeCalendarRows.rows.length ? mapMoeCalendarDraft(moeCalendarRows.rows[0]) : null,
    departments: departments.rows.map(mapDepartment),
    // PR-002: a teacher's personal phone is institutional-need-to-know — visible to
    // privileged staff and to the teacher's own record, masked for everyone else
    // (parents, students, peer teachers) since /bootstrap is a shared, broad payload.
    teachers: teachers.rows.map((row) =>
      mapTeacher(row, {
        maskPersonalContact:
          !isPrivilegedStaff(caller.role) &&
          String(row.email ?? '').toLowerCase() !== caller.email.toLowerCase(),
      })
    ),
    students: students.rows.map(mapStudent),
    classes: classes.rows.map(mapSchoolClass),
    lessonPlans: lessonPlans.rows.map(mapLessonPlan),
    assessments: assessments.rows.map(mapAssessment),
    attendance: attendance.rows.map(mapAttendance),
    trainings: trainings.rows.map(mapTeacherTraining),
    checkIns: checkIns.rows.map(mapSchoolCheckIn),
    exams: exams.rows.map(mapExam),
    trainingMaterials: trainingMaterials.rows.map(mapTrainingMaterial),
    trainingPlans: trainingPlans.rows.map(mapTrainingPlan),
    trainingPlanAssignments: trainingPlanAssignments.rows.map(mapTrainingPlanAssignment),
    teachingNotes: teachingNotes.rows.map(mapTeachingNote),
    studentGradeEntries: studentGradeEntries.rows.map(mapStudentGradeEntry),
    teacherResources: teacherResources.rows.map(mapTeacherResource),
    teacherFeedbacks: teacherFeedbacks.rows.map(mapTeacherFeedback),
    parentMessages: parentMessages.rows.map(mapParentMessage),
    teacherCheckInPrompts: teacherCheckInPrompts.rows.map(mapTeacherCheckInPrompt),
    notifications: notifications.rows.map(mapNotification),
    academicCalendars: academicCalendars.rows.map(mapAcademicCalendar),
    lessonDeliveries: lessonDeliveries.rows.map(mapLessonDelivery),
    communityPosts: communityPosts.rows.map(mapCommunityPost),
    communityReplies: communityReplies.rows.map(mapCommunityReply),
    staffMessages: staffMessages.rows.map(mapStaffMessage),
    teacherSelfAssessments: teacherSelfAssessments.rows.map(mapTeacherSelfAssessment),
    teacherTrainingAssignments: teacherTrainingAssignments.rows.map(mapTeacherTrainingAssignment),
    hrEmployees: hrEmployees.rows.map(mapHrEmployee),
    leaveRequests: leaveRequests.rows.map(mapLeaveRequest),
    payrollRecords: payrollRecords.rows.map(mapPayrollRecord),
    jobPostings: jobPostings.rows.map(mapJobPosting),
    jobApplications: jobApplications.rows.map(mapJobApplication),
    performanceReviews: performanceReviews.rows.map(mapPerformanceReview),
    onboardingTasks: onboardingTasks.rows.map(mapOnboardingTask),
    staffAttendance: staffAttendance.rows.map(mapStaffAttendanceRecord),
  };
}
