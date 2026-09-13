import { describe, expect, it } from 'vitest';

import { directTeamFirst } from '@/domain/people-order';
import { API_PAGE_SIZE, readAll } from '@/lib/read-all';

/**
 * v175 — people lists that reach everybody, with your own team first.
 *
 * The paging is tested against a fake API that behaves as the real one does —
 * never more than a thousand rows to a request, and no word when it stops —
 * because a seeded database of eight people cannot tell a list that pages from
 * one that was capped at two hundred.
 */

function fakeApi(total: number, failAt?: number) {
  const requests: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    requests.push([from, to]);
    if (failAt !== undefined && from >= failAt) {
      return { data: null, error: { message: 'boom' } };
    }
    const end = Math.min(to + 1, total, from + API_PAGE_SIZE);
    const data = Array.from({ length: Math.max(0, end - from) }, (_, index) => ({
      id: `person-${from + index}`,
    }));
    return { data, error: null };
  };
  return { page, requests };
}

describe('readAll', () => {
  it('reads past the thousand rows one request returns', async () => {
    const api = fakeApi(2005);
    const { data, error } = await readAll(api.page);
    expect(error).toBeNull();
    expect(data).toHaveLength(2005);
    expect(new Set(data.map((row) => row.id)).size).toBe(2005);
    expect(api.requests).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks once more after an exactly full page, and stops on the empty one', async () => {
    const api = fakeApi(1000);
    const { data } = await readAll(api.page);
    expect(data).toHaveLength(1000);
    expect(api.requests).toHaveLength(2);
  });

  it('asks once for a short list', async () => {
    const api = fakeApi(8);
    const { data } = await readAll(api.page);
    expect(data).toHaveLength(8);
    expect(api.requests).toHaveLength(1);
  });

  it('reports a failure rather than returning a short list as if it were whole', async () => {
    const api = fakeApi(2500, 1000);
    const { data, error } = await readAll(api.page);
    expect(error?.message).toBe('boom');
    expect(data).toHaveLength(1000);
  });
});

describe('directTeamFirst', () => {
  it('puts the people who report to you first, keeping each group in its order', () => {
    const people = [
      { id: 'a', name: 'Aisyah', directReport: false },
      { id: 'b', name: 'Bala', directReport: true },
      { id: 'c', name: 'Chong', directReport: false },
      { id: 'd', name: 'Dewi', directReport: true },
    ];
    const { team, everyoneElse } = directTeamFirst(people);
    expect(team.map((person) => person.name)).toEqual(['Bala', 'Dewi']);
    expect(everyoneElse.map((person) => person.name)).toEqual(['Aisyah', 'Chong']);
  });

  it('leaves nobody out', () => {
    const people = [{ id: 'a', directReport: false }];
    const { team, everyoneElse } = directTeamFirst(people);
    expect(team).toEqual([]);
    expect(everyoneElse).toEqual(people);
  });
});
