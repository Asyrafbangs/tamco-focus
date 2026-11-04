import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v289 — what the location action sends, and what it says back.
 *
 * The rules live in `esh_add_qr_location` and are proven against a real
 * database in `esh_qr_locations_v289.test.sql`. Two things on this side are
 * worth holding down: that no code is ever sent from here — it is generated
 * in the procedure, because a code derived from an area's name is one anybody
 * who has walked through the building can guess — and that every refusal the
 * procedure can return has a sentence, since a coordinator who is told "try
 * again" about a department they do not cover will try again.
 */

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidated: [] as string[] }));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => state.revalidated.push(path),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: state.rpc }),
}));

import { addQrLocation, retireQrLocation } from '@/server/esh/qr-location-actions';

const DEPARTMENT = 'f0c05100-0000-4000-a000-000000000002';
const LOCATION = 'f0c05300-0000-4000-a000-000000000001';

beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { ok: true, code: 'Zm9vYmFyMTIzNDU2' }, error: null });
  state.revalidated = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v289 adding a location', () => {
  it('sends the label and department, and no code of its own', async () => {
    await addQrLocation({ label: 'BR2 Press line 2', departmentId: DEPARTMENT });

    expect(state.rpc).toHaveBeenCalledWith('esh_add_qr_location', {
      p_label: 'BR2 Press line 2',
      p_department_id: DEPARTMENT,
    });
    // Nothing resembling a code is sent: the procedure generates it.
    const sent = state.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['p_label', 'p_department_id']);
  });

  it('trims the label rather than storing the spaces somebody typed', async () => {
    await addQrLocation({ label: '  BR1 Main gate  ', departmentId: null });

    expect(state.rpc).toHaveBeenCalledWith('esh_add_qr_location', {
      p_label: 'BR1 Main gate',
      p_department_id: null,
    });
  });

  it('refuses an empty label without asking the database', async () => {
    const result = await addQrLocation({ label: '   ', departmentId: null });

    expect(result.ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('hands back the generated code so the sticker can be printed', async () => {
    const result = await addQrLocation({ label: 'BR2 Press line 2', departmentId: null });

    expect(result).toEqual({ ok: true, code: 'Zm9vYmFyMTIzNDU2' });
    expect(state.revalidated).toEqual(['/findings/settings']);
  });

  it('refreshes nothing when the location was refused', async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, code: 'not_permitted' }, error: null });

    await addQrLocation({ label: 'BR2 Press line 2', departmentId: null });

    expect(state.revalidated).toEqual([]);
  });
});

describe('v289 retiring one', () => {
  it('sends the location and nothing else', async () => {
    state.rpc.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await retireQrLocation({ id: LOCATION });

    expect(result).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith('esh_retire_qr_location', { p_location_id: LOCATION });
  });

  it('refuses an id that is not one, without asking the database', async () => {
    const result = await retireQrLocation({ id: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('v289 what it says back', () => {
  const cases: Array<[string, RegExp]> = [
    ['not_permitted', /coordinator/i],
    ['label_required', /where the sticker goes/i],
    ['department_not_yours', /not one you cover/i],
    ['not_found', /no longer exists/i],
  ];

  for (const [code, expected] of cases) {
    it(`turns ${code} into something a coordinator can act on`, async () => {
      state.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });

      const result = await addQrLocation({ label: 'Somewhere', departmentId: null });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toMatch(expected);
    });
  }

  it('does not claim to know why when the call itself failed', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST000', message: 'upstream' } });

    const result = await addQrLocation({ label: 'Somewhere', departmentId: null });

    expect(result.ok === false && result.message).toMatch(/could not be saved/i);
  });
});
