#!/usr/bin/env node
/**
 * Non-destructive local fixture backfill for developers who already applied
 * the v30 seed before the additive v33 migrations arrived. A normal
 * `supabase db reset` gets the same fixtures from `supabase/seed.sql`; this
 * helper only avoids wiping an existing local database during change intake.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Local Supabase environment values are missing.');

const client = createClient(url, serviceKey, { auth: { persistSession: false } });
const ids = {
  goal: 'f0c06000-0000-4000-a000-000000000001',
  version: 'f0c06100-0000-4000-a000-000000000001',
  owner: 'f0c05000-0000-4000-a000-000000000003',
  manager: 'f0c05000-0000-4000-a000-000000000002',
  update: 'f0c06400-0000-4000-a000-000000000001',
  support: 'f0c06500-0000-4000-a000-000000000001',
  link: 'f0c06600-0000-4000-a000-000000000001',
  task: 'f0c05300-0000-4000-a000-000000000008',
  coachingGoal: 'f0c06000-0000-4000-a000-000000000002',
  coachingVersion: 'f0c06100-0000-4000-a000-000000000002',
  coachingOwner: 'f0c05000-0000-4000-a000-000000000004',
};
const now = Date.now();
const isoDays = (days) => new Date(now + days * 86_400_000).toISOString();
const dateDays = (days) => isoDays(days).slice(0, 10);

function assert(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const existing = await client.from('goals').select('id').eq('id', ids.goal).maybeSingle();
assert(existing, 'Read Goal fixture');
if (!existing.data) {
  assert(
    await client.from('goals').insert({
      id: ids.goal,
      owner_id: ids.owner,
      manager_id: ids.manager,
      created_by: ids.manager,
      title: 'Safety Digitalisation',
      category: 'improvement',
      status: 'active',
      health: 'support_requested',
      reported_progress: 20,
      target_date: dateDays(150),
      weight_percent: 10,
      checkin_due_at: isoDays(-1),
      last_meaningful_update_at: isoDays(-21),
      agreed_at: isoDays(-90),
      created_at: isoDays(-100),
    }),
    'Insert Goal fixture',
  );
}

assert(
  await client.from('goal_versions').upsert({
    id: ids.version,
    goal_id: ids.goal,
    version_number: 1,
    status: 'active',
    title: 'Safety Digitalisation',
    expected_result:
      'Use a practical digital or AI solution to remove recurring manual safety coordination work.',
    success_measure:
      'A working prototype is tested with users and its results, lessons and next actions are recorded.',
    employee_approach:
      'Start from repeated coordination pain points, prototype the smallest useful workflow, and test it with the people doing the work.',
    support_agreed:
      'Fortnightly coaching, access to users, and a decision on an approved pilot tool.',
    dependencies: 'Availability of Operations users and access to non-sensitive example data.',
    baseline:
      'Recurring observations, reminders, and follow-ups are currently tracked across spreadsheets and messages.',
    purpose: 'Reduce avoidable administration so safety time is spent on prevention and coaching.',
    target_date: dateDays(150),
    weight_percent: 10,
    proposed_by: ids.manager,
    proposed_at: isoDays(-100),
    activated_at: isoDays(-90),
  }),
  'Upsert Goal version',
);

assert(
  await client.from('goals').update({ active_version_id: ids.version }).eq('id', ids.goal),
  'Connect active Goal version',
);
assert(
  await client.from('goal_participants').upsert([
    { goal_id: ids.goal, user_id: ids.owner, participant_role: 'employee', added_by: ids.manager },
    { goal_id: ids.goal, user_id: ids.manager, participant_role: 'manager', added_by: ids.manager },
  ]),
  'Upsert Goal participants',
);

const milestoneRows = [
  [
    'Identify recurring operational issues that could be solved digitally',
    'A prioritised problem statement is agreed with the people who perform the work.',
    60,
  ],
  [
    'Select a suitable digital or AI tool',
    'A tool is selected against data, access, usability, and support constraints.',
    25,
  ],
  [
    'Develop a working prototype',
    'The smallest end-to-end workflow can be demonstrated using non-sensitive data.',
    10,
  ],
  [
    'Test the solution with users',
    'At least three intended users complete the core workflow and their feedback is recorded.',
    0,
  ],
  [
    'Record results, lessons learned, and next actions',
    'The outcome, lessons, ownership, and recommendation are documented and discussed.',
    0,
  ],
].map(([title, completion_definition, progress_percent], index) => ({
  id: `f0c06200-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
  goal_version_id: ids.version,
  position: index + 1,
  title,
  completion_definition,
  weight_percent: 20,
  progress_percent,
  last_update_at: isoDays(index < 3 ? -21 : -90),
}));
assert(await client.from('goal_milestones').upsert(milestoneRows), 'Upsert Goal milestones');

assert(
  await client.from('goal_agreements').upsert({
    id: 'f0c06300-0000-4000-a000-000000000001',
    goal_id: ids.goal,
    goal_version_id: ids.version,
    employee_id: ids.owner,
    manager_id: ids.manager,
    agreed_by: ids.manager,
    agreed_at: isoDays(-90),
    detail: { mode: 'manager_employee_discussion' },
  }),
  'Upsert Goal agreement',
);
assert(
  await client.from('goal_updates').upsert({
    id: ids.update,
    goal_id: ids.goal,
    goal_version_id: ids.version,
    author_id: ids.owner,
    previous_reported_progress: 15,
    new_reported_progress: 20,
    what_changed:
      'Compared two suitable tools and built the first prototype flow with sample inspection data.',
    next_step: 'Confirm which platform can be used for the user pilot.',
    support_requested: true,
    support_details:
      'Please confirm the approved pilot platform and arrange access to three Operations users.',
    created_at: isoDays(-21),
  }),
  'Upsert Goal update',
);
assert(
  await client.from('goal_support_requests').upsert({
    id: ids.support,
    goal_id: ids.goal,
    goal_update_id: ids.update,
    requested_by: ids.owner,
    manager_id: ids.manager,
    details:
      'Please confirm the approved pilot platform and arrange access to three Operations users.',
    status: 'open',
    created_at: isoDays(-21),
  }),
  'Upsert Goal support request',
);
assert(
  await client.from('goal_work_links').upsert({
    id: ids.link,
    goal_id: ids.goal,
    milestone_id: milestoneRows[3].id,
    task_id: ids.task,
    linked_by: ids.owner,
    created_at: isoDays(-12),
  }),
  'Upsert linked Goal work',
);

const coachingExisting = await client
  .from('goals')
  .select('id')
  .eq('id', ids.coachingGoal)
  .maybeSingle();
assert(coachingExisting, 'Read coaching Goal fixture');
if (!coachingExisting.data) {
  assert(
    await client.from('goals').insert({
      id: ids.coachingGoal,
      owner_id: ids.coachingOwner,
      manager_id: ids.manager,
      created_by: ids.manager,
      title: 'Strengthen frontline safety coaching',
      category: 'development',
      status: 'active',
      health: 'on_track',
      reported_progress: 25,
      target_date: dateDays(120),
      weight_percent: 25,
      checkin_due_at: isoDays(14),
      last_meaningful_update_at: isoDays(-4),
      agreed_at: isoDays(-70),
      created_at: isoDays(-75),
    }),
    'Insert coaching Goal fixture',
  );
}

assert(
  await client.from('goal_versions').upsert({
    id: ids.coachingVersion,
    goal_id: ids.coachingGoal,
    version_number: 1,
    status: 'active',
    title: 'Strengthen frontline safety coaching',
    expected_result: 'Establish a repeatable coaching rhythm with line supervisors.',
    success_measure:
      'Each supervisor receives two observed coaching sessions and can run the conversation without assistance.',
    employee_approach:
      'Use real walk findings as short practice scenarios and reflect after each session.',
    support_agreed: 'Protected time with supervisors and feedback after observed sessions.',
    dependencies: 'Shift coverage during the scheduled sessions.',
    baseline: 'Coaching currently happens informally and is not consistent between shifts.',
    purpose: 'Build confident frontline ownership of everyday safety conversations.',
    target_date: dateDays(120),
    weight_percent: 25,
    proposed_by: ids.manager,
    proposed_at: isoDays(-75),
    activated_at: isoDays(-70),
  }),
  'Upsert coaching Goal version',
);
assert(
  await client
    .from('goals')
    .update({ active_version_id: ids.coachingVersion })
    .eq('id', ids.coachingGoal),
  'Connect coaching Goal version',
);
assert(
  await client.from('goal_participants').upsert([
    {
      goal_id: ids.coachingGoal,
      user_id: ids.coachingOwner,
      participant_role: 'employee',
      added_by: ids.manager,
    },
    {
      goal_id: ids.coachingGoal,
      user_id: ids.manager,
      participant_role: 'manager',
      added_by: ids.manager,
    },
  ]),
  'Upsert coaching Goal participants',
);

const coachingMilestones = [
  [
    'Agree the coaching standard',
    'The expected coaching behaviours and observation form are agreed.',
    40,
    40,
  ],
  [
    'Run observed coaching sessions',
    'Every line supervisor completes two observed sessions.',
    35,
    20,
  ],
  [
    'Review confidence and consistency',
    'A follow-up review confirms the coaching rhythm can continue without project support.',
    25,
    0,
  ],
].map(([title, completion_definition, weight_percent, progress_percent], index) => ({
  id: `f0c06200-0000-4000-a000-${String(index + 6).padStart(12, '0')}`,
  goal_version_id: ids.coachingVersion,
  position: index + 1,
  title,
  completion_definition,
  weight_percent,
  progress_percent,
  last_update_at: isoDays(index === 1 ? -4 : index === 0 ? -9 : -70),
}));
assert(
  await client.from('goal_milestones').upsert(coachingMilestones),
  'Upsert coaching Goal milestones',
);
assert(
  await client.from('goal_agreements').upsert({
    id: 'f0c06300-0000-4000-a000-000000000002',
    goal_id: ids.coachingGoal,
    goal_version_id: ids.coachingVersion,
    employee_id: ids.coachingOwner,
    manager_id: ids.manager,
    agreed_by: ids.manager,
    agreed_at: isoDays(-70),
    detail: { mode: 'manager_employee_discussion' },
  }),
  'Upsert coaching Goal agreement',
);
assert(
  await client.from('goal_updates').upsert({
    id: 'f0c06400-0000-4000-a000-000000000002',
    goal_id: ids.coachingGoal,
    goal_version_id: ids.coachingVersion,
    author_id: ids.coachingOwner,
    previous_reported_progress: 20,
    new_reported_progress: 25,
    what_changed:
      'Completed the first observed session and incorporated feedback into the prompt card.',
    next_step: 'Schedule the remaining supervisors across both shifts.',
    support_requested: false,
    created_at: isoDays(-4),
  }),
  'Upsert coaching Goal update',
);

console.log('ok  v33 Goal fixtures are ready in local Supabase.');
