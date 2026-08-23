/** Simple concurrency pool for connector enrichment fetches. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index], index)
    }
  }
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, () => run())
  await Promise.all(runners)
  return results
}
