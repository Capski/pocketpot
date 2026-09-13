"use client";
import { useEffect, useRef } from "react";
import { X, Spade, ArrowUpRight } from "lucide-react";
import Link from "next/link";
export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">
        <Spade size={21} fill="currentColor" />
      </span>
      Pocket<span className="brand-light">Pot</span>
    </Link>
  );
}
export function Money({
  amount,
  currency = "HKD",
  signed = false,
}: {
  amount: number;
  currency?: string;
  signed?: boolean;
}) {
  return (
    <>
      {signed && amount > 0 ? "+" : ""}
      {currency === "HKD" ? "$" : "Rp "}
      {amount.toLocaleString("en-US")}
    </>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button, [role="dialog"] input, [role="dialog"] select, [role="dialog"] a',
          ),
        ).filter((e) => !e.hasAttribute("disabled"));
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    document.querySelector<HTMLElement>('[role="dialog"] input')?.focus();
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-label={title} className="modal">
        <div className="section-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Pwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
export function ExternalNote() {
  return (
    <p className="fine-print">
      <ArrowUpRight size={13} /> Cards on the table. Payments outside the app.
    </p>
  );
}
