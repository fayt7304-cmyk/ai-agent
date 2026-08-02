import { api, ApiError, type User } from "./api";

const authScreen = document.getElementById("auth-screen") as HTMLDivElement;
const authTabs = document.getElementById("auth-tabs") as HTMLDivElement;
const loginForm = document.getElementById("login-form") as HTMLFormElement;
const signupForm = document.getElementById("signup-form") as HTMLFormElement;
const forgotForm = document.getElementById("forgot-form") as HTMLFormElement;
const resetForm = document.getElementById("reset-form") as HTMLFormElement;
const loginError = document.getElementById("login-error") as HTMLDivElement;
const signupError = document.getElementById("signup-error") as HTMLDivElement;
const forgotError = document.getElementById("forgot-error") as HTMLDivElement;
const forgotSuccess = document.getElementById("forgot-success") as HTMLDivElement;
const resetError = document.getElementById("reset-error") as HTMLDivElement;
const googleBtn = document.getElementById("google-login-btn") as HTMLAnchorElement;
const forgotLink = document.getElementById("forgot-password-link") as HTMLButtonElement;
const backToLoginLink = document.getElementById("back-to-login-link") as HTMLButtonElement;
const guestContinueBtn = document.getElementById("guest-continue-btn") as HTMLButtonElement;
const authCloseBtn = document.getElementById("auth-close-btn") as HTMLButtonElement;
const authTitle = document.getElementById("auth-title") as HTMLHeadingElement;
const authSubtitle = document.getElementById("auth-subtitle") as HTMLParagraphElement;
const signupSubmitBtn = signupForm.querySelector("button[type=submit]") as HTMLButtonElement;

// "login" = the normal sign-in/sign-up screen shown before anyone is authenticated.
// "claim" = a guest session turning itself into a real account in place (same form,
// different endpoint + a way to back out and keep browsing as a guest).
let mode: "login" | "claim" = "login";
let onClaimCancelled: (() => void) | null = null;

function showForm(which: "login" | "signup" | "forgot" | "reset") {
  loginForm.style.display = which === "login" ? "flex" : "none";
  signupForm.style.display = which === "signup" ? "flex" : "none";
  forgotForm.style.display = which === "forgot" ? "flex" : "none";
  resetForm.style.display = which === "reset" ? "flex" : "none";
  authTabs.style.display = mode === "claim" ? "none" : which === "login" || which === "signup" ? "flex" : "none";
}

function resetToLoginMode() {
  mode = "login";
  onClaimCancelled = null;
  guestContinueBtn.style.display = "block";
  authCloseBtn.style.display = "none";
  authTitle.textContent = "Agent";
  authSubtitle.textContent = "Powered by Mistral · your account, your server";
  signupSubmitBtn.textContent = "Create account";
  authTabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  authTabs.querySelector('[data-auth-tab="login"]')?.classList.add("active");
  showForm("login");
}

export function showAuthScreen() {
  authScreen.style.display = "flex";
}

export function hideAuthScreen() {
  authScreen.style.display = "none";
}

// Lets a guest turn their session into a real, logged-in account without losing
// their chat history — same signup form, but it calls claimAccount instead of
// signup, and offers a way back out (onCancelled) instead of the usual guest link.
export function openClaimScreen(user: User, message?: string, onCancelled?: () => void) {
  mode = "claim";
  onClaimCancelled = onCancelled || null;
  signupError.textContent = "";
  guestContinueBtn.style.display = "none";
  authCloseBtn.style.display = "inline-flex";
  authTitle.textContent = "Save your account";
  authSubtitle.textContent = message || "Add a username, email, and password so you can log back in on any device.";
  signupSubmitBtn.textContent = "Save account";
  const usernameInput = document.getElementById("signup-username") as HTMLInputElement;
  if (user.username && !user.username.toLowerCase().startsWith("guest")) usernameInput.value = user.username;
  showAuthScreen();
  showForm("signup");
}

// Lets someone already in the app (almost always a guest) reach the normal
// log in / sign up form on purpose — e.g. they already have a separate real
// account and want to switch to it. Distinct from openClaimScreen: this signs
// into a *different* account rather than upgrading the current session, and
// it can be dismissed (via the ✕) to go right back to whatever they were doing.
export function openLoginScreen(onCancelled?: () => void) {
  mode = "login";
  onClaimCancelled = onCancelled || null;
  loginError.textContent = "";
  signupError.textContent = "";
  guestContinueBtn.style.display = "none";
  authCloseBtn.style.display = "inline-flex";
  authTitle.textContent = "Log in";
  authSubtitle.textContent = "Log in to an existing account, or create a new one.";
  signupSubmitBtn.textContent = "Create account";
  authTabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  authTabs.querySelector('[data-auth-tab="login"]')?.classList.add("active");
  showAuthScreen();
  showForm("login");
}

export function initAuthView(onAuthenticated: (user: User) => void, onContinueAsGuest: () => void) {
  googleBtn.href = api.googleLoginUrl();

  guestContinueBtn.addEventListener("click", () => onContinueAsGuest());

  authCloseBtn.addEventListener("click", () => {
    hideAuthScreen();
    const cancelled = onClaimCancelled;
    resetToLoginMode();
    cancelled?.();
  });

  authTabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      authTabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      showForm(tab.dataset.authTab as "login" | "signup");
      loginError.textContent = "";
      signupError.textContent = "";
    });
  });

  forgotLink.addEventListener("click", () => showForm("forgot"));
  backToLoginLink.addEventListener("click", () => showForm("login"));

  // If we landed here via a password-reset email link, jump straight to the reset form.
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("reset_token");
  if (resetToken) {
    showForm("reset");
    resetForm.dataset.token = resetToken;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    const username = (document.getElementById("login-username") as HTMLInputElement).value.trim();
    const password = (document.getElementById("login-password") as HTMLInputElement).value;
    const btn = loginForm.querySelector("button[type=submit]") as HTMLButtonElement;
    btn.disabled = true;
    try {
      const { user } = await api.login(username, password);
      loginForm.reset();
      onAuthenticated(user);
    } catch (err) {
      loginError.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
    } finally {
      btn.disabled = false;
    }
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    signupError.textContent = "";
    const username = (document.getElementById("signup-username") as HTMLInputElement).value.trim();
    const email = (document.getElementById("signup-email") as HTMLInputElement).value.trim();
    const password = (document.getElementById("signup-password") as HTMLInputElement).value;
    const btn = signupSubmitBtn;
    btn.disabled = true;
    try {
      const { user } = mode === "claim" ? await api.claimAccount(username, email, password) : await api.signup(username, email, password);
      signupForm.reset();
      const wasClaimMode = mode === "claim";
      resetToLoginMode();
      onAuthenticated(user);
      if (wasClaimMode) hideAuthScreen();
    } catch (err) {
      signupError.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
    } finally {
      btn.disabled = false;
    }
  });

  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    forgotError.textContent = "";
    forgotSuccess.textContent = "";
    const email = (document.getElementById("forgot-email") as HTMLInputElement).value.trim();
    const btn = forgotForm.querySelector("button[type=submit]") as HTMLButtonElement;
    btn.disabled = true;
    try {
      await api.forgotPassword(email);
      forgotSuccess.textContent = "If that email is registered, a reset link is on its way.";
      forgotForm.reset();
    } catch (err) {
      forgotError.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
    } finally {
      btn.disabled = false;
    }
  });

  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    resetError.textContent = "";
    const password = (document.getElementById("reset-password") as HTMLInputElement).value;
    const token = resetForm.dataset.token || "";
    const btn = resetForm.querySelector("button[type=submit]") as HTMLButtonElement;
    btn.disabled = true;
    try {
      await api.resetPassword(token, password);
      window.history.replaceState({}, "", window.location.pathname);
      resetForm.reset();
      showForm("login");
      loginError.textContent = "Password updated. Please log in.";
    } catch (err) {
      resetError.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
    } finally {
      btn.disabled = false;
    }
  });
}
