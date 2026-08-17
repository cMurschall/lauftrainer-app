/** Minimal in-memory D1 stub covering SQL used by billing.ts */

type Row = Record<string, unknown>

function uniqueError(message: string) {
  const error = new Error(message)
  return error
}

export class MemoryD1 {
  wallets: Row[] = []
  credit_ledger: Row[] = []
  plan_reservations: Row[] = []
  paddle_events: Row[] = []
  vouchers: Row[] = []
  voucher_redemptions: Row[] = []

  prepare(sql: string) {
    return new MemoryStatement(this, sql)
  }

  async batch(statements: MemoryStatement[]) {
    const results = []
    for (const statement of statements) results.push(await statement.run())
    return results
  }

  table(name: string): Row[] {
    const table = (this as unknown as Record<string, Row[]>)[name]
    if (!table) throw new Error(`Unknown table ${name}`)
    return table
  }

  balanceFor(walletId: string): number {
    const credits = this.credit_ledger
      .filter((row) => row.wallet_id === walletId)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const pending = this.plan_reservations
      .filter((row) => row.wallet_id === walletId && row.status === 'pending_plan_generation')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
    return credits - pending
  }

  assertUnique(table: string, row: Row) {
    if (table === 'wallets') {
      if (this.wallets.some((item) => item.wallet_id === row.wallet_id || item.token_hash === row.token_hash)) {
        throw uniqueError('UNIQUE constraint failed: wallets')
      }
    }
    if (table === 'credit_ledger') {
      if (
        this.credit_ledger.some(
          (item) =>
            item.ledger_id === row.ledger_id ||
            (row.reference_id != null && item.kind === row.kind && item.reference_id === row.reference_id),
        )
      ) {
        throw uniqueError('UNIQUE constraint failed: credit_ledger')
      }
    }
    if (table === 'plan_reservations') {
      if (
        this.plan_reservations.some(
          (item) => item.reservation_id === row.reservation_id || item.request_id === row.request_id,
        )
      ) {
        throw uniqueError('UNIQUE constraint failed: plan_reservations')
      }
    }
    if (table === 'paddle_events') {
      if (
        this.paddle_events.some(
          (item) =>
            item.event_id === row.event_id ||
            (row.transaction_id != null && item.transaction_id === row.transaction_id),
        )
      ) {
        throw uniqueError('UNIQUE constraint failed: paddle_events')
      }
    }
    if (table === 'vouchers') {
      if (this.vouchers.some((item) => item.code_hash === row.code_hash)) {
        throw uniqueError('UNIQUE constraint failed: vouchers')
      }
    }
    if (table === 'voucher_redemptions') {
      if (
        this.voucher_redemptions.some((item) => item.code_hash === row.code_hash && item.wallet_id === row.wallet_id)
      ) {
        throw uniqueError('UNIQUE constraint failed: voucher_redemptions')
      }
    }
  }
}

class MemoryStatement {
  #db: MemoryD1
  #sql: string
  #binds: unknown[] = []

  constructor(db: MemoryD1, sql: string) {
    this.#db = db
    this.#sql = sql.replace(/\s+/g, ' ').trim()
  }

  bind(...values: unknown[]) {
    this.#binds = values
    return this
  }

  async first<T = Row>() {
    const rows = this.#select()
    return (rows[0] as T) || null
  }

  async all<T = Row>() {
    return { results: this.#select() as T[] }
  }

  async run() {
    const changes = this.#mutate()
    return { success: true, meta: { changes } }
  }

  #select(): Row[] {
    const sql = this.#sql
    const b = this.#binds

    if (sql.startsWith('SELECT * FROM wallets WHERE token_hash = ?')) {
      return this.#db.wallets.filter((row) => row.token_hash === b[0])
    }
    if (sql.startsWith('SELECT wallet_id FROM wallets WHERE wallet_id = ?')) {
      return this.#db.wallets.filter((row) => row.wallet_id === b[0]).map((row) => ({ wallet_id: row.wallet_id }))
    }
    if (sql.startsWith('SELECT wallet_id FROM paddle_events WHERE transaction_id = ?')) {
      return this.#db.paddle_events
        .filter((row) => row.transaction_id === b[0])
        .map((row) => ({ wallet_id: row.wallet_id }))
    }
    if (sql.startsWith('SELECT * FROM vouchers WHERE code_hash = ?')) {
      return this.#db.vouchers.filter((row) => row.code_hash === b[0])
    }
    if (sql.startsWith('SELECT 1 FROM voucher_redemptions WHERE code_hash = ? AND wallet_id = ?')) {
      const hit = this.#db.voucher_redemptions.some((row) => row.code_hash === b[0] && row.wallet_id === b[1])
      return hit ? [{ '1': 1 }] : []
    }
    if (sql.startsWith('SELECT * FROM plan_reservations WHERE request_id = ?')) {
      return this.#db.plan_reservations.filter((row) => row.request_id === b[0])
    }
    if (sql.includes('AS balance')) {
      return [{ balance: this.#db.balanceFor(String(b[0])) }]
    }
    throw new Error(`Unsupported SELECT: ${sql}`)
  }

  #mutate(): number {
    const sql = this.#sql
    const b = this.#binds

    if (sql.startsWith('INSERT INTO wallets(')) {
      const row = { wallet_id: b[0], token_hash: b[1], created_at: b[2], updated_at: b[3] }
      this.#db.assertUnique('wallets', row)
      this.#db.wallets.push(row)
      return 1
    }

    if (sql.startsWith('INSERT INTO vouchers(')) {
      const row = {
        code_hash: b[0],
        amount: b[1],
        expires_at: b[2],
        max_redemptions: b[3],
        redeemed_count: 0,
      }
      this.#db.assertUnique('vouchers', row)
      this.#db.vouchers.push(row)
      return 1
    }

    if (sql.startsWith('UPDATE wallets SET token_hash = ?, updated_at = ? WHERE wallet_id = ?')) {
      const row = this.#db.wallets.find((item) => item.wallet_id === b[2])
      if (!row) return 0
      row.token_hash = b[0]
      row.updated_at = b[1]
      return 1
    }

    if (sql.startsWith('INSERT INTO voucher_redemptions(')) {
      const row = { code_hash: b[0], wallet_id: b[1], created_at: b[2] }
      this.#db.assertUnique('voucher_redemptions', row)
      this.#db.voucher_redemptions.push(row)
      return 1
    }

    if (sql.startsWith('INSERT INTO credit_ledger(') && sql.includes('VALUES(')) {
      const row = {
        ledger_id: b[0],
        wallet_id: b[1],
        amount: b[2],
        kind: b[3],
        reference_id: b[4],
        created_at: b[5],
      }
      this.#db.assertUnique('credit_ledger', row)
      this.#db.credit_ledger.push(row)
      return 1
    }

    if (sql.startsWith('INSERT INTO credit_ledger(') && sql.includes('SELECT')) {
      // INSERT ... SELECT ?,wallet_id,-amount,'plan_generation',reservation_id,? FROM plan_reservations WHERE reservation_id=?
      const reservation = this.#db.plan_reservations.find((row) => row.reservation_id === b[2])
      if (!reservation) return 0
      const row = {
        ledger_id: b[0],
        wallet_id: reservation.wallet_id,
        amount: -Number(reservation.amount),
        kind: 'plan_generation',
        reference_id: reservation.reservation_id,
        created_at: b[1],
      }
      this.#db.assertUnique('credit_ledger', row)
      this.#db.credit_ledger.push(row)
      return 1
    }

    if (sql.startsWith('INSERT INTO paddle_events(')) {
      const row = {
        event_id: b[0],
        transaction_id: b[1],
        wallet_id: b[2],
        amount: b[3],
        created_at: b[4],
      }
      this.#db.assertUnique('paddle_events', row)
      this.#db.paddle_events.push(row)
      return 1
    }

    if (sql.startsWith('INSERT INTO plan_reservations(') && sql.includes('SELECT')) {
      const walletId = String(b[1])
      if (this.#db.balanceFor(walletId) < 1) return 0
      const row = {
        reservation_id: b[0],
        wallet_id: b[1],
        status: 'pending_plan_generation',
        amount: 1,
        created_at: b[2],
        expires_at: b[3],
        request_id: b[4],
        completed_at: null,
        result_json: null,
      }
      this.#db.assertUnique('plan_reservations', row)
      this.#db.plan_reservations.push(row)
      return 1
    }

    if (
      sql.startsWith(
        "UPDATE plan_reservations SET status = 'released', completed_at = ? WHERE status = 'pending_plan_generation' AND expires_at <=",
      )
    ) {
      let changes = 0
      for (const row of this.#db.plan_reservations) {
        if (row.status === 'pending_plan_generation' && String(row.expires_at) <= String(b[1])) {
          row.status = 'released'
          row.completed_at = b[0]
          changes++
        }
      }
      return changes
    }

    if (sql.startsWith("UPDATE plan_reservations SET status='plan_generation'")) {
      const row = this.#db.plan_reservations.find(
        (item) => item.reservation_id === b[2] && item.status === 'pending_plan_generation',
      )
      if (!row) return 0
      row.status = 'plan_generation'
      row.completed_at = b[0]
      row.result_json = b[1]
      return 1
    }

    if (sql.startsWith("UPDATE plan_reservations SET status='released', completed_at=? WHERE reservation_id=?")) {
      const row = this.#db.plan_reservations.find(
        (item) => item.reservation_id === b[1] && item.status === 'pending_plan_generation',
      )
      if (!row) return 0
      row.status = 'released'
      row.completed_at = b[0]
      return 1
    }

    if (sql.startsWith('UPDATE vouchers SET redeemed_count = redeemed_count + 1')) {
      const row = this.#db.vouchers.find(
        (item) => item.code_hash === b[0] && Number(item.redeemed_count) < Number(item.max_redemptions),
      )
      if (!row) return 0
      row.redeemed_count = Number(row.redeemed_count) + 1
      return 1
    }

    throw new Error(`Unsupported mutate: ${sql}`)
  }
}

export async function seedVoucher(
  db: MemoryD1,
  code: string,
  amount: number,
  opts: { expiresAt?: string | null; max?: number } = {},
) {
  const hash = await digest(code.trim().toUpperCase())
  db.vouchers.push({
    code_hash: hash,
    amount,
    expires_at: opts.expiresAt ?? null,
    max_redemptions: opts.max ?? 1,
    redeemed_count: 0,
  })
}

export async function digest(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
