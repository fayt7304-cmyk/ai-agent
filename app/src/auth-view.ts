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

function showForm(which: "login" | "signup" | "forgot" | "reset") {
  loginForm.style.display = which === "login" ? "flex" : "none";
  signupForm.style.display = which === "signup" ? "flex" : "none";
  forgotForm.style.display = which === "forgot" ? "flex" : "none";
  resetForm.style.display = which === "reset" ? "flex" : "none";
  authTabs.style.display = which === "login" || which === "signup" ? "flex" : "none";
}

export function showAuthScreen() {
  authScreen.style.display = "flex";
}

export function hideAuthScreen() {
  authScreen.style.display = "none";
}

export function initAuthView(onAuthenticated: (user: User) => void) {
  googleBtn.href = api.googleLoginUrl();

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
    const btn = signupForm.querySelector("button[type=submit]") as HTMLButtonElement;
    btn.disabled = true;
    try {
      const { user } = await api.signup(username, email, password);
      signupForm.reset();
      onAuthenticated(user);
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
