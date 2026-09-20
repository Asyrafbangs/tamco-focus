import { csvDocument } from '@/domain/esh-overview';
import { requireEshAccess } from '@/server/esh/access';
import { listRegisterExportRows } from '@/server/esh/queries';

const HEADERS = [
  'Finding reference',
  'Finding title',
  'Before description',
  'Location',
  'Accountable department',
  'Finding status',
  'Risk level',
  'Reported on',
  'Action number',
  'Action title',
  'Required outcome',
  'Action owner',
  'Action state',
  'Priority',
  'Baseline due',
  'Current due',
  'After description',
  'Submitted at',
  'Verified at',
  'Closed at',
  'Escalation state',
  'Escalation recipients',
  'Active escalations',
] as const;

/** Authorized CSV only; private evidence remains behind its normal short-lived route. */
export async function GET() {
  try {
    await requireEshAccess();
  } catch {
    return new Response('Not found', { status: 404 });
  }

  try {
    const rows = await listRegisterExportRows();
    const body = csvDocument(
      HEADERS,
      rows.map((row) => [
        row.reference,
        row.finding_title,
        row.before_description,
        row.location,
        row.accountable_department ?? 'Unassigned',
        row.finding_status,
        row.risk_level,
        row.reported_on,
        row.action_sequence,
        row.action_title,
        row.required_outcome,
        row.owner_email,
        row.action_state,
        row.priority,
        row.baseline_due_at,
        row.current_due_at,
        row.after_description,
        row.submitted_at,
        row.verified_at,
        row.closed_at,
        row.escalation_state,
        row.escalation_recipients,
        row.active_escalations,
      ]),
    );
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(
      new Date(),
    );
    return new Response(`\uFEFF${body}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="finding-register-${day}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[finding export]', error);
    return new Response('The finding register could not be exported.', { status: 500 });
  }
}
