import { api, ApiError, type User } from "./api";

const authScreen = document.getElementById("auth-screen") as HTMLDivElement;
const authTabs = document.getElementById("auth-tabs") as HTMLDivElement;
const loginForm = document.getElementById("login-form") as HTMLFormElement;
const signupForm = document.getElementById("signup-form") as HTMLFormElement;
const loginError = document.getElementById("login-error") as HTMLDivElement;
const signupError = document.getElementById("signup-error") as HTMLDivElement;

export function showAuthScreen() {
  authScreen.style.display = "flex";
}

export function hideAuthScreen() {
  authScreen.style.display = "none";
}

export function initAuthView(onAuthenticated: (user: User) => void) {
  authTabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      authTabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.dataset.authTab;
      loginForm.style.display = which === "login" ? "flex" : "none";
      signupForm.style.display = which === "signup" ? "flex" : "none";
      loginError.textContent = "";
      signupError.textContent = "";
    });
  });

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
    const password = (document.getElementById("signup-password") as HTMLInputElement).value;
    const btn = signupForm.querySelector("button[type=submit]") as HTMLButtonElement;
    btn.disabled = true;
    try {
      const { user } = await api.signup(username, password);
      signupForm.reset();
      onAuthenticated(user);
    } catch (err) {
      signupError.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
    } finally {
      btn.disabled = false;
    }
  });
}
