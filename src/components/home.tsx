"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  History,
  LockKeyhole,
  Plus,
  Radio,
  ShieldCheck,
  Spade,
  Users,
  Wallet,
} from "lucide-react";
import { api, cloudMode, supabase } from "@/lib/client";
import type { Config, RoomView } from "@/lib/types";
import { Brand, ExternalNote, Field, Modal, Money, Pwa } from "./ui";
import { strings as s } from "@/lib/strings";

const defaults: Config = {
  currency: "HKD",
  buyIn: 100,
  minBuyIn: 50,
  maxBuyIn: 200,
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
};
export function Home() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [modal, setModal] = useState<"create" | "join" | "account" | "help" | null>(null);
  const [config, setConfig] = useState(defaults);
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("Friday night poker");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resume, setResume] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<
    Array<{
      room_id: string;
      room_name: string;
      currency: string;
      finalized_at: string;
      summary: { net: number };
    }>
  >([]);
  useEffect(() => {
    setHydrated(true);
    setResume(localStorage.getItem("pocketpot-room"));
    const query = new URLSearchParams(location.search);
    if (query.get("code")) {
      setCode(query.get("code")!);
      setModal("join");
    }
  }, []);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  function enter(r: RoomView) {
    localStorage.setItem("pocketpot-room", r.id);
    router.push(`/room/${r.id}`);
  }
  const open = (m: typeof modal) => {
    setError("");
    setNotice("");
    setModal(m);
  };
  return (
    <div className="home-page" data-ready={hydrated} inert={!hydrated}>
      <Pwa />
      <header className="site-header">
        <Brand />
        <nav>
          <span className="header-caption">A better kind of poker night.</span>
          <button className="text-button" onClick={() => open("account")}>
            <History size={16} /> Your sessions
          </button>
          <button
            className="help-button icon-button"
            aria-label="How PocketPot works"
            onClick={() => open("help")}
          >
            <CircleHelp size={20} />
          </button>
        </nav>
      </header>
      <main className="home-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" /> FOR THE FRIENDS AROUND YOUR TABLE
            </div>
            <h1>
              All the poker.
              <br />
              None of the
              <br />
              <span>chip counting.</span>
            </h1>
            <p className="hero-description">
              Your cards. Your people. One shared pot.
              <br />
              Keep bets, stacks, and the settle-up in sync—
              <br className="desktop-break" />
              so you can stay in the game.
            </p>
            <div className="hero-buttons">
              <button
                className="button primary large"
                disabled={!hydrated}
                onClick={() => open("create")}
              >
                <Plus size={19} />
                {s.create}
                <ArrowUpRight size={18} />
              </button>
              <button
                className="button secondary large"
                disabled={!hydrated}
                onClick={() => open("join")}
              >
                {s.join}
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="hero-meta">
              <span>
                <Users size={15} /> 2–10 friends
              </span>
              <i />
              <span>
                <LockKeyhole size={14} /> Always private
              </span>
              <i />
              <span>No account needed</span>
            </div>
            {resume && (
              <button className="resume-link" onClick={() => router.push(`/room/${resume}`)}>
                <Radio size={15} /> Return to your last table <ArrowRight size={14} />
              </button>
            )}
          </div>
          <div className="hero-preview" aria-label="An example of a PocketPot table">
            <div className="preview-top">
              <span className="preview-live">
                <span className="status-dot" /> THE FRIDAY TABLE
              </span>
              <span className="preview-hand">
                HAND #08 <span>·</span> FLOP
              </span>
            </div>
            <div className="mini-table">
              <div className="table-inset" />
              <div className="mini-pot">
                <span>TOTAL POT</span>
                <strong>$240</strong>
                <div className="mini-chips">
                  <i />
                  <i />
                  <i />
                </div>
                <small>HKD · 5 / 10 blinds</small>
              </div>
              <div className="mini-seat mini-seat-top">
                <div className="avatar green">J</div>
                <div>
                  <strong>
                    Jamie <em>D</em>
                  </strong>
                  <span>$480</span>
                </div>
                <i className="mini-bet">$60</i>
              </div>
              <div className="mini-seat mini-seat-left">
                <div className="avatar lilac">M</div>
                <div>
                  <strong>Morgan</strong>
                  <span>$620</span>
                </div>
                <i className="mini-bet">$60</i>
              </div>
              <div className="mini-seat mini-seat-right">
                <div className="avatar peach">R</div>
                <div>
                  <strong>Riley</strong>
                  <span>$340</span>
                </div>
                <i className="mini-bet">$60</i>
              </div>
              <div className="mini-seat mini-seat-bottom">
                <div className="avatar lime">Y</div>
                <div>
                  <strong>
                    You <span className="you-turn">YOUR TURN</span>
                  </strong>
                  <span>$320</span>
                </div>
                <i className="mini-bet">$60</i>
              </div>
            </div>
            <div className="preview-actions">
              <span>
                <span className="status-dot" /> You’re up. Make your move.
              </span>
              <div>
                <span>Fold</span>
                <span>
                  Check <Check size={14} />
                </span>
                <span>
                  Raise <ArrowUpRight size={14} />
                </span>
              </div>
            </div>
            <div className="floating-note">
              <ShieldCheck size={19} />
              <div>
                Everyone’s on the same page.<small>Every move, in sync.</small>
              </div>
            </div>
          </div>
        </section>
        <section className="home-bottom">
          <div className="section-intro">
            <span className="eyebrow muted">LESS ADMIN. MORE POKER.</span>
            <h2>
              Good nights start
              <br />
              with a simple setup.
            </h2>
            {!cloudMode && (
              <button
                className="text-link"
                disabled={busy || !hydrated}
                onClick={() =>
                  work(async () => enter(await api<RoomView>("/api/demo", "POST", {})))
                }
              >
                Try a practice table <ArrowRight size={16} />
              </button>
            )}
          </div>
          <div className="feature">
            <span className="feature-icon">
              <Users size={22} />
            </span>
            <small>01 / GATHER</small>
            <h3>Same table. One room.</h3>
            <p>
              Share a code, approve your friends,
              <br />
              and give everyone a seat.
            </p>
          </div>
          <div className="feature">
            <span className="feature-icon">
              <Spade size={21} />
            </span>
            <small>02 / PLAY</small>
            <h3>Every chip accounted for.</h3>
            <p>
              Legal actions, live stacks, side pots.
              <br />
              We’ll take care of the numbers.
            </p>
          </div>
          <div className="feature">
            <span className="feature-icon">
              <Wallet size={21} />
            </span>
            <small>03 / SETTLE</small>
            <h3>End on an even note.</h3>
            <p>
              Clear totals. Fewer transfers.
              <br />
              More time for “one last hand.”
            </p>
          </div>
        </section>
        {error && !modal && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
      <footer className="site-footer">
        <ExternalNote />
        <span>
          No chips. No downloads. Just deal.<span className="footer-spade">♠</span>
        </span>
      </footer>
      {modal && (
        <Modal
          title={
            modal === "create"
              ? "Make room for a good night"
              : modal === "join"
                ? "Pull up a seat"
                : modal === "account"
                  ? "Your sessions"
                  : "Real cards. Shared chips."
          }
          onClose={() => setModal(null)}
        >
          {modal === "create" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                work(async () =>
                  enter(
                    await api<RoomView>("/api/rooms", "POST", {
                      name: roomName,
                      playerName: name,
                      config,
                    }),
                  ),
                );
              }}
            >
              <p className="muted">You’ll host the table and approve everyone who joins.</p>
              <Field label="Your display name">
                <input
                  autoComplete="nickname"
                  required
                  maxLength={24}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should we call you?"
                />
              </Field>
              <Field label="Room name">
                <input
                  required
                  maxLength={40}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Currency">
                  <select
                    value={config.currency}
                    onChange={(e) =>
                      setConfig({ ...config, currency: e.target.value as Config["currency"] })
                    }
                  >
                    <option>HKD</option>
                    <option>IDR</option>
                  </select>
                </Field>
                <Field label="Initial buy-in">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1000000000}
                    required
                    value={config.buyIn}
                    onChange={(e) => setConfig({ ...config, buyIn: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <details className="config-details" open>
                <summary>
                  Blinds & buy-in limits <ChevronRight size={16} />
                </summary>
                <div className="form-grid">
                  {(
                    [
                      ["smallBlind", "Small blind"],
                      ["bigBlind", "Big blind"],
                      ["minBuyIn", "Minimum buy-in"],
                      ["maxBuyIn", "Maximum buy-in"],
                      ["ante", "Ante (0 for none)"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        type="number"
                        inputMode="numeric"
                        required
                        min={key === "ante" ? 0 : 1}
                        max={1000000000}
                        value={config[key]}
                        onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
                      />
                    </Field>
                  ))}
                </div>
              </details>
              <p className="fine-print">
                <LockKeyhole size={13} /> Whole currency units only. No money moves through
                PocketPot.
              </p>
              <button className="button primary full" disabled={busy}>
                {busy ? "Opening your table…" : "Create private room"}
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          {modal === "join" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                work(async () =>
                  enter(await api<RoomView>(`/api/rooms?code=${encodeURIComponent(code.trim())}`)),
                );
              }}
            >
              <p className="muted">
                Get the six-character code from your host. They’ll approve your seat before you can
                see the table.
              </p>
              <Field label="Room code">
                <input
                  className="code-input"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={6}
                  minLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABC234"
                />
              </Field>
              <button className="button primary full" disabled={busy}>
                {busy ? "Finding your room…" : "Find my table"}
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          {modal === "account" && (
            <div className="stack">
              {!supabase ? (
                <>
                  <p>
                    Accounts and saved history are available after connecting Supabase. Local rooms
                    work without an account.
                  </p>
                  <span className="mode-tag">LOCAL DEVELOPMENT</span>
                </>
              ) : (
                <>
                  <p className="muted">
                    Sign in before joining a room to keep your final totals. Signing in with a
                    different identity during play requires host-approved device recovery.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() =>
                      work(async () => {
                        const { error } = await supabase!.auth.signInWithOAuth({
                          provider: "google",
                          options: { redirectTo: location.origin },
                        });
                        if (error) throw error;
                      })
                    }
                  >
                    Continue with Google <ArrowUpRight size={16} />
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      work(async () => {
                        const { error } = await supabase!.auth.signInWithOtp({
                          email,
                          options: { emailRedirectTo: location.origin },
                        });
                        if (error) throw error;
                        setNotice("Check your email for the sign-in link.");
                      });
                    }}
                  >
                    <Field label="Email for a passwordless link">
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </Field>
                    <button className="button secondary full" disabled={busy}>
                      Send sign-in link
                    </button>
                  </form>
                  <button
                    className="text-link"
                    onClick={() => work(async () => setHistory(await api("/api/account")))}
                  >
                    <History size={16} /> Load my saved sessions
                  </button>
                  {history.map((h) => (
                    <div className="history-row" key={h.room_id}>
                      <div>
                        <strong>{h.room_name}</strong>
                        <small>{new Date(h.finalized_at).toLocaleDateString()}</small>
                      </div>
                      <Money amount={h.summary.net} currency={h.currency} signed />
                    </div>
                  ))}
                  <details>
                    <summary>Data & privacy</summary>
                    <p className="fine-print">
                      Detailed room history expires after 90 days. Account summaries persist until
                      you delete them. Other players’ shared ledger records remain until room
                      retention ends.
                    </p>
                    <button
                      className="text-button danger-text"
                      onClick={() =>
                        work(async () => {
                          await api("/api/account", "DELETE", { scope: "history" });
                          setHistory([]);
                          setNotice("Saved summaries deleted.");
                        })
                      }
                    >
                      Delete my saved summaries
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() =>
                        work(async () => {
                          await api("/api/account", "DELETE", { scope: "account" });
                          await supabase!.auth.signOut();
                          setNotice("Account deleted.");
                        })
                      }
                    >
                      Delete my account
                    </button>
                  </details>
                </>
              )}
              {notice && <p className="notice">{notice}</p>}
            </div>
          )}
          {modal === "help" && (
            <div className="stack">
              <p>
                PocketPot replaces physical chips for an in-person No-Limit Texas Hold’em cash game.
              </p>
              <div className="help-row">
                <Users />
                <p>
                  <strong>Gather your people.</strong> Create a room, share its code, and approve
                  each friend.
                </p>
              </div>
              <div className="help-row">
                <Spade />
                <p>
                  <strong>Deal real cards.</strong> Each player records their own action. The host
                  can correct mistakes with undo.
                </p>
              </div>
              <div className="help-row">
                <Wallet />
                <p>
                  <strong>Pick winners, then settle.</strong> The host assigns each pot. At the end,
                  review exact totals and pay outside the app.
                </p>
              </div>
              <p className="fine-print">
                Install from your browser’s menu for a home-screen shortcut. Internet is required
                for synchronized play.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
