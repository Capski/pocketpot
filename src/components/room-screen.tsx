"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Copy,
  Crown,
  Ellipsis,
  History,
  LayoutGrid,
  LockKeyhole,
  Monitor,
  Pause,
  Play,
  Plus,
  QrCode,
  Radio,
  Settings2,
  ShieldCheck,
  Spade,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, ApiError, cloudMode, supabase } from "@/lib/client";
import { legal, seated } from "@/lib/poker";
import type { Audit, Command, Pot, RoomView } from "@/lib/types";
import { strings as s } from "@/lib/strings";
import { Brand, Empty, ExternalNote, Field, Modal, Money, Pwa } from "./ui";
import { Management } from "./management";
import { SettlementPanel } from "./settlement-panel";

type Envelope = { key: string; version: number; command: Command };
export type Send = (c: Command) => Promise<boolean>;
export function RoomScreen({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const latest = useRef<RoomView | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("table");
  const [share, setShare] = useState(false);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [sound, setSound] = useState(false);
  const [tableSound, setTableSound] = useState(false);
  const [vibration, setVibration] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const accept = useCallback((r: RoomView) => {
    if (!latest.current || r.version >= latest.current.version) {
      latest.current = r;
      setRoom(r);
    }
  }, []);
  const deliver = useCallback(
    async (envelope: Envelope) => {
      if (locked.current) return false;
      locked.current = true;
      setBusy(true);
      try {
        const r = await api<RoomView>(`/api/rooms/${id}/commands`, "POST", envelope);
        accept(r);
        setOnline(true);
        localStorage.removeItem(`pocketpot-pending-${id}`);
        return true;
      } catch (e) {
        if (e instanceof ApiError) {
          localStorage.removeItem(`pocketpot-pending-${id}`);
          setError(e.message);
        } else {
          setOnline(false);
          setError(
            "Connection interrupted. Checking whether your action was accepted before retrying.",
          );
        }
        return false;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [id, accept],
  );
  const refresh = useCallback(async () => {
    try {
      const r = await api<RoomView>(`/api/rooms/${id}`);
      accept(r);
      setOnline(true);
      const pending = localStorage.getItem(`pocketpot-pending-${id}`);
      if (pending && !locked.current) await deliver(JSON.parse(pending));
    } catch (e) {
      setOnline(false);
      if (e instanceof ApiError) setError(e.message);
    }
  }, [id, accept, deliver]);
  useEffect(() => {
    localStorage.setItem("pocketpot-room", id);
    setSound(localStorage.getItem("pocketpot-sound") === "true");
    setTableSound(localStorage.getItem("pocketpot-table-sound") === "true");
    setVibration(localStorage.getItem("pocketpot-vibration") === "true");
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    const offline = () => setOnline(false);
    const reconnect = () => void refresh();
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    return () => {
      clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
    };
  }, [id, refresh]);
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`table-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pocketpot_signals", filter: `room_id=eq.${id}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [id, refresh]);
  const previousTurn = useRef<string | null>(null);
  useEffect(() => {
    if (room?.game.turn === room?.me && room?.me && previousTurn.current !== room?.me) {
      if (vibration) navigator.vibrate?.(80);
      if (sound) {
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.value = 0.04;
          osc.frequency.value = 540;
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
          osc.onended = () => void ctx.close();
        } catch {}
      }
    }
    previousTurn.current = room?.game.turn ?? null;
  }, [room?.game.turn, room?.me, sound, vibration]);
  const previousTableCue = useRef<{ phase: string; action: number } | null>(null);
  useEffect(() => {
    if (!room) return;
    const phase = `${room.game.stage}:${room.game.pendingStage ?? ""}`;
    const action = room.game.lastAction?.version ?? 0;
    const previous = previousTableCue.current;
    previousTableCue.current = { phase, action };
    if (!tableSound || !previous || (previous.phase === phase && previous.action === action))
      return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.055;
      osc.frequency.value = previous.phase === phase ? 660 : 780;
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
      osc.onended = () => void ctx.close();
    } catch {}
  }, [room, tableSound]);
  useEffect(() => {
    if (share && room)
      QRCode.toDataURL(`${location.origin}/?code=${room.code}`, {
        width: 256,
        margin: 2,
        color: { dark: "#112218", light: "#edf4e8" },
      }).then(setQr);
  }, [share, room?.code]);
  const send: Send = async (command) => {
    if (!latest.current || busy || !online) return false;
    if (localStorage.getItem(`pocketpot-pending-${id}`)) {
      setError("Your previous action is still being checked.");
      return false;
    }
    setError("");
    const envelope = { key: crypto.randomUUID(), version: latest.current.version, command };
    localStorage.setItem(`pocketpot-pending-${id}`, JSON.stringify(envelope));
    const ok = await deliver(envelope);
    if (!ok) void refresh();
    return ok;
  };
  if (!room)
    return (
      <div className="loading-page">
        <Brand />
        <span className="loading-ring" />
        <h2>{error ? "We couldn’t open this table." : "Finding your seat…"}</h2>
        <p className="muted">{error || "Connecting to the last confirmed room state."}</p>
        <Link className="button secondary" href="/">
          Back to PocketPot
        </Link>
      </div>
    );
  const manage = room.role === "host" || room.role === "cohost",
    display = room.role === "display";
  const names = (pid: string | null) => room.game.players.find((p) => p.id === pid)?.name ?? "—";
  return (
    <div className={`room-app ${display ? "display-mode" : ""}`}>
      <Pwa />
      <aside className="sidebar">
        <Brand />
        <span className="sidebar-label">YOUR POKER NIGHT</span>
        <nav>
          {[
            { id: "table", label: "The table", icon: LayoutGrid },
            { id: "manage", label: "Room & players", icon: Users },
            { id: "audit", label: "Activity log", icon: History },
            ...(room.settlement ? [{ id: "settlement", label: "Settle up", icon: Wallet }] : []),
          ]
            .filter((t) => !display || t.id === "table")
            .map((t) => (
              <button
                key={t.id}
                className={`nav-item ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={18} />
                {t.label}
                {t.id === "manage" && room.role === "host" && room.requests.length > 0 && (
                  <span className="count-badge">{room.requests.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={21} />
            <strong>Your table, your people.</strong>
            <p>
              Invite-only. No public rooms.
              <br />
              Just a good night together.
            </p>
          </div>
          <button className="nav-item" onClick={() => setPrefs(true)}>
            <Settings2 size={17} /> Device preferences
          </button>
          <Link className="nav-item" href="/">
            <ArrowLeft size={17} /> Back home
          </Link>
        </div>
      </aside>
      <div className="room-main">
        <header className="room-header">
          <div>
            <div className="eyebrow muted">
              <span className="status-dot" />
              {cloudMode ? "PRIVATE CASH GAME" : "LOCAL DEVELOPMENT · SINGLE SERVER"}
            </div>
            <h1>{room.name}</h1>
          </div>
          <div className="room-header-right">
            <span className={`connection ${online ? "" : "disconnected"}`}>
              {online ? <Wifi size={15} /> : <WifiOff size={15} />} {online ? "In sync" : "Paused"}
            </span>
            <button className="room-code" onClick={() => setShare(true)}>
              <QrCode size={17} />
              <span>{room.code}</span>
              <Copy size={13} />
            </button>
            <span className="avatar small lime">
              {room.me ? names(room.me).slice(0, 1) : display ? "TV" : "?"}
            </span>
          </div>
        </header>
        <div className="mobile-tabs">
          {["table", "manage", "audit", ...(room.settlement ? ["settlement"] : [])]
            .filter((t) => !display || t === "table")
            .map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t === "table"
                  ? "Table"
                  : t === "manage"
                    ? "Players"
                    : t === "audit"
                      ? "Activity"
                      : "Settle up"}
              </button>
            ))}
        </div>
        {!online && (
          <div role="status" className="offline-banner">
            <WifiOff size={18} />
            {s.offline}
          </div>
        )}
        {error && (
          <div role="alert" className="error room-error">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {room.role === "pending" ? (
          <Pending room={room} send={send} busy={busy || !online} />
        ) : (
          <>
            {tab === "table" && (
              <div className="table-layout">
                <section className="table-column">
                  <div className="table-toolbar">
                    <div className="pills">
                      <span className="pill">NO-LIMIT HOLD’EM</span>
                      <span className="currency-label">{room.game.config.currency}</span>
                    </div>
                    <span className="muted tiny">
                      {seated(room.game).length} / 10 seats <Users size={14} />
                    </span>
                  </div>
                  <TableCallout room={room} send={send} busy={busy || !online} />
                  <Table room={room} />
                  <div className="hand-status">
                    <div className="street-steps">
                      {["preflop", "flop", "turn", "river", "showdown"].map((stage, i) => (
                        <span
                          key={stage}
                          className={
                            room.game.pendingStage === stage
                              ? "up-next"
                              : room.game.stage === stage
                                ? "current"
                                : ""
                          }
                        >
                          <i>{i + 1}</i>
                          {stage}
                        </span>
                      ))}
                    </div>
                    <div className="blind-summary">
                      <span>
                        Blinds{" "}
                        <strong>
                          <Money
                            amount={room.game.config.smallBlind}
                            currency={room.game.config.currency}
                          />{" "}
                          /{" "}
                          <Money
                            amount={room.game.config.bigBlind}
                            currency={room.game.config.currency}
                          />
                        </strong>
                      </span>
                      <span>
                        Ante <strong>{room.game.config.ante || "—"}</strong>
                      </span>
                    </div>
                  </div>
                  {!display && (
                    <>
                      <Actions room={room} send={send} busy={busy || !online} />
                      {room.game.stage === "showdown" && (
                        <div className="pot-list">
                          <div className="section-heading">
                            <h2>Time to show your cards</h2>
                            <span className="pill">PHYSICAL CARDS</span>
                          </div>
                          <p className="muted">
                            {manage
                              ? "Choose the winner of each pot from the cards on the table."
                              : "The host will assign each pot after everyone shows their cards."}
                          </p>
                          {room.game.pots.map((p) => (
                            <PotAward
                              key={`${room.game.hand}-${p.id}-${!!p.winners}`}
                              pot={p}
                              room={room}
                              send={send}
                              busy={busy || !online}
                              manage={manage}
                            />
                          ))}
                        </div>
                      )}
                      {manage && !room.settlement && (
                        <div className="host-strip">
                          <span>
                            <Crown size={15} />{" "}
                            {room.role === "host" ? "Host controls" : "Co-host controls"}
                          </span>
                          <button
                            className="text-button"
                            disabled={!room.undoCount || busy || !online}
                            onClick={() => send({ type: "undo" })}
                          >
                            <Undo2 size={15} /> Undo last step
                          </button>
                          {room.role === "host" && room.game.stage === "between" && (
                            <button
                              className="text-button"
                              disabled={busy || !online}
                              onClick={async () => {
                                if (await send({ type: "settle" })) setTab("settlement");
                              }}
                            >
                              <Wallet size={15} /> End session
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {room.settlement && (
                    <button className="button primary full" onClick={() => setTab("settlement")}>
                      {room.settlement.finalized ? "View final results" : "Review settlement"}
                      <ArrowRight size={18} />
                    </button>
                  )}
                </section>
                {!display && (
                  <aside className="table-rail">
                    <div className="rail-heading">
                      <h3>At the table</h3>
                      <span className="pill">
                        {room.game.players.filter((p) => !p.left).length} PLAYERS
                      </span>
                    </div>
                    <div className="rail-players">
                      {seated(room.game).map((p, i) => (
                        <div key={p.id} className="rail-player">
                          <span
                            className={`avatar small ${["lime", "lilac", "peach", "green"][i % 4]}`}
                          >
                            {p.name[0]}
                          </span>
                          <div>
                            <strong>
                              {p.name}
                              {p.id === room.me && <small> (you)</small>}
                            </strong>
                            <span>
                              {p.sittingOut
                                ? "Sitting out"
                                : p.id === room.host
                                  ? "Host"
                                  : p.id === room.cohost
                                    ? "Co-host"
                                    : `Seat ${p.seat}`}
                            </span>
                          </div>
                          <strong>
                            <Money amount={p.stack} currency={room.game.config.currency} />
                          </strong>
                        </div>
                      ))}
                    </div>
                    <div className="rail-heading">
                      <h3>Recent activity</h3>
                      <button
                        className="text-button"
                        onClick={() => setTab("audit")}
                        aria-label="View all activity"
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <AuditFeed room={room} compact />
                    {room.role === "host" && room.requests.length > 0 && (
                      <button className="button primary full" onClick={() => setTab("manage")}>
                        {room.requests.length} pending request{room.requests.length > 1 ? "s" : ""}
                        <ArrowRight size={15} />
                      </button>
                    )}
                    <div className="table-tip">
                      <Spade size={18} />
                      <p>
                        Deal the cards.
                        <br />
                        <strong>We’ll count the chips.</strong>
                      </p>
                    </div>
                  </aside>
                )}
              </div>
            )}
            {tab === "manage" && !display && (
              <Management
                room={room}
                send={send}
                busy={busy || !online}
                share={() => setShare(true)}
              />
            )}
            {tab === "audit" && !display && (
              <div className="content-panel">
                <div className="section-heading">
                  <div className="stack tight">
                    <span className="eyebrow muted">THE SHARED RECORD</span>
                    <h2>Every move, accounted for.</h2>
                  </div>
                  <span className="pill">VERSION {room.version}</span>
                </div>
                <p className="muted">
                  Actions and corrections stay visible. Undo adds a new event.{" "}
                  {room.role !== "host" && "Cumulative buy-in records are private to the host."}
                </p>
                <AuditFeed room={room} />
              </div>
            )}
            {tab === "settlement" && !display && room.settlement && (
              <SettlementPanel room={room} send={send} busy={busy || !online} />
            )}
          </>
        )}
        <footer className="room-footer">
          <ExternalNote />
          <span>
            Hand #{String(room.game.hand).padStart(2, "0")} <span className="muted">·</span> v
            {room.version}
            {display ? " · Read-only display" : ""}
          </span>
        </footer>
      </div>
      {share && (
        <Modal title="Good company starts here" onClose={() => setShare(false)}>
          <p className="muted">
            Friends can scan this code or enter it on PocketPot. Every new seat and shared display
            still needs host approval.
          </p>
          {qr && <img className="qr-image" src={qr} alt={`Join room ${room.code}`} />}
          <div className="share-code">{room.code}</div>
          <button
            className="button primary full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${location.origin}/?code=${room.code}`);
                setCopied(true);
              } catch {
                setError("Copy the room code shown above.");
              }
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
            {copied ? "Invite copied" : "Copy invite link"}
          </button>
          {!cloudMode && (
            <p className="fine-print">
              Local mode requires this development server. A localhost link works only on this
              computer; use its LAN address to test another device.
            </p>
          )}
        </Modal>
      )}
      {prefs && (
        <Modal title="Make yourself comfortable" onClose={() => setPrefs(false)}>
          <p className="muted">These preferences apply only to this device.</p>
          <label className="toggle-row">
            <span>
              <Volume2 size={17} /> Sound on your turn
            </span>
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => {
                setSound(e.target.checked);
                localStorage.setItem("pocketpot-sound", String(e.target.checked));
              }}
            />
          </label>
          <label className="toggle-row">
            <span>
              <Volume2 size={17} /> Sound for table moves and phase changes
            </span>
            <input
              type="checkbox"
              checked={tableSound}
              onChange={(e) => {
                setTableSound(e.target.checked);
                localStorage.setItem("pocketpot-table-sound", String(e.target.checked));
              }}
            />
          </label>
          <label className="toggle-row">
            <span>
              <Radio size={17} /> Vibration on your turn
            </span>
            <input
              type="checkbox"
              checked={vibration}
              onChange={(e) => {
                setVibration(e.target.checked);
                localStorage.setItem("pocketpot-vibration", String(e.target.checked));
              }}
            />
          </label>
          <p className="fine-print">
            Sound and vibration depend on browser and device support. No turn timers or automatic
            actions.
          </p>
        </Modal>
      )}
    </div>
  );
}

function Pending({ room, send, busy }: { room: RoomView; send: Send; busy: boolean }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(room.game.config.buyIn);
  const [kind, setKind] = useState<"join" | "recover" | "display">("join");
  const pending = room.requests.some((r) => r.status === "pending");
  return (
    <div className="pending-panel">
      <span className="pending-icon">
        <Users size={32} />
      </span>
      <span className="eyebrow">YOU’RE IN THE RIGHT PLACE</span>
      <h2>{pending ? "Your seat is almost ready." : "There’s room for you."}</h2>
      <p className="muted">
        {pending
          ? "The host has your request. Keep this page open; your table will appear when they approve it."
          : "Introduce yourself to the host to join this private table."}
      </p>
      {room.pendingStatus === "rejected" && (
        <p className="error">
          The host declined your last request. Check with them before trying again.
        </p>
      )}
      {!pending && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await send({
              type: "request",
              kind,
              name,
              amount: kind === "join" ? amount : 0,
              ...(kind === "recover" ? { playerId: name } : {}),
            });
          }}
        >
          <div className="segmented">
            {(
              [
                ["join", "Join game"],
                ["recover", "New device"],
                ["display", "Shared display"],
              ] as const
            ).map(([k, label]) => (
              <button
                type="button"
                key={k}
                className={kind === k ? "selected" : ""}
                onClick={() => setKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <Field
            label={
              kind === "display"
                ? "Display name"
                : kind === "recover"
                  ? "Your exact existing player name"
                  : "Your display name"
            }
          >
            <input
              required
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "display" ? "Living room TV" : "Your name"}
            />
          </Field>
          {kind === "join" && (
            <Field label={`Requested buy-in (${room.game.config.currency})`}>
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
          )}
          {kind === "recover" && (
            <p className="fine-print">
              The host will verify you in person. Approval revokes the previous device and keeps
              your existing stack and seat.
            </p>
          )}
          {kind === "display" && (
            <p className="fine-print">
              A paired screen shows the table with no actions or private buy-in information.
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            Request{" "}
            {kind === "join"
              ? "a seat"
              : kind === "recover"
                ? "device recovery"
                : "display pairing"}
            <ArrowRight size={17} />
          </button>
        </form>
      )}
      {pending && (
        <span className="waiting-indicator">
          <span className="status-dot" /> Waiting for host approval
        </span>
      )}
    </div>
  );
}

function TableCallout({ room, send, busy }: { room: RoomView; send: Send; busy: boolean }) {
  const g = room.game;
  const manage = room.role === "host" || room.role === "cohost";
  const actor = g.players.find((p) => p.id === g.turn)?.name;
  const last = g.lastAction;
  const lastName = g.players.find((p) => p.id === last?.playerId)?.name;
  const stageName =
    g.pendingStage ?? (g.stage === "between" ? (g.hand ? "complete" : "ready") : g.stage);
  return (
    <section className={`table-callout ${g.pendingStage ? "revealing" : ""}`} aria-live="polite">
      <div className="callout-main">
        <span className="callout-stage">
          HAND {g.hand || "—"} · {stageName.toUpperCase()}
        </span>
        <strong>
          {g.pendingStage
            ? `${g.pendingStage.toUpperCase()} cards next`
            : actor
              ? `${actor} to act`
              : g.stage === "showdown"
                ? "Showdown · show your cards"
                : g.stage === "between"
                  ? "Ready for the next hand"
                  : "Waiting for the table"}
        </strong>
        <span className="callout-hint">
          {g.pendingStage
            ? "Reveal the cards at the table, then continue."
            : g.config.actionMode === "spoken" && actor
              ? "Say the move aloud. The host or co-host records it."
              : actor
                ? "Say the move aloud, then enter it."
                : g.stage === "showdown"
                  ? "Decide the winners from the real cards."
                  : ""}
        </span>
      </div>
      {g.pendingStage && manage && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() => send({ type: "continue" })}
        >
          Cards are out · continue <ArrowRight size={17} />
        </button>
      )}
      {last && lastName && (
        <div className="callout-last">
          <span>LAST MOVE</span>
          <strong>
            {lastName}{" "}
            {last.action === "allin"
              ? "went all-in"
              : last.action === "raise"
                ? "raised"
                : last.action === "call"
                  ? "called"
                  : last.action === "check"
                    ? "checked"
                    : "folded"}
            {last.amount !== undefined && (
              <>
                {" "}
                · <Money amount={last.amount} currency={g.config.currency} />
              </>
            )}
          </strong>
        </div>
      )}
    </section>
  );
}

function Table({ room }: { room: RoomView }) {
  const g = room.game;
  const players = seated(g);
  const total =
    g.players.reduce((n, p) => n + p.committed, 0) +
    g.pots.filter((p) => !p.winners).reduce((n, p) => n + p.amount, 0);
  return (
    <div className={`poker-table players-${players.length}`}>
      <div className="felt-edge" />
      <div className="felt-inner" />
      <div className="table-center">
        <Spade size={22} fill="currentColor" />
        <span className="table-pot-label">
          {g.stage === "between" ? "READY WHEN YOU ARE" : "TOTAL POT"}
        </span>
        <strong className="pot-amount">
          <Money amount={total} currency={g.config.currency} />
        </strong>
        <span className="pot-caption">
          {g.stage === "between"
            ? g.hand
              ? "Hand complete · next round?"
              : "Your poker night starts here"
            : g.stage === "showdown"
              ? `${g.pots.length} pot${g.pots.length > 1 ? "s" : ""} · choose winners`
              : `Hand #${String(g.hand).padStart(2, "0")} · ${g.stage}`}
        </span>
        {g.turn && (
          <span className="turn-badge">
            <span className="status-dot" />
            {g.players.find((p) => p.id === g.turn)?.name}’s turn
          </span>
        )}
      </div>
      {players.map((p, i) => {
        const angle = (i / players.length) * Math.PI * 2 + Math.PI / 2;
        const x = 50 + 42 * Math.cos(angle),
          y = 50 + 40 * Math.sin(angle);
        const leftCount = Math.ceil(players.length / 2);
        const onLeft = i < leftCount;
        const phoneX = onLeft ? 8 : 92;
        const phoneY = onLeft
          ? 90 - (i * 80) / Math.max(1, leftCount - 1)
          : 10 + ((i - leftCount) * 80) / Math.max(1, players.length - leftCount - 1);
        return (
          <div
            key={p.id}
            className={`table-seat ${p.id === g.turn ? "acting" : ""} ${p.folded && g.stage !== "between" ? "folded" : ""} ${p.sittingOut ? "sitting" : ""}`}
            style={
              {
                left: `${x}%`,
                top: `${y}%`,
                "--phone-x": `${phoneX}%`,
                "--phone-y": `${phoneY}%`,
              } as CSSProperties
            }
          >
            <div className="seat-topline">
              <span className={`avatar ${["lime", "lilac", "peach", "green"][i % 4]}`}>
                {p.name[0]}
              </span>
              <span className="seat-markers">
                {p.id === g.dealer && (
                  <b className="dealer-marker" title="Dealer">
                    D
                  </b>
                )}
                {p.id === g.smallBlind && <b title="Small blind">SB</b>}
                {p.id === g.bigBlind && <b title="Big blind">BB</b>}
              </span>
            </div>
            <div className="seat-body">
              <strong>
                {p.name}
                {p.id === room.me && <small> YOU</small>}
              </strong>
              <span>
                <Money amount={p.stack} currency={g.config.currency} />
              </span>
            </div>
            <div className="seat-status">
              {p.sittingOut ? (
                "SITTING OUT"
              ) : p.folded && g.stage !== "between" ? (
                "FOLDED"
              ) : p.inHand && p.stack === 0 && g.stage !== "between" ? (
                "ALL-IN"
              ) : p.bet > 0 ? (
                <>
                  Bet <Money amount={p.bet} currency={g.config.currency} />
                </>
              ) : p.id === g.turn ? (
                "TO ACT"
              ) : (
                `SEAT ${p.seat}`
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Actions({ room, send, busy }: { room: RoomView; send: Send; busy: boolean }) {
  const [override, setOverride] = useState(false);
  const [overridePlayer, setOverridePlayer] = useState("");
  const [raise, setRaise] = useState(0);
  const manage = room.role === "host" || room.role === "cohost";
  const g = room.game;
  const spoken = g.config.actionMode === "spoken";
  const recording = spoken || override;
  const actor = recording && manage ? overridePlayer || g.turn : room.me;
  const l = actor ? legal(g, actor) : null;
  const canAct = !!l && (!spoken || manage) && (actor === g.turn || (recording && manage));
  useEffect(() => {
    setRaise(l?.min ?? 0);
  }, [l?.min, g.turn]);
  useEffect(() => setOverridePlayer(""), [g.turn]);
  if (room.settlement) return null;
  if (g.stage === "between")
    return (
      <div className="action-panel between-panel">
        <div>
          <span className="eyebrow muted">{g.hand ? "NICE HAND" : "ALL SET?"}</span>
          <h3>
            {seated(g).filter((p) => p.stack > 0 && !p.sittingOut).length < 2
              ? "Waiting for another player."
              : "Let’s get the cards out."}
          </h3>
          <p className="muted">
            {manage
              ? "Approve your friends, check the seats, then deal."
              : "The host will start the next hand."}
          </p>
        </div>
        {manage && (
          <button
            className="button primary"
            disabled={busy || seated(g).filter((p) => p.stack > 0 && !p.sittingOut).length < 2}
            onClick={() => send({ type: "start" })}
          >
            <Play size={17} fill="currentColor" />
            {g.hand ? s.start : "Deal the first hand"}
          </button>
        )}
      </div>
    );
  if (g.stage === "showdown") return null;
  if (g.pendingStage) return null;
  const move = (action: "fold" | "check" | "call" | "allin" | "raise") =>
    send({
      type: "play",
      playerId: actor!,
      action,
      ...(action === "raise" ? { amount: raise } : {}),
      ...(recording ? { override: true } : {}),
    });
  return (
    <div className="action-panel">
      <div className="action-heading">
        <div>
          <span className="status-dot" />
          <strong>
            {canAct
              ? recording
                ? `Recording for ${g.players.find((p) => p.id === actor)?.name}`
                : "You’re up. Make your move."
              : spoken
                ? `Waiting for ${g.players.find((p) => p.id === g.turn)?.name} to speak.`
                : `Waiting for ${g.players.find((p) => p.id === g.turn)?.name}.`}
          </strong>
          <span className="muted">
            {canAct
              ? spoken
                ? "Listen to the player, then record the move."
                : "Say your move aloud, then tap. No timer."
              : spoken
                ? "The host or co-host will record the spoken move."
                : "The table will update automatically."}
          </span>
        </div>
        {manage && !spoken && (
          <label className="override-toggle">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />{" "}
            Record spoken action
          </label>
        )}
      </div>
      {recording && manage && (
        <Field label={spoken ? "Record spoken move for" : "Record for player (turn override)"}>
          <select value={overridePlayer} onChange={(e) => setOverridePlayer(e.target.value)}>
            <option value="">Current turn: {g.players.find((p) => p.id === g.turn)?.name}</option>
            {g.players
              .filter((p) => p.id !== g.turn && legal(g, p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (out of turn)
                </option>
              ))}
          </select>
        </Field>
      )}
      {canAct && l ? (
        <>
          <div className="action-info">
            <span>
              To call{" "}
              <strong>
                <Money amount={l.call} currency={g.config.currency} />
              </strong>
            </span>
            <span>
              Min raise to{" "}
              <strong>
                <Money amount={l.min} currency={g.config.currency} />
              </strong>
            </span>
            <span>
              All-in total{" "}
              <strong>
                <Money amount={l.max} currency={g.config.currency} />
              </strong>
            </span>
          </div>
          <div className="action-buttons">
            <button className="button fold-button" disabled={busy} onClick={() => move("fold")}>
              Fold
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => move(l.check ? "check" : "call")}
            >
              {l.check ? (
                <>
                  <Check size={18} /> Check
                </>
              ) : (
                <>
                  Call <Money amount={l.call} currency={g.config.currency} />
                </>
              )}
            </button>
            <button
              className="button secondary allin-button"
              disabled={busy || (!l.canRaise && l.max > g.currentBet)}
              onClick={() => move("allin")}
            >
              All-in
            </button>
            <div className="raise-control">
              <label className="sr-only" htmlFor="raise-total">
                Raise total
              </label>
              <input
                id="raise-total"
                aria-label="Raise total"
                type="number"
                inputMode="numeric"
                min={Math.min(l.min, l.max)}
                max={l.max}
                step={1}
                value={raise}
                onChange={(e) => setRaise(Number(e.target.value))}
                disabled={!l.canRaise || busy}
              />
              <button
                className="button primary"
                disabled={
                  busy ||
                  !l.canRaise ||
                  l.max <= g.currentBet ||
                  raise > l.max ||
                  (raise < l.min && raise !== l.max)
                }
                onClick={() => move("raise")}
              >
                Raise to <ArrowUpRight size={17} />
              </button>
            </div>
          </div>
          {recording && (
            <p className="fine-print">
              {spoken
                ? "The host or co-host records this move for the table."
                : "This action is recorded as a host/co-host override in everyone’s activity log."}
            </p>
          )}
        </>
      ) : (
        <div className="waiting-line">
          <span className="waiting-dots">•••</span>Your chips are safe. Enjoy the game.
        </div>
      )}
    </div>
  );
}

function PotAward({
  pot,
  room,
  send,
  busy,
  manage,
}: {
  pot: Pot;
  room: RoomView;
  send: Send;
  busy: boolean;
  manage: boolean;
}) {
  const [winners, setWinners] = useState<string[]>([]);
  const [odd, setOdd] = useState<string[]>([]);
  const remainder = winners.length ? pot.amount % winners.length : 0;
  const name = (id: string) => room.game.players.find((p) => p.id === id)?.name;
  return (
    <div className="pot-card">
      <div className="section-heading">
        <h3>{pot.id === 0 ? "Main pot" : `Side pot ${pot.id}`}</h3>
        <strong>
          <Money amount={pot.amount} currency={room.game.config.currency} />
        </strong>
      </div>
      {pot.winners ? (
        <p className="notice">
          <CheckCheck size={17} /> Awarded to {pot.winners.map(name).join(", ")}
          {pot.odd?.length ? ` · Extra units: ${pot.odd.map(name).join(", ")}` : ""}
        </p>
      ) : (
        <>
          <div className="winner-options">
            {pot.eligible.map((id) => (
              <label key={id} className={winners.includes(id) ? "selected" : ""}>
                <input
                  type="checkbox"
                  disabled={!manage || busy}
                  checked={winners.includes(id)}
                  onChange={(e) => {
                    setWinners(
                      e.target.checked ? [...winners, id] : winners.filter((x) => x !== id),
                    );
                    setOdd([]);
                  }}
                />
                {name(id)}
              </label>
            ))}
          </div>
          {manage && (
            <>
              {winners.length > 0 && (
                <p className="fine-print">
                  Each winner receives{" "}
                  <Money
                    amount={Math.floor(pot.amount / winners.length)}
                    currency={room.game.config.currency}
                  />
                  {remainder
                    ? `, plus ${remainder} leftover unit${remainder > 1 ? "s" : ""} to assign.`
                    : "."}
                </p>
              )}
              {remainder > 0 && (
                <div className="odd-picker">
                  <strong>
                    Give one extra unit to {remainder} winner{remainder > 1 ? "s" : ""}
                  </strong>
                  {winners.map((id) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={odd.includes(id)}
                        onChange={(e) =>
                          setOdd(e.target.checked ? [...odd, id] : odd.filter((x) => x !== id))
                        }
                      />
                      {name(id)}
                    </label>
                  ))}
                </div>
              )}
              <button
                className="button primary"
                disabled={busy || !winners.length || odd.length !== remainder}
                onClick={() => send({ type: "award", potId: pot.id, winners, odd })}
              >
                Assign pot <Check size={16} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
function AuditFeed({ room, compact = false }: { room: RoomView; compact?: boolean }) {
  const [older, setOlder] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const all = [...new Map([...older, ...room.audit].map((e) => [e.seq, e])).values()].sort(
    (a, b) => b.seq - a.seq,
  );
  const entries = compact ? all.slice(0, 5) : all;
  async function loadOlder() {
    setLoading(true);
    setError("");
    try {
      const next = await api<Audit[]>(
        `/api/rooms/${room.id}/audit?before=${all.at(-1)?.seq ?? room.version + 1}`,
      );
      setOlder([...older, ...next]);
      if (next.length < 100) setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load earlier activity.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className={`audit-feed ${compact ? "compact" : ""}`}>
      {entries.length ? (
        entries.map((e) => (
          <div className="audit-entry" key={e.seq}>
            <span className={`audit-dot ${e.text.includes("Undid") ? "amber" : ""}`} />
            <div>
              <p>{e.text}</p>
              <small>
                {e.actor} ·{" "}
                {new Date(e.at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                {!compact && ` · #${e.seq}`}
              </small>
            </div>
          </div>
        ))
      ) : (
        <Empty>The night’s story starts with the first hand.</Empty>
      )}
      {!compact && !done && all.length >= 100 && (
        <button className="button secondary" disabled={loading} onClick={loadOlder}>
          {loading ? "Loading…" : "Load earlier activity"}
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
