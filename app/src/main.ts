import { api, type User } from "./api";
import { initTheme, setTheme } from "./theme";
import { showAuthScreen, hideAuthScreen, initAuthView } from "./auth-view";
import { initChatView, updateChatUser, resetChatView } from "./chat-view";
import { initSettingsView, openSettings } from "./settings-view";

// Apply a theme immediately so there's no flash before we know if anyone is logged in.
initTheme();

const appShell = document.getElementById("app-shell") as HTMLDivElement;
const userMenuBtn = document.getElementById("user-menu-btn") as HTMLButtonElement;
const userMenu = document.getElementById("user-menu") as HTMLDivElement;
const openSettingsBtn = document.getElementById("open-settings-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;

let currentUser: User | null = null;
let chatInitialized = false;

function enterApp(user: User) {
  currentUser = user;
  setTheme(user.theme);
  hideAuthScreen();
  appShell.style.display = "flex";
  if (!chatInitialized) {
    initChatView(user);
    chatInitialized = true;
  } else {
    updateChatUser(user);
  }
}

function exitApp() {
  currentUser = null;
  appShell.style.display = "none";
  resetChatView();
  chatInitialized = false;
  showAuthScreen();
}

userMenuBtn.addEventListener("click", () => {
  userMenu.style.display = userMenu.style.display === "none" ? "block" : "none";
});

document.addEventListener("click", (e) => {
  if (!userMenuBtn.contains(e.target as Node) && !userMenu.contains(e.target as Node)) {
    userMenu.style.display = "none";
  }
});

openSettingsBtn.addEventListener("click", () => {
  userMenu.style.display = "none";
  if (currentUser) openSettings(currentUser);
});

logoutBtn.addEventListener("click", async () => {
  userMenu.style.display = "none";
  await api.logout().catch(() => {});
  exitApp();
});

initAuthView((user) => enterApp(user));
initSettingsView((user) => {
  currentUser = user;
  setTheme(user.theme);
  updateChatUser(user);
});

// If we just came back from linking (or trying to link) a Google account, pull the
// status out of the URL and clean it up so it doesn't stick around on refresh/share.
const redirectParams = new URLSearchParams(window.location.search);
const linked = redirectParams.get("linked");
const linkError = redirectParams.get("link_error");
if (linked || linkError) {
  window.history.replaceState({}, "", window.location.pathname);
}

// Bootstrap: is there already a valid session cookie?
api
  .me()
  .then(({ user }) => {
    enterApp(user);
    if (linked === "google") {
      openSettings(user, "Google account connected.");
    } else if (linkError) {
      const message =
        linkError === "already_linked"
          ? "That Google account is already linked to a different user."
          : "Could not connect Google — please try again.";
      openSettings(user, undefined);
      document.getElementById("settings-error")!.textContent = message;
    }
  })
  .catch(() => showAuthScreen());
