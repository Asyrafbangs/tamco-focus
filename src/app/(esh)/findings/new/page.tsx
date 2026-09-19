import Link from 'next/link';

import { FindingForm } from '@/components/esh/FindingForm';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import { getDepartmentsInScope, getVerifiers } from '@/server/esh/queries';

/** New finding (§7, screen 04). Coordinators and Verifiers only. */
export default async function NewFindingPage() {
  const access = await requireEshAccess('coordinate');
  const profile = await requireProfile();
  const [departments, verifiers] = await Promise.all([
    getDepartmentsInScope(access),
    getVerifiers(),
  ]);
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
          <p>Record the issue and assign a clear corrective outcome.</p>
        </div>
      </div>
      <FindingForm
        departments={departments}
        verifiers={verifiers}
        initial={{
          findingId: null,
          reference: null,
          title: '',
          description: '',
          source: 'esh_inspection',
          sourceReference: '',
          reportedOn: today,
          location: '',
          departmentId: departments.length === 1 ? (departments[0]?.id ?? '') : '',
          riskLevel: 'not_assessed',
          isRestricted: false,
          requiredOutcome: '',
          evidenceInstruction: 'Photo showing the corrected condition.',
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
