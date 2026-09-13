import type { Payment, SettlementRow } from "./types";
import { ensure } from "./poker";

// Exact search over zero-sum partitions (at most 10 players). Maximizing the
// number of disjoint balanced groups minimizes the total number of transfers.
export function minimizePayments(rows: Pick<SettlementRow, "id" | "net">[]): Payment[] {
  ensure(
    rows.every((r) => Number.isSafeInteger(r.net)),
    "Invalid settlement amount.",
  );
  ensure(rows.reduce((n, r) => n + r.net, 0) === 0, "Settlement does not balance.");
  const active = rows.filter((r) => r.net !== 0);
  const size = 1 << active.length;
  const sums = Array<number>(size).fill(0);
  const count = Array<number>(size).fill(-100);
  const choice = Array<number>(size).fill(0);
  count[0] = 0;
  for (let mask = 1; mask < size; mask++) {
    const bit = mask & -mask;
    sums[mask] = sums[mask ^ bit] + active[Math.log2(bit)].net;
  }
  for (let mask = 1; mask < size; mask++) {
    if (sums[mask] !== 0) continue;
    const first = mask & -mask;
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask)
      if (sub & first && sums[sub] === 0 && count[mask ^ sub] + 1 > count[mask]) {
        count[mask] = count[mask ^ sub] + 1;
        choice[mask] = sub;
      }
  }
  const payments: Payment[] = [];
  for (let remaining = size - 1; remaining;) {
    const group = choice[remaining];
    ensure(group, "Settlement partition failed.");
    const members = active.filter((_, i) => group & (1 << i)).map((r) => ({ ...r }));
    const debtors = members.filter((r) => r.net < 0);
    const creditors = members.filter((r) => r.net > 0);
    let d = 0,
      c = 0;
    while (d < debtors.length && c < creditors.length) {
      const amount = Math.min(-debtors[d].net, creditors[c].net);
      payments.push({ from: debtors[d].id, to: creditors[c].id, amount });
      debtors[d].net += amount;
      creditors[c].net -= amount;
      if (!debtors[d].net) d++;
      if (!creditors[c].net) c++;
    }
    remaining ^= group;
  }
  return payments;
}
