import { query } from '../db/pool.js';
import { newId } from '../lib/ids.js';

export type RegistrationFormField = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
};

function slugifyCode(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export interface RegistrationFormTemplate {
  id: string;
  schoolId: string;
  name: string;
  description: string;
  code: string;
  fields: RegistrationFormField[];
  requiredDocuments: string[];
  active: boolean;
  createdBy?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export function mapRegistrationFormTemplate(row: Record<string, unknown>): RegistrationFormTemplate {
  return {
    id: row.id as string,
    schoolId: row.school_id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    code: row.code as string,
    fields: (row.fields as RegistrationFormField[]) ?? [],
    requiredDocuments: (row.required_documents as string[]) ?? [],
    active: row.active as boolean,
    createdBy: (row.created_by as string) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRegistrationFormTemplates(schoolId: string) {
  const { rows } = await query(
    `SELECT * FROM registration_form_templates WHERE school_id = $1 ORDER BY created_at DESC`,
    [schoolId]
  );
  return rows.map(mapRegistrationFormTemplate);
}

export async function getRegistrationFormTemplateById(id: string) {
  const { rows } = await query(`SELECT * FROM registration_form_templates WHERE id = $1`, [id]);
  return rows[0] ? mapRegistrationFormTemplate(rows[0]) : null;
}

export async function getRegistrationFormTemplateByCode(code: string) {
  const { rows } = await query(`SELECT * FROM registration_form_templates WHERE code = $1 AND active = TRUE`, [
    code,
  ]);
  return rows[0] ? mapRegistrationFormTemplate(rows[0]) : null;
}

export async function createRegistrationFormTemplate(input: {
  schoolId: string;
  name: string;
  description?: string;
  fields: RegistrationFormField[];
  requiredDocuments: string[];
  createdBy?: string | null;
}) {
  if (!input.name?.trim()) {
    throw Object.assign(new Error('Form name is required'), { status: 400 });
  }
  const id = newId('rform');
  let code = slugifyCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await query(`SELECT 1 FROM registration_form_templates WHERE code = $1`, [code]);
    if (!existing.rows[0]) break;
    code = slugifyCode();
  }
  await query(
    `INSERT INTO registration_form_templates
       (id, school_id, name, description, code, fields, required_documents, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)`,
    [
      id,
      input.schoolId,
      input.name.trim(),
      input.description ?? '',
      code,
      JSON.stringify(input.fields ?? []),
      JSON.stringify(input.requiredDocuments ?? []),
      input.createdBy ?? null,
    ]
  );
  return getRegistrationFormTemplateById(id);
}

export async function updateRegistrationFormTemplate(
  id: string,
  updates: {
    name?: string;
    description?: string;
    fields?: RegistrationFormField[];
    requiredDocuments?: string[];
    active?: boolean;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) {
    values.push(updates.name.trim());
    fields.push(`name = $${values.length}`);
  }
  if (updates.description !== undefined) {
    values.push(updates.description);
    fields.push(`description = $${values.length}`);
  }
  if (updates.fields !== undefined) {
    values.push(JSON.stringify(updates.fields));
    fields.push(`fields = $${values.length}`);
  }
  if (updates.requiredDocuments !== undefined) {
    values.push(JSON.stringify(updates.requiredDocuments));
    fields.push(`required_documents = $${values.length}`);
  }
  if (updates.active !== undefined) {
    values.push(updates.active);
    fields.push(`active = $${values.length}`);
  }
  if (!fields.length) return getRegistrationFormTemplateById(id);
  values.push(id);
  await query(
    `UPDATE registration_form_templates SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
    values
  );
  return getRegistrationFormTemplateById(id);
}
