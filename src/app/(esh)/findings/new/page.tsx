import Link from 'next/link';

import { FindingForm } from '@/components/esh/FindingForm';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDepartmentsInScope,
  getFollowupSettings,
  getVerifiers,
  getReportIntakeForFinding,
  listDepartmentEscalationDefaults,
} from '@/server/esh/queries';

/** New finding (§7, screen 04). Coordinators and Verifiers only. */
export default async function NewFindingPage({
  searchParams,
}: {
  searchParams: Promise<{ intake?: string }>;
}) {
  const access = await requireEshAccess('coordinate');
  const profile = await requireProfile();
  const params = await searchParams;
  const intakeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    params.intake ?? '',
  )
    ? params.intake!
    : null;
  const [departments, verifiers, followup, routes, intake] = await Promise.all([
    getDepartmentsInScope(access),
    getVerifiers(),
    // v215 - so each escalation level can say when it is actually told.
    getFollowupSettings(),
    // v223 - the route each department normally uses, offered on choosing it.
    listDepartmentEscalationDefaults(),
    intakeId ? getReportIntakeForFinding(intakeId) : Promise.resolve({ row: null, failed: false }),
  ]);
  const departmentRoutes = Object.fromEntries(
    routes.map((route) => [
      route.departmentId,
      route.levels.reduce<Record<number, string[]>>((byLevel, entry) => {
        byLevel[entry.level] = [...(byLevel[entry.level] ?? []), entry.email];
        return byLevel;
      }, {}),
    ]),
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone ?? 'Asia/Kuala_Lumpur',
  }).format(new Date());

  return (
    <>
      <Link href="/findings/register" className="esh-back-link">
        ← Finding Register
      </Link>
      <div className="pagehead">
        <div>
          <h1>New finding</h1>
          <p>
            {intake.row
              ? 'Review the private report, then create and optionally assign its corrective action.'
              : 'Record the issue and assign a clear corrective outcome.'}
          </p>
        </div>
      </div>
      {intake.row && (
        <p className="notice">
          This Finding will preserve a private-intake audit link. The report has not created an
          owner action yet.
        </p>
      )}
      {intakeId && !intake.row && (
        <p className="notice error" role="alert">
          That private report is no longer available for review. Nothing has been created.
        </p>
      )}
      <FindingForm
        departments={departments}
        canAddDepartment={profile.role === 'administrator'}
        verifiers={verifiers}
        levelDays={followup?.levelDays ?? []}
        departmentRoutes={departmentRoutes}
        initial={{
          findingId: null,
          intakeId: intake.row?.id ?? null,
          reference: null,
          title: '',
          description: intake.row?.reportText ?? '',
          source: 'esh_inspection',
          sourceReference: '',
          reportedOn: intake.row
            ? new Intl.DateTimeFormat('en-CA', {
                timeZone: profile.timezone ?? 'Asia/Kuala_Lumpur',
              }).format(new Date(intake.row.receivedAt))
            : today,
          location: intake.row?.reportedLocation ?? '',
          departmentId:
            intake.row?.departmentId ??
            (departments.length === 1 ? (departments[0]?.id ?? '') : ''),
          riskLevel: 'not_assessed',
          isRestricted: false,
          requiredOutcome: '',
          evidenceInstruction: 'Photo showing the corrected condition.',
          evidenceKind: '',
          priority: '',
          ownerEmail: '',
          dueDate: '',
          dueTime: '',
          reviewerUserId: '',
          escalation: {},
          noFurtherEscalationReason: '',
        }}
      />
    </>
  );
}
