/** Simple KV stub for connector/OAuth tests */
export class MemoryKV {
  #store = new Map<string, string>()

  async get(key: string) {
    return this.#store.has(key) ? this.#store.get(key)! : null
  }

  async put(key: string, value: string, _opts?: { expirationTtl?: number }) {
    this.#store.set(key, value)
  }

  async delete(key: string) {
    this.#store.delete(key)
  }

  has(key: string) {
    return this.#store.has(key)
  }

  keys() {
    return [...this.#store.keys()]
  }
}
