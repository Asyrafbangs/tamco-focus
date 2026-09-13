import { writeOrganisationFile } from '@/domain/organisation-import';
import { orgConfig } from '@/lib/env';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

/**
 * The organisation as a file (v174): the starting point for an import.
 *
 * One row per active person, in exactly the columns the import reads, so the
 * way to reorganise is to download this, change it in a spreadsheet, and bring
 * it back — and a file brought back unchanged changes nobody.
 *
 * Administrators only, and indistinguishable from a missing page for anybody
 * else, as the attachment route is.
 */

const PAGE = 1000;

interface ProfileRow {
  id: string;
  employee_id: string;
  full_name: string;
  email: string;
  department_id: string | null;
  job_title: string | null;
  reporting_manager_id: string | null;
  functional_manager_id: string | null;
  status: string;
}

export async function GET() {
  try {
    const profile = await requireProfile();
    if (profile.role !== 'administrator') return new Response('Not found', { status: 404 });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const supabase = await createSupabaseServerClient();

  // Paged, because the API returns at most a thousand rows to a request and an
  // organisation file that silently stopped at a thousand people would import
  // as if the rest did not exist.
  const people: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select(
        'id,employee_id,full_name,email,department_id,job_title,reporting_manager_id,functional_manager_id,status',
      )
      .order('employee_id')
      .range(from, from + PAGE - 1);
    if (error) return new Response('The organisation could not be exported.', { status: 500 });
    people.push(...((data ?? []) as ProfileRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  const { data: departments, error: departmentsError } = await supabase
    .from('departments')
    .select('id,code');
  if (departmentsError) {
    return new Response('The organisation could not be exported.', { status: 500 });
  }

  const codeOf = new Map((departments ?? []).map((row) => [row.id as string, row.code as string]));
  // Everybody, active or not, so a line still pointing at somebody who has left
  // is exported as it is — and the import then says so, which is the point.
  const employeeIdOf = new Map(people.map((person) => [person.id, person.employee_id]));
  const lookup = (map: Map<string, string>, id: string | null) => (id ? (map.get(id) ?? '') : '');

  const body = writeOrganisationFile(
    people
      .filter((person) => person.status === 'active')
      .map((person) => ({
        employee_id: person.employee_id,
        name: person.full_name,
        email: person.email,
        department_code: lookup(codeOf, person.department_id),
        job_title: person.job_title ?? '',
        manager_employee_id: lookup(employeeIdOf, person.reporting_manager_id),
        functional_manager_employee_id: lookup(employeeIdOf, person.functional_manager_id),
      })),
  );

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: orgConfig.timeZone }).format(
    new Date(),
  );

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="organisation-${today}.csv"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
