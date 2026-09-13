/**
 * Every row a query can return, a thousand at a time (v175).
 *
 * The API hands back at most `max_rows` (1,000) rows to a request, and says
 * nothing when it stops. Lists of people had been written with `.limit(200)` or
 * `.limit(500)` instead — sizes that were comfortable for a seeded fixture of
 * eight and quietly wrong for a workforce of six hundred: the Directory stopped
 * at the five-hundredth name, and the assignment pickers at the two-hundredth,
 * so somebody called Zulkifli could not be given work.
 *
 * The page callback must order by something unique (a name, then the id), or
 * a row can slip between two pages.
 */

export const API_PAGE_SIZE = 1000;

interface PageResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

export async function readAll<Row>(
  page: (from: number, to: number) => PromiseLike<PageResult<Row>>,
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += API_PAGE_SIZE) {
    const { data, error } = await page(from, from + API_PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const received = data ?? [];
    rows.push(...received);
    if (received.length < API_PAGE_SIZE) return { data: rows, error: null };
  }
}
