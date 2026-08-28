/** Map PostgreSQL snake_case rows to frontend camelCase shapes */

export function mapSchool(row: Record<string, unknown>) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    region: row.region,
    type: row.type,
    principal: row.principal,
    email: row.email,
    phone: row.phone,
    capacity: Number(row.capacity),
    studentsCount: Number(row.students_count),
    teachersCount: Number(row.teachers_count),
    status: row.status,
    gps: row.gps,
  };
}

export function mapDepartment(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    headName: row.head_name,
    teachersCount: Number(row.teachers_count),
    subjectsCount: Number(row.subjects_count),
    status: row.status,
  };
}

export function mapTeacher(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    departmentId: row.department_id,
    schoolId: row.school_id,
    status: row.status,
    subjects: row.subjects ?? [],
    grades: row.grades ?? [],
    certification: row.certification,
    trainingProgress: Number(row.training_progress),
    yearsOfExperience: Number(row.years_experience ?? 0),
    experienceOverride: row.experience_override ?? null,
  };
}

export function mapTeacherSelfAssessment(row: Record<string, unknown>) {
  const d = row.submitted_at;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    responses: row.responses ?? [],
    overallScore: Number(row.overall_score),
    weakestCompetencyId: row.weakest_competency_id ?? undefined,
    submittedAt:
      d instanceof Date ? d.toISOString() : String(d),
  };
}

export function mapTeacherTrainingAssignment(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    program: row.program,
    moduleId: row.module_id,
    moduleTitle: row.module_title,
    assignedByName: row.assigned_by_name,
    reason: row.reason ?? undefined,
    status: row.status,
    createdAt: d instanceof Date ? d.toISOString() : String(d),
  };
}

export function mapStudent(row: Record<string, unknown>) {
  return {
    id: row.id,
    studentId: row.student_id,
    name: row.name,
    email: row.email ?? undefined,
    grade: row.grade,
    section: row.section,
    schoolId: row.school_id,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    parentEmail: row.parent_email,
    status: row.status,
    gpa: Number(row.gpa),
    attendanceRate: Number(row.attendance_rate),
    medicalInfo: row.medical_info ?? undefined,
    emergencyContact: row.emergency_contact,
    dateOfBirth: row.date_of_birth
      ? (row.date_of_birth instanceof Date
          ? row.date_of_birth.toISOString().split('T')[0]
          : String(row.date_of_birth))
      : undefined,
    academicYear: row.academic_year ?? undefined,
    promotedAt: row.promoted_at ?? undefined,
  };
}

export function mapSchoolClass(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    section: row.section,
    homeroomTeacher: row.homeroom_teacher,
    studentsCount: Number(row.students_count),
  };
}

export function mapLessonPlan(row: Record<string, unknown>) {
  return {
    id: row.id,
    subject: row.subject,
    grade: row.grade,
    title: row.title,
    sessions: Number(row.sessions),
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    status: row.status,
    deptComments: row.dept_comments ?? undefined,
    schoolHeadComments: row.school_head_comments ?? undefined,
    version: Number(row.version),
    objectives: row.objectives ?? [],
    activities: row.activities ?? [],
    assessments: row.assessments ?? [],
    homework: row.homework,
    planType: (row.plan_type as string | null) ?? undefined,
    planDetail: (row.plan_detail as string | null) ?? undefined,
    createdByRole: (row.created_by_role as string | null) ?? undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export function mapAssessment(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    subject: row.subject,
    grade: row.grade,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    status: row.status,
    comments: row.comments ?? undefined,
    difficulty: row.difficulty,
    questions: row.questions ?? [],
    createdByRole: (row.created_by_role as string) || 'teacher',
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export function mapAttendance(row: Record<string, unknown>) {
  const d = row.date;
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    grade: row.grade,
    section: row.section,
    date: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
    status: row.status,
    remarks: row.remarks ?? undefined,
  };
}

export function mapTeacherTraining(row: Record<string, unknown>) {
  const d = row.start_date;
  return {
    id: row.id,
    title: row.title,
    instructor: row.instructor,
    startDate: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
    duration: row.duration,
    completedCount: Number(row.completed_count),
    totalCount: Number(row.total_count),
    status: row.status,
  };
}

export function mapSchoolCheckIn(row: Record<string, unknown>) {
  const d = row.date;
  return {
    id: row.id,
    title: row.title ?? undefined,
    type: row.type,
    respondentName: row.respondent_name,
    rating: Number(row.rating),
    comment: row.comment,
    date: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
  };
}

export function mapExam(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    subject: row.subject,
    grade: row.grade,
    departmentId: row.department_id,
    teacherName: row.teacher_name,
    status: row.status,
    questionsCount: Number(row.questions_count),
    questions: row.questions ?? undefined,
    comments: row.comments ?? undefined,
    createdAt: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
  };
}

export function mapTrainingMaterial(row: Record<string, unknown>) {
  const d = row.uploaded_at;
  return {
    id: row.id,
    title: row.title,
    resourceUrl: row.resource_url,
    category: row.category,
    trainingType: row.training_type ?? undefined,
    departmentId: row.department_id ?? undefined,
    grade: row.grade ?? undefined,
    subject: row.subject ?? undefined,
    disseminated: Boolean(row.disseminated),
    uploadedAt: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
  };
}

export function mapTrainingPlan(row: Record<string, unknown>) {
  const start = row.start_date;
  const end = row.end_date;
  const created = row.created_at;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    type: row.type,
    startDate: start instanceof Date ? start.toISOString().split('T')[0] : String(start),
    endDate: end instanceof Date ? end.toISOString().split('T')[0] : end ?? undefined,
    location: row.location ?? undefined,
    facilitator: row.facilitator ?? undefined,
    status: row.status,
    createdByName: row.created_by_name,
    createdAt: created instanceof Date ? created.toISOString() : String(created),
  };
}

export function mapTrainingPlanAssignment(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    trainingPlanId: row.training_plan_id,
    targetType: row.target_type,
    teacherId: row.teacher_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    assignedByName: row.assigned_by_name,
    createdAt: d instanceof Date ? d.toISOString() : String(d),
  };
}

export function mapAcademicCalendar(row: Record<string, unknown>) {
  const created = row.created_at;
  const published = row.published_at;
  const events = row.events;
  return {
    id: row.id,
    schoolId: row.school_id,
    academicYear: row.academic_year,
    title: row.title,
    moeReference: row.moe_reference ?? undefined,
    quarters: Number(row.quarters),
    quarterBreakWeeks: Number(row.quarter_break_weeks),
    semesterBreakWeeks: Number(row.semester_break_weeks),
    midExamCount: Number(row.mid_exam_count),
    midExamDays: row.mid_exam_days != null ? Number(row.mid_exam_days) : undefined,
    finalExamWeeks: row.final_exam_weeks != null ? Number(row.final_exam_weeks) : undefined,
    events: Array.isArray(events) ? events : typeof events === 'string' ? JSON.parse(events) : [],
    status: row.status,
    createdAt:
      created instanceof Date ? created.toISOString().split('T')[0] : String(created),
    publishedAt: published
      ? published instanceof Date
        ? published.toISOString().split('T')[0]
        : String(published)
      : undefined,
  };
}

export function mapTeachingNote(row: Record<string, unknown>) {
  const created = row.created_at;
  const updated = row.updated_at;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    lessonPlanId: row.lesson_plan_id ?? undefined,
    title: row.title,
    grade: row.grade,
    subject: row.subject,
    topic: row.topic,
    language: row.language,
    contentSummary: row.content_summary,
    contentBody: row.content_body ?? undefined,
    status: row.status,
    deptComments: row.dept_comments ?? undefined,
    createdAt:
      created instanceof Date ? created.toISOString().split('T')[0] : String(created),
    updatedAt: updated
      ? updated instanceof Date
        ? updated.toISOString().split('T')[0]
        : String(updated)
      : undefined,
  };
}

export function mapStudentGradeEntry(row: Record<string, unknown>) {
  const d = row.recorded_at;
  let questionResults = row.question_results;
  if (typeof questionResults === 'string') {
    try {
      questionResults = JSON.parse(questionResults);
    } catch {
      questionResults = undefined;
    }
  }
  return {
    id: row.id,
    studentId: row.student_id,
    teacherId: row.teacher_id,
    subject: row.subject,
    gradeLevel: row.grade_level,
    section: row.section,
    entryType: row.entry_type,
    title: row.title,
    assessmentId: row.assessment_id ?? undefined,
    score: Number(row.score),
    maxScore: Number(row.max_score),
    weight: Number(row.weight),
    term: row.term,
    recordedAt: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
    remarks: row.remarks ?? undefined,
    published: Boolean(row.published),
    questionResults: Array.isArray(questionResults) ? questionResults : undefined,
  };
}

export function mapTeacherResource(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    title: row.title,
    type: row.type,
    grade: row.grade,
    subject: row.subject,
    url: row.url,
    downloads: Number(row.downloads),
    createdAt: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
  };
}

export function mapTeacherFeedback(row: Record<string, unknown>) {
  const d = row.date;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    studentId: row.student_id ?? undefined,
    studentName: row.student_name ?? undefined,
    direction: row.direction,
    authorName: row.author_name,
    subject: row.subject,
    comment: row.comment,
    rating: row.rating != null ? Number(row.rating) : undefined,
    date: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
  };
}

export function mapParentMessage(row: Record<string, unknown>) {
  const d = row.sent_at;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    studentId: row.student_id,
    studentName: row.student_name,
    parentName: row.parent_name,
    message: row.message,
    sentAt: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
  };
}

export function mapTeacherCheckInPrompt(row: Record<string, unknown>) {
  const due = row.due_date;
  const responded = row.responded_at;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    dueDate: due instanceof Date ? due.toISOString().split('T')[0] : String(due),
    teacherResponse: row.teacher_response ?? undefined,
    respondedAt: responded
      ? responded instanceof Date
        ? responded.toISOString().split('T')[0]
        : String(responded)
      : undefined,
  };
}

export function mapNotification(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    timestamp: row.timestamp_label,
    read: Boolean(row.read),
    type: row.type,
    linkPath: (row.link_path as string) || undefined,
  };
}

export function mapLessonDelivery(row: Record<string, unknown>) {
  const d = row.delivered_at;
  return {
    id: row.id,
    teachingNoteId: row.teaching_note_id,
    lessonPlanId: row.lesson_plan_id ?? undefined,
    teacherId: row.teacher_id,
    graspOutcome: row.grasp_outcome,
    challengeText: row.challenge_text ?? undefined,
    postedToHod: Boolean(row.posted_to_hod),
    postedToCommunity: Boolean(row.posted_to_community),
    communityPostId: row.community_post_id ?? undefined,
    deliveredAt:
      d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
  };
}

export function mapCommunityPost(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    departmentId: row.department_id ?? undefined,
    subject: row.subject ?? undefined,
    grade: row.grade ?? undefined,
    title: row.title,
    body: row.body,
    teachingNoteId: row.teaching_note_id ?? undefined,
    lessonPlanId: row.lesson_plan_id ?? undefined,
    createdAt:
      d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
  };
}

export function mapCommunityReply(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    postId: row.post_id,
    parentReplyId: row.parent_reply_id ?? undefined,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    createdAt:
      d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
  };
}

export function mapStaffMessage(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    departmentId: row.department_id ?? undefined,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderRole: row.sender_role,
    body: row.body,
    relatedDeliveryId: row.related_delivery_id ?? undefined,
    relatedPostId: row.related_post_id ?? undefined,
    read: Boolean(row.read),
    createdAt:
      d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
  };
}

/** Discord-style communities: department & school-wide channel chat. */
export function mapCommunity(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    schoolId: row.school_id ?? null,
    name: row.name,
    description: row.description ?? '',
    iconUrl: row.icon_url ?? null,
    type: row.type,
    departmentId: row.department_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
    memberRole: row.member_role ?? undefined,
    unreadCount: row.unread_count !== undefined ? Number(row.unread_count) : undefined,
  };
}

export function mapCommunityMember(row: Record<string, unknown>) {
  const d = row.joined_at;
  return {
    id: row.id,
    communityId: row.community_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
    displayName: row.display_name ?? undefined,
    email: row.email ?? undefined,
    userRole: row.user_role ?? undefined,
  };
}

export function mapCommunityChannel(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    description: row.description ?? '',
    type: row.type,
    position: Number(row.position ?? 0),
    createdAt: d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
    unreadCount: row.unread_count !== undefined ? Number(row.unread_count) : undefined,
  };
}

export function mapCommunityThread(row: Record<string, unknown>, replyCount?: number) {
  const d = row.created_at;
  return {
    id: row.id,
    channelId: row.channel_id,
    title: row.title ?? '',
    createdBy: row.created_by ?? null,
    rootMessageId: row.root_message_id ?? null,
    isPinned: Boolean(row.is_pinned),
    isArchived: Boolean(row.is_archived),
    createdAt: d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
    replyCount,
  };
}

export function mapCommunityMessage(
  row: Record<string, unknown>,
  reactions: { emoji: string; count: number; me: boolean }[] = []
) {
  const d = row.created_at;
  const e = row.edited_at;
  return {
    id: row.id,
    channelId: row.channel_id ?? null,
    threadId: row.thread_id ?? null,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role ?? undefined,
    content: row.content,
    parentMessageId: row.parent_message_id ?? null,
    createdAt: d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
    editedAt: e ? (e instanceof Date ? e.toISOString() : String(e)) : null,
    reactions,
    threadIdForRoot: row.thread_id_for_root ?? undefined,
    threadReplyCount:
      row.thread_reply_count !== undefined ? Number(row.thread_reply_count) : undefined,
  };
}

export function mapHrEmployee(row: Record<string, unknown>) {
  const hire = row.hire_date;
  return {
    id: row.id,
    employeeId: row.employee_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    position: row.position,
    department: row.department,
    employmentType: row.employment_type,
    hireDate: hire instanceof Date ? hire.toISOString().split('T')[0] : String(hire),
    salary: Number(row.salary),
    status: row.status,
    schoolId: row.school_id,
    manager: row.manager ?? undefined,
    emergencyContact: row.emergency_contact ?? undefined,
    teacherId: row.teacher_id ?? undefined,
  };
}

export function mapLeaveRequest(row: Record<string, unknown>) {
  const start = row.start_date;
  const end = row.end_date;
  const submitted = row.submitted_at;
  const reviewed = row.reviewed_at;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    type: row.type,
    startDate: start instanceof Date ? start.toISOString().split('T')[0] : String(start),
    endDate: end instanceof Date ? end.toISOString().split('T')[0] : String(end),
    days: Number(row.days),
    reason: row.reason,
    status: row.status,
    submittedAt: submitted instanceof Date ? submitted.toISOString().split('T')[0] : String(submitted),
    reviewedAt: reviewed
      ? reviewed instanceof Date
        ? reviewed.toISOString().split('T')[0]
        : String(reviewed)
      : undefined,
    reviewerNotes: row.reviewer_notes ?? undefined,
  };
}

export function mapPayrollRecord(row: Record<string, unknown>) {
  const processed = row.processed_at;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    month: row.month,
    baseSalary: Number(row.base_salary),
    allowances: Number(row.allowances),
    deductions: Number(row.deductions),
    netPay: Number(row.net_pay),
    status: row.status,
    processedAt: processed
      ? processed instanceof Date
        ? processed.toISOString().split('T')[0]
        : String(processed)
      : undefined,
  };
}

export function mapJobPosting(row: Record<string, unknown>) {
  const posted = row.posted_at;
  const closing = row.closing_date;
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    employmentType: row.employment_type,
    salaryRange: row.salary_range,
    description: row.description,
    requirements: row.requirements ?? [],
    status: row.status,
    postedAt: posted instanceof Date ? posted.toISOString().split('T')[0] : String(posted),
    closingDate: closing
      ? closing instanceof Date
        ? closing.toISOString().split('T')[0]
        : String(closing)
      : undefined,
    applicantCount: Number(row.applicant_count ?? 0),
  };
}

export function mapJobApplication(row: Record<string, unknown>) {
  const applied = row.applied_at;
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    applicantName: row.applicant_name,
    email: row.email,
    phone: row.phone,
    experience: row.experience,
    education: row.education,
    status: row.status,
    appliedAt: applied instanceof Date ? applied.toISOString().split('T')[0] : String(applied),
    notes: row.notes ?? undefined,
  };
}

export function mapPerformanceReview(row: Record<string, unknown>) {
  const completed = row.completed_at;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    period: row.period,
    rating: Number(row.rating),
    goals: row.goals ?? [],
    strengths: row.strengths,
    improvements: row.improvements,
    status: row.status,
    reviewerName: row.reviewer_name,
    completedAt: completed
      ? completed instanceof Date
        ? completed.toISOString().split('T')[0]
        : String(completed)
      : undefined,
  };
}

export function mapOnboardingTask(row: Record<string, unknown>) {
  const due = row.due_date;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    task: row.task,
    assignee: row.assignee,
    dueDate: due instanceof Date ? due.toISOString().split('T')[0] : String(due),
    completed: Boolean(row.completed),
  };
}

export function mapStaffAttendanceRecord(row: Record<string, unknown>) {
  const d = row.date;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    date: d instanceof Date ? d.toISOString().split('T')[0] : String(d),
    checkIn: row.check_in ?? undefined,
    checkOut: row.check_out ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
  };
}

export function mapMentionNotification(row: Record<string, unknown>) {
  const d = row.created_at;
  return {
    id: row.id,
    userId: row.user_id,
    messageId: row.message_id,
    isRead: Boolean(row.is_read),
    createdAt: d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString()),
    contentPreview: row.content ? String(row.content).slice(0, 140) : undefined,
    authorName: row.author_name ?? undefined,
    channelId: row.channel_id ?? null,
    threadId: row.thread_id ?? null,
    communityId: row.community_id ?? null,
  };
}
