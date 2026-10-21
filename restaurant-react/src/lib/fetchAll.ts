// Supabase (PostgREST) returns at most 1000 rows per request, and long `.in()` lists overflow the URL.
// These helpers load complete result sets and throw on error so callers can show it.

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>

const PAGE_SIZE = 1000

/**
 * Loads every page of a query.
 * `build(from, to)` must create a NEW query on each call and end with `.range(from, to)`.
 * Order by a unique key (e.g. `.order('created_at').order('id')`) so pages never overlap or skip rows.
 *
 * @example
 * const items = await fetchAll((from, to) =>
 *   supabase.from('items').select('*').order('id').range(from, to))
 */
export async function fetchAll<T>(build: (from: number, to: number) => QueryResult<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/**
 * Runs an `.in(column, ids)` query in chunks of 200 IDs (each chunk fully paged) and concatenates the rows.
 *
 * @example
 * const lines = await fetchByIds(orderIds, (ids, from, to) =>
 *   supabase.from('order_items').select('*').in('order_id', ids).order('id').range(from, to))
 */
export async function fetchByIds<T>(
  ids: string[],
  build: (ids: string[], from: number, to: number) => QueryResult<T>,
): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  const parts = await Promise.all(chunk(unique, 200).map(part => fetchAll<T>((from, to) => build(part, from, to))))
  return parts.flat()
}
