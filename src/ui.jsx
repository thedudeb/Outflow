import { useEffect, useRef } from "react";

export function Panel({ title, marker, action, children, className = "" }) {
  return (
    <section className={`min-w-0 border border-zinc-800 bg-black/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}>
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/70 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {marker && <span className="h-3 w-1 shrink-0 bg-amber-400" />}
          <h2 className="truncate text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">{title}</h2>
        </div>
        <div className="min-w-0 shrink truncate text-right">{action}</div>
      </header>
      {children}
    </section>
  );
}

export function StatCell({ label, value, sublabel, tone = "neutral", code }) {
  const toneClass = tone === "hot" ? "text-amber-300" : "text-zinc-50";

  return (
    <section className="relative border border-zinc-800 bg-black/85 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
        {code && <div className="font-mono text-[10px] text-zinc-600">{code}</div>}
      </div>
      <div className={`mt-3 break-words font-mono text-xl font-black leading-tight sm:text-2xl xl:text-3xl ${toneClass}`}>{value}</div>
      <div className="mt-2 border-t border-zinc-900 pt-2 text-xs text-zinc-500">{sublabel}</div>
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <label className="grid gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
      {label}
      {children}
    </label>
  );
}

export function LiveMessage({ kind = "status", className = "", children, ...props }) {
  const alert = kind === "alert";
  return (
    <div
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      aria-atomic="true"
      className={className}
      {...props}
    >
      {children}
    </div>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:border focus:border-amber-400 focus:bg-black focus:px-4 focus:py-3 focus:text-sm focus:font-black focus:uppercase focus:text-amber-300"
    >
      Skip to main content
    </a>
  );
}

export function DialogOverlay({ children, onClose, closeDisabled = false }) {
  function closeFromBackdrop(event) {
    if (event.target === event.currentTarget && !closeDisabled) onClose();
  }

  return (
    <div
      data-dialog-overlay
      onClick={closeFromBackdrop}
      className="fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] place-items-center bg-black/85 p-3 sm:p-6"
    >
      {children}
    </div>
  );
}

const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogLifecycle(open, onClose, closeDisabled = false) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const overlay = dialog.parentElement;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const backgroundNodes = overlay?.parentElement
      ? [...overlay.parentElement.children]
        .filter((node) => node !== overlay)
        .map((node) => ({ node, inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") }))
      : [];

    const focusableElements = () => [...dialog.querySelectorAll(dialogFocusableSelector)]
      .filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
    const initialFocus = dialog.querySelector("[data-dialog-initial-focus]") || focusableElements()[0] || dialog;
    initialFocus.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    backgroundNodes.forEach(({ node }) => {
      node.setAttribute("inert", "");
      node.setAttribute("aria-hidden", "true");
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (closeDisabledRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      backgroundNodes.forEach(({ node, inert, ariaHidden }) => {
        if (!inert) node.removeAttribute("inert");
        if (ariaHidden === null) node.removeAttribute("aria-hidden");
        else node.setAttribute("aria-hidden", ariaHidden);
      });
      window.requestAnimationFrame(() => {
        if (!document.querySelector('[role="dialog"][aria-modal="true"]') && returnFocus?.isConnected) {
          returnFocus.focus({ preventScroll: true });
        }
      });
    };
  }, [open]);

  return dialogRef;
}
