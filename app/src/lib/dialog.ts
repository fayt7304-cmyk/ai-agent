/**
 * In-app dialogs that replace the browser's native prompt()/confirm().
 *
 * The native popups can't be styled, look out of place (especially on iOS where
 * they render as a system sheet with the site's hostname), and on some mobile
 * browsers they get suppressed entirely — which made "rename" and "delete"
 * silently do nothing. These render inside the app instead, using the same
 * design tokens as the rest of the UI.
 */

import { t } from "./i18n";

type Resolver<T> = (value: T) => void;

let overlayEl: HTMLDivElement | null = null;
let cleanup: (() => void) | null = null;

function buildOverlay(): HTMLDivElement {
  if (overlayEl) return overlayEl;
  const el = document.createElement("div");
  el.className = "app-dialog-overlay";
  el.setAttribute("role", "presentation");
  document.body.appendChild(el);
  overlayEl = el;
  return el;
}

function closeDialog() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  if (overlayEl) {
    overlayEl.classList.remove("visible");
    overlayEl.innerHTML = "";
  }
}

interface DialogOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When provided, the dialog renders a text input pre-filled with this value. */
  inputValue?: string;
  inputPlaceholder?: string;
  inputMaxLength?: number;
}

function openDialog<T>(opts: DialogOptions, resolve: Resolver<T>, resolveWith: (input: string | null) => T) {
  closeDialog();

  const overlay = buildOverlay();
  const card = document.createElement("div");
  card.className = "app-dialog" + (opts.danger ? " danger" : "");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const heading = document.createElement("h3");
  heading.className = "app-dialog-title";
  heading.textContent = opts.title;
  card.appendChild(heading);

  if (opts.message) {
    const msg = document.createElement("p");
    msg.className = "app-dialog-message";
    msg.textContent = opts.message;
    card.appendChild(msg);
  }

  let input: HTMLInputElement | null = null;
  if (opts.inputValue !== undefined) {
    input = document.createElement("input");
    input.type = "text";
    input.className = "app-dialog-input";
    input.value = opts.inputValue;
    if (opts.inputPlaceholder) input.placeholder = opts.inputPlaceholder;
    input.maxLength = opts.inputMaxLength ?? 120;
    card.appendChild(input);
  }

  const actions = document.createElement("div");
  actions.className = "app-dialog-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "app-dialog-btn secondary";
  cancelBtn.textContent = opts.cancelLabel || t("dialog.cancel");

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "app-dialog-btn " + (opts.danger ? "danger" : "primary");
  confirmBtn.textContent = opts.confirmLabel || t("dialog.confirm");

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);

  overlay.innerHTML = "";
  overlay.appendChild(card);
  overlay.classList.add("visible");

  let settled = false;
  const settle = (value: T) => {
    if (settled) return;
    settled = true;
    closeDialog();
    resolve(value);
  };

  const onCancel = () => settle(resolveWith(null));
  const onConfirm = () => settle(resolveWith(input ? input.value : ""));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (input || e.target === confirmBtn)) {
      e.preventDefault();
      onConfirm();
    }
  };
  const onOverlayClick = (e: MouseEvent) => {
    if (e.target === overlay) onCancel();
  };

  cancelBtn.addEventListener("click", onCancel);
  confirmBtn.addEventListener("click", onConfirm);
  overlay.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onKeyDown);

  cleanup = () => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.removeEventListener("click", onOverlayClick);
  };

  // Focus the most useful control: the text field when renaming, otherwise the
  // confirm button so Enter/Space works straight away for keyboard users.
  setTimeout(() => {
    if (input) {
      input.focus();
      input.select();
    } else {
      confirmBtn.focus();
    }
  }, 20);
}

/** Styled replacement for window.confirm(). Resolves true when confirmed. */
export function showConfirm(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    openDialog<boolean>(opts, resolve, (value) => value !== null);
  });
}

/** Styled replacement for window.prompt(). Resolves the trimmed text, or null when cancelled. */
export function showPrompt(opts: {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
}): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    openDialog<string | null>(
      {
        title: opts.title,
        ...(opts.message !== undefined ? { message: opts.message } : {}),
        ...(opts.confirmLabel !== undefined ? { confirmLabel: opts.confirmLabel } : {}),
        ...(opts.cancelLabel !== undefined ? { cancelLabel: opts.cancelLabel } : {}),
        inputValue: opts.value ?? "",
        ...(opts.placeholder !== undefined ? { inputPlaceholder: opts.placeholder } : {}),
        ...(opts.maxLength !== undefined ? { inputMaxLength: opts.maxLength } : {}),
      },
      resolve,
      (value) => {
        if (value === null) return null;
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
      }
    );
  });
}
