"use client";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Crown,
  Plus,
  QrCode,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { nextPositions, seated } from "@/lib/poker";
import type { RoomView } from "@/lib/types";
import type { Send } from "./room-screen";
import { Empty, Field, Money } from "./ui";

export function Management({
  room,
  send,
  busy,
  share,
}: {
  room: RoomView;
  send: Send;
  busy: boolean;
  share: () => void;
}) {
  const host = room.role === "host",
    manage = host || room.role === "cohost",
    between = room.game.stage === "between" && !room.settlement;
  const [amount, setAmount] = useState(room.game.config.buyIn);
  const [blinds, setBlinds] = useState({
    smallBlind: room.game.config.smallBlind,
    bigBlind: room.game.config.bigBlind,
    ante: room.game.config.ante,
  });
  const [tableSettings, setTableSettings] = useState({
    actionMode: room.game.config.actionMode ?? "individual",
    pauseBetweenStreets: room.game.config.pauseBetweenStreets ?? false,
  });
  useEffect(() => {
    setTableSettings({
      actionMode: room.game.config.actionMode ?? "individual",
      pauseBetweenStreets: room.game.config.pauseBetweenStreets ?? false,
    });
  }, [room.game.config.actionMode, room.game.config.pauseBetweenStreets]);
  const [order, setOrder] = useState(seated(room.game).map((p) => p.id));
  const [from, setFrom] = useState(room.me ?? "");
  const [to, setTo] = useState("");
  const [adjust, setAdjust] = useState(0);
  const [reason, setReason] = useState("");
  const orderKey = seated(room.game)
    .map((p) => p.id)
    .join(",");
  useEffect(() => setOrder(orderKey.split(",").filter(Boolean)), [orderKey]);
  const preview = structuredClone(room.game);
  order.forEach((id, i) => {
    const p = preview.players.find((p) => p.id === id);
    if (p) p.seat = i + 1;
  });
  const next = nextPositions(preview);
  const name = (id: string | null) => room.game.players.find((p) => p.id === id)?.name ?? "—";
  const me = room.game.players.find((p) => p.id === room.me);
  function move(i: number, delta: number) {
    const ids = [...order];
    [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]];
    setOrder(ids);
  }
  return (
    <div className="management content-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow muted">GOOD COMPANY, GOOD ORDER</span>
          <h2>Room & players</h2>
        </div>
        <button className="button secondary" onClick={share}>
          <QrCode size={17} /> Invite friends
        </button>
      </div>
      {host && (
        <section className="manage-section">
          <div className="section-heading">
            <h3>Waiting at the door</h3>
            <span className="pill">{room.requests.length} REQUESTS</span>
          </div>
          {room.requests.length === 0 ? (
            <Empty>Everyone’s accounted for. New requests will appear here.</Empty>
          ) : (
            room.requests.map((q) => (
              <div className="request-row" key={q.id}>
                <span className="avatar small peach">{q.name[0]}</span>
                <div>
                  <strong>{q.name}</strong>
                  <span>
                    {q.kind === "recover"
                      ? `Recover ${name(q.playerId ?? null)}’s seat`
                      : q.kind === "display"
                        ? "Pair a read-only display"
                        : q.kind === "cashout"
                          ? "Cash out current stack"
                          : `${q.kind} · ${q.amount.toLocaleString()} ${room.game.config.currency}`}
                  </span>
                  {q.kind === "recover" && (
                    <small>Verify this person at your physical table before approving.</small>
                  )}
                </div>
                <button
                  className="icon-button reject"
                  aria-label={`Reject ${q.name}`}
                  disabled={busy}
                  onClick={() => send({ type: "reject", requestId: q.id })}
                >
                  <X size={18} />
                </button>
                <button
                  className="button primary small-button"
                  disabled={busy || (!between && ["join", "rebuy", "cashout"].includes(q.kind))}
                  onClick={() => send({ type: "approve", requestId: q.id })}
                >
                  <Check size={16} /> Approve
                </button>
              </div>
            ))
          )}
        </section>
      )}
      <section className="manage-section">
        <div className="section-heading">
          <h3>The lineup</h3>
          <span className="pill">{seated(room.game).length} / 10 SEATS</span>
        </div>
        <p className="muted">
          Availability and seats can change between hands. Returning players don’t owe missed
          blinds.
        </p>
        <div className="player-management-list">
          {room.game.players.map((p) => (
            <div className="player-management-row" key={p.id}>
              <span className="seat-number">{p.seat}</span>
              <div className="player-management-name">
                <strong>
                  {p.name} {p.id === room.host && <Crown size={14} />}{" "}
                  {p.id === room.cohost && <ShieldCheck size={14} />}
                </strong>
                <small>
                  {p.left
                    ? "Cashed out"
                    : p.sittingOut
                      ? "Sitting out"
                      : p.id === room.host
                        ? "Host"
                        : p.id === room.cohost
                          ? "Co-host"
                          : "Player"}
                </small>
              </div>
              <div className="player-stack">
                <strong>
                  <Money amount={p.stack} currency={room.game.config.currency} />
                </strong>
                {host && room.funds && (
                  <small>
                    Buy-ins{" "}
                    <Money amount={room.funds[p.id].buyIn} currency={room.game.config.currency} />
                  </small>
                )}
              </div>
              {!p.left && (manage || p.id === room.me) && (
                <button
                  className="button secondary small-button"
                  disabled={busy || !between}
                  onClick={() => send({ type: "sit", playerId: p.id, sittingOut: !p.sittingOut })}
                >
                  {p.sittingOut ? "Return" : "Sit out"}
                </button>
              )}
              {host && p.id !== room.host && !p.left && (
                <details className="player-options">
                  <summary aria-label={`Manage ${p.name}`}>•••</summary>
                  <div>
                    <button
                      disabled={busy || !!room.settlement?.finalized}
                      onClick={() => send({ type: "cohost", playerId: p.id })}
                    >
                      Make co-host
                    </button>
                    <button
                      disabled={busy || !!room.settlement?.finalized}
                      onClick={() => send({ type: "transfer", playerId: p.id })}
                    >
                      Transfer full host role
                    </button>
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
        {host && (
          <p className="fine-print">
            Cumulative buy-ins are visible only to you during play. A co-host can manage gameplay
            but cannot approve money or close the session.
          </p>
        )}
      </section>
      <div className="manage-grid">
        {host && (
          <section className="manage-section">
            <h3>Table flow</h3>
            <p className="muted">
              Choose how moves are recorded and whether the table waits for cards. Changes apply
              between hands.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send({ type: "tableSettings", ...tableSettings });
              }}
            >
              <Field label="Action style">
                <select
                  value={tableSettings.actionMode}
                  onChange={(e) =>
                    setTableSettings({
                      ...tableSettings,
                      actionMode: e.target.value as "individual" | "spoken",
                    })
                  }
                >
                  <option value="individual">Players enter their announced actions</option>
                  <option value="spoken">Host or co-host records spoken actions</option>
                </select>
              </Field>
              <label className="toggle-row">
                <span>Pause for the flop, turn, and river</span>
                <input
                  type="checkbox"
                  checked={tableSettings.pauseBetweenStreets}
                  onChange={(e) =>
                    setTableSettings({ ...tableSettings, pauseBetweenStreets: e.target.checked })
                  }
                />
              </label>
              <button className="button secondary full" disabled={busy || !between}>
                Save table flow
              </button>
            </form>
          </section>
        )}
        {me && !me.left && (
          <section className="manage-section">
            <h3>Your stack, your call.</h3>
            <p className="muted">
              Request a rebuy or cash out between hands. The host approves each financial change.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send({ type: "request", kind: "rebuy", name: me.name, amount });
              }}
            >
              <Field label={`Rebuy amount (${room.game.config.currency})`}>
                <input
                  type="number"
                  required
                  inputMode="numeric"
                  min={room.game.config.minBuyIn}
                  max={room.game.config.maxBuyIn}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </Field>
              <button
                className="button secondary full"
                disabled={
                  busy ||
                  !between ||
                  room.requests.some((q) => q.playerId === me.id && q.status === "pending")
                }
              >
                <Plus size={16} /> Request rebuy
              </button>
            </form>
            <button
              className="text-button danger-text"
              disabled={busy || !between || host}
              onClick={() => send({ type: "request", kind: "cashout", name: me.name, amount: 0 })}
            >
              Request cash-out & leave
            </button>
            {host && (
              <p className="fine-print">
                To leave, transfer the host role first, or end the session from the table.
              </p>
            )}
          </section>
        )}
        {manage && (
          <section className="manage-section">
            <h3>Set the pace.</h3>
            <p className="muted">
              Blind changes take effect next hand and are announced in the shared activity log.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send({ type: "blinds", ...blinds });
              }}
            >
              <div className="form-grid">
                {(
                  [
                    ["smallBlind", "Small blind"],
                    ["bigBlind", "Big blind"],
                    ["ante", "Ante"],
                  ] as const
                ).map(([key, label]) => (
                  <Field label={label} key={key}>
                    <input
                      required
                      type="number"
                      inputMode="numeric"
                      min={key === "ante" ? 0 : 1}
                      max={1000000000}
                      value={blinds[key]}
                      onChange={(e) => setBlinds({ ...blinds, [key]: Number(e.target.value) })}
                    />
                  </Field>
                ))}
              </div>
              <button className="button secondary full" disabled={busy || !between}>
                Update blinds
              </button>
            </form>
          </section>
        )}
      </div>
      {manage && (
        <section className="manage-section">
          <h3>A seat for everyone.</h3>
          <p className="muted">
            Reorder virtual seats without moving chairs. The dealer button stays attached to the
            same player before the next rotation.
          </p>
          <div className="seat-order">
            {order.map((id, i) => (
              <div key={id}>
                <span>{i + 1}</span>
                <strong>{name(id)}</strong>
                <button
                  className="icon-button"
                  aria-label={`Move ${name(id)} up`}
                  disabled={i === 0 || busy || !between}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Move ${name(id)} down`}
                  disabled={i === order.length - 1 || busy || !between}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="next-preview">
            <span>NEXT HAND PREVIEW</span>
            <p>
              Dealer <strong>{name(next?.dealer ?? null)}</strong> · Small blind{" "}
              <strong>{name(next?.smallBlind ?? null)}</strong> · Big blind{" "}
              <strong>{name(next?.bigBlind ?? null)}</strong>
            </p>
          </div>
          <button
            className="button secondary"
            disabled={busy || !between || order.join(",") === orderKey}
            onClick={() => send({ type: "seats", order })}
          >
            Confirm seat order
          </button>
        </section>
      )}
      {host && (
        <section className="manage-section">
          <h3>Correct the ledger.</h3>
          <p className="muted">
            Move chips between stacks to correct a recorded result. Approved room funds stay
            balanced. Use a buy-in or cash-out request for money entering or leaving.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send({ type: "adjust", from, to, amount: adjust, reason });
            }}
          >
            <div className="form-grid">
              <Field label="From player">
                <select value={from} onChange={(e) => setFrom(e.target.value)} required>
                  <option value="">Choose player</option>
                  {seated(room.game).map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To player">
                <select value={to} onChange={(e) => setTo(e.target.value)} required>
                  <option value="">Choose player</option>
                  {seated(room.game).map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Whole units">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000000000}
                  required
                  value={adjust}
                  onChange={(e) => setAdjust(Number(e.target.value))}
                />
              </Field>
              <Field label="Reason (shared with the table)">
                <input
                  required
                  minLength={3}
                  maxLength={240}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain the correction"
                />
              </Field>
            </div>
            <button className="button secondary" disabled={busy || !between}>
              Record stack correction
            </button>
          </form>
        </section>
      )}
      {host && room.displays.length > 0 && (
        <section className="manage-section">
          <h3>Paired displays</h3>
          {room.displays.map((userId, i) => (
            <div className="request-row" key={userId}>
              <strong>Shared screen {i + 1}</strong>
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => send({ type: "revokeDisplay", userId })}
              >
                Revoke access
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
