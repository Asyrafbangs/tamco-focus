import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

describe('v203 identity and access administration', () => {
  it('separates platform administration from module business access', async () => {
    const amer = await signInAs('amer');
    const denied = await amer.rpc('set_person_module_access', {
      p_user_id: PEOPLE.ajmal.id,
      p_focus_preset: 'manager',
      p_platform_administrator: false,
      p_reason: 'v203 unauthorized probe',
    });
    expect(denied.error).toBeNull();
    expect(denied.data).toMatchObject({ ok: false, code: 'not_permitted' });

    const admin = await signInAs('admin');
    const saved = await admin.rpc('set_person_module_access', {
      p_user_id: PEOPLE.admin.id,
      p_focus_preset: 'manager',
      p_platform_administrator: true,
      p_reason: 'v203 integration review',
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({
      ok: true,
      focus_preset: 'manager',
      platform_administrator: true,
    });

    const findingRows = await admin.from('esh_findings').select('id');
    expect(findingRows.error).toBeNull();
    expect(findingRows.data).toEqual([]);
  });

  it('corrects a contact without merging identity or rewriting history', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const oldEmail = `wrong.${suffix}@example.com`;
    const newEmail = `correct.${suffix}@example.com`;
    const izzul = await signInAs('izzul');
    const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
    const saved = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title: `v203 identity ${suffix}`,
        description: 'Contact correction integration fixture.',
        reported_on: '2026-09-20',
        accountable_department_id: departments?.[0]?.id,
        required_outcome: 'Correct the condition.',
        priority: 'normal',
        owner_email: oldEmail,
        due_date: '2026-12-01',
        escalation: [],
        no_further_escalation_reason: 'Integration fixture.',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ ok: true });

    const service = serviceClient();
    const { data: oldContact } = await service
      .from('esh_email_principals')
      .select('id, organization_id')
      .eq('canonical_email', oldEmail)
      .single();
    expect(oldContact).toBeTruthy();
    await service.from('esh_action_messages').insert({
      organization_id: oldContact!.organization_id,
      action_id: saved.data.action_id,
      author_kind: 'owner',
      author_principal_id: oldContact!.id,
      author_email: oldEmail,
      body: 'Keep this attribution.',
      client_key: `v203-${suffix}`,
    });

    const admin = await signInAs('admin');
    const enabled = await admin.rpc('esh_set_contact_access', {
      p_principal_id: oldContact!.id,
      p_enabled: true,
      p_reason: 'v203 integration enable',
    });
    expect(enabled.data).toMatchObject({ ok: true });

    const contacts = await admin.rpc('esh_admin_contacts', { p_search: suffix });
    expect(contacts.error).toBeNull();
    expect(contacts.data).toHaveLength(1);
    expect(contacts.data?.[0]).toMatchObject({ open_actions: 1, configured_escalations: 0 });

    // Administration sees identity metadata, but not scoped Finding titles.
    const hiddenRelationships = await admin
      .from('esh_admin_contact_relationships')
      .select('action_id')
      .eq('principal_id', oldContact!.id);
    expect(hiddenRelationships.error).toBeNull();
    expect(hiddenRelationships.data).toEqual([]);

    const correction = await admin.rpc('esh_admin_correct_contact_email', {
      p_principal_id: oldContact!.id,
      p_new_email: newEmail,
      p_transfer_actions: true,
      p_transfer_escalations: false,
      p_reason: 'Typographical error',
    });
    expect(correction.error).toBeNull();
    expect(correction.data).toMatchObject({ ok: true, moved_actions: 1 });
    const newPrincipalId = correction.data.new_principal_id as string;

    const [{ data: action }, { data: message }, { data: oldIdentity }, { data: newIdentity }] =
      await Promise.all([
        service
          .from('esh_finding_actions')
          .select('owner_principal_id, assignment_version')
          .eq('id', saved.data.action_id)
          .single(),
        service
          .from('esh_action_messages')
          .select('author_principal_id, author_email')
          .eq('client_key', `v203-${suffix}`)
          .single(),
        service
          .from('esh_email_principals')
          .select('status, access_enabled')
          .eq('id', oldContact!.id)
          .single(),
        service
          .from('esh_email_principals')
          .select('canonical_email, access_enabled')
          .eq('id', newPrincipalId)
          .single(),
      ]);
    expect(action).toMatchObject({ owner_principal_id: newPrincipalId, assignment_version: 2 });
    expect(message).toEqual({ author_principal_id: oldContact!.id, author_email: oldEmail });
    expect(oldIdentity).toEqual({ status: 'disabled', access_enabled: false });
    expect(newIdentity).toEqual({ canonical_email: newEmail, access_enabled: true });
  });
});
