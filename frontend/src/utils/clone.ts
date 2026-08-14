/** Strip Vue proxies / non-cloneable values for IndexedDB and workers. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
