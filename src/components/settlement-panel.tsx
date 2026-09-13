"use client";
import { useState } from "react";
import { ArrowRight, Check, CheckCheck, Download, Flag, Wallet } from "lucide-react";
import type { RoomView } from "@/lib/types";
import type { Send } from "./room-screen";
import { Empty, Field, Money } from "./ui";

export function SettlementPanel({
  room,
  send,
  busy,
}: {
  room: RoomView;
  send: Send;
  busy: boolean;
}) {
  const settlement = room.settlement!;
  const host = room.role === "host";
  const [note, setNote] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const me = settlement.rows.find((p) => p.id === room.me);
  const name = (id: string) => settlement.rows.find((p) => p.id === id)?.name;
  function download() {
    const data = {
      room: room.name,
      currency: room.game.config.currency,
      finalized: settlement.finalized,
      players: settlement.rows,
      payments: settlement.payments.map((p) => ({
        from: name(p.from),
        to: name(p.to),
        amount: p.amount,
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `pocketpot-${room.code}-settlement.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="content-panel settlement-panel">
      <div className="settlement-hero">
        <span className="feature-icon">
          <Wallet size={28} />
        </span>
        <span className="eyebrow">{settlement.finalized ? "THAT’S A WRAP" : "ONE LAST THING"}</span>
        <h2>
          A good night.
          <br />
          <span>A clear settle-up.</span>
        </h2>
        <p className="muted">
          {settlement.finalized
            ? "Your host finalized this session. Here’s where everyone landed."
            : "Check your totals, flag anything that looks off, and settle with your friends."}
        </p>
        <span className="pill">
          {room.game.config.currency} · {room.game.hand} HANDS · {settlement.rows.length} FRIENDS
        </span>
      </div>
      <section className="manage-section">
        <div className="section-heading">
          <h3>The final count</h3>
          <button className="text-button" onClick={download}>
            <Download size={15} /> Export
          </button>
        </div>
        <div className="settlement-table-wrap">
          <table className="settlement-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Total buy-in</th>
                <th>Cash-out + stack</th>
                <th>Net result</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {settlement.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    {row.id === room.me && <small> (you)</small>}
                  </td>
                  <td>
                    <Money amount={row.buyIn} currency={room.game.config.currency} />
                  </td>
                  <td>
                    <Money amount={row.cashOut} currency={room.game.config.currency} />
                  </td>
                  <td className={row.net >= 0 ? "profit" : "loss"}>
                    <Money amount={row.net} currency={room.game.config.currency} signed />
                  </td>
                  <td>
                    <span className={`review-state ${row.confirmation}`}>{row.confirmation}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine-print">
          <CheckCheck size={14} /> All net results balance to zero. No rake. No fees.
        </p>
      </section>
      <section className="manage-section">
        <h3>Fewer transfers. Same result.</h3>
        <p className="muted">
          The minimum number of payments to settle everyone. Send these externally using your usual
          payment method.
        </p>
        {settlement.payments.length ? (
          settlement.payments.map((p, i) => (
            <div className="payment-row" key={i}>
              <span className="payment-number">{i + 1}</span>
              <strong>{name(p.from)}</strong>
              <ArrowRight size={18} />
              <strong>{name(p.to)}</strong>
              <span className="payment-amount">
                <Money amount={p.amount} currency={room.game.config.currency} />
              </span>
            </div>
          ))
        ) : (
          <Empty>Everyone broke even. No payments needed.</Empty>
        )}
      </section>
      {!settlement.finalized && me && (
        <section className="manage-section">
          <h3>Your totals, confirmed by you.</h3>
          <p className="muted">
            Your buy-ins: <Money amount={me.buyIn} currency={room.game.config.currency} /> · Your
            cash-out and final stack:{" "}
            <Money amount={me.cashOut} currency={room.game.config.currency} />
          </p>
          <button
            className="button primary"
            disabled={busy || me.confirmation === "confirmed"}
            onClick={() => send({ type: "confirm", disputed: false, note: "" })}
          >
            <Check size={17} />
            {me.confirmation === "confirmed" ? "Totals confirmed" : "My totals look right"}
          </button>
          <form
            className="dispute-form"
            onSubmit={(e) => {
              e.preventDefault();
              send({ type: "confirm", disputed: true, note });
            }}
          >
            <Field label="Something doesn’t add up?">
              <input
                placeholder="Tell the host what needs checking"
                minLength={3}
                maxLength={240}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <button className="button secondary" disabled={busy}>
              <Flag size={15} /> Flag a disagreement
            </button>
          </form>
        </section>
      )}
      {settlement.rows
        .filter((r) => r.confirmation === "disputed" || r.confirmation === "resolved")
        .map((row) => (
          <section className="manage-section dispute-section" key={row.id}>
            <h3>
              {row.name} · {row.confirmation === "resolved" ? "Resolved" : "Needs a check"}
            </h3>
            <p>{row.note}</p>
            {host && row.confirmation === "disputed" && !settlement.finalized && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send({ type: "resolve", playerId: row.id, note: resolutions[row.id] ?? "" });
                }}
              >
                <Field label="Resolution (recorded in the audit)">
                  <input
                    required
                    minLength={3}
                    maxLength={240}
                    value={resolutions[row.id] ?? ""}
                    onChange={(e) => setResolutions({ ...resolutions, [row.id]: e.target.value })}
                    placeholder="What did you agree on?"
                  />
                </Field>
                <button className="button secondary" disabled={busy}>
                  Record resolution
                </button>
              </form>
            )}
          </section>
        ))}
      {host && !settlement.finalized && (
        <section className="manage-section">
          <h3>Close out the night.</h3>
          <p className="muted">
            Resolve any flagged disagreements first. You can finalize while other confirmations are
            pending. Finalized sessions are read-only.
          </p>
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || settlement.rows.some((r) => r.confirmation === "disputed")}
              onClick={() => send({ type: "finalize" })}
            >
              Finalize session <CheckCheck size={17} />
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => send({ type: "cancelSettlement" })}
            >
              Reopen for corrections
            </button>
          </div>
        </section>
      )}
      <p className="fine-print">
        Guests can access this result for 90 days. Registered players retain their own aggregate
        summary in account history. Detailed room records are deleted after 90 days.
      </p>
    </div>
  );
}
