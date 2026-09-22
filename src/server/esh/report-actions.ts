'use server';

import { revalidatePath } from 'next/cache';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getEshAccess } from '@/server/esh/access';

export interface ReportFormState {
  ok: boolean;
  message: string;
}

function values(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function saveReportDefinition(
  _previous: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const access = await getEshAccess();
  if (!access.enabled || !access.canManageReports) {
    return { ok: false, message: 'You do not have report-management access.' };
  }
  const supabase = await createSupabaseServerClient();
  const recipientEmails = String(formData.get('recipient_emails') ?? '')
    .split(/[\n,;]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const id = String(formData.get('id') ?? '').trim() || null;
  const { data, error } = await supabase.rpc('esh_save_report_definition', {
    p_id: id,
    p_name: String(formData.get('name') ?? ''),
    p_state: String(formData.get('state') ?? 'draft'),
    p_timezone: String(formData.get('timezone') ?? 'Asia/Kuala_Lumpur'),
    p_schedule_isodow: Number(formData.get('schedule_isodow') ?? 1),
    p_schedule_local_time: String(formData.get('schedule_local_time') ?? '08:30'),
    p_organization_wide: formData.get('organization_wide') === 'on',
    p_include_descendants: formData.get('include_descendants') === 'on',
    p_department_ids: values(formData, 'department_ids'),
    p_recipient_emails: recipientEmails,
  });
  if (error) {
    console.error(`[saveReportDefinition] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false, message: 'The report could not be saved.' };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    const messages: Record<string, string> = {
      department_required: 'Choose at least one department, or select the whole organisation.',
      recipient_required: 'An active report needs at least one recipient.',
      recipient_invalid: 'One of the recipient email addresses is not valid.',
      name_exists: 'A report with that name already exists.',
      invalid: 'Check the name, schedule and timezone.',
    };
    return { ok: false, message: messages[result.code ?? ''] ?? 'The report could not be saved.' };
  }
  revalidatePath('/findings/settings');
  return { ok: true, message: 'Weekly report saved.' };
}
