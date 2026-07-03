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
  };
}
