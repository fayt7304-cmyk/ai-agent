import { api, type User } from "./api";
import { initTheme, setTheme } from "./theme";
import { showAuthScreen, hideAuthScreen, initAuthView, openClaimScreen, openLoginScreen } from "./auth-view";
import { initChatView, updateChatUser, resetChatView } from "./chat-view";
import { initSettingsView, openSettings } from "./settings-view";
import { initLeadView } from "./lead-view";
import { initToolsView } from "./tools-view";
import { applyAvatar } from "./lib/avatar";

initLeadView();
initToolsView();

// Apply a theme immediately so there's no flash before we know if anyone is logged in.
initTheme();

// Register the service worker (app-shell caching, installability). Safe no-op if unsupported.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// PWA install prompt: browsers fire this instead of showing their own UI, so we can
// surface our own "Install" button and only ask the browser to show the prompt then.
let deferredInstallPrompt: any = null;
const installBtn = document.getElementById("install-app-btn") as HTMLButtonElement | null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBtn) installBtn.style.display = "inline-flex";
});
installBtn?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.style.display = "none";
});
window.addEventListener("appinstalled", () => {
  if (installBtn) installBtn.style.display = "none";
});

const appShell = document.getElementById("app-shell") as HTMLDivElement;
const userMenuBtn = document.getElementById("user-menu-btn") as HTMLButtonElement;
const userMenu = document.getElementById("user-menu") as HTMLDivElement;
const menuAvatar = document.getElementById("menu-avatar") as HTMLSpanElement;
const menuUsername = document.getElementById("menu-username") as HTMLDivElement;
const menuEmail = document.getElementById("menu-email") as HTMLDivElement;
const themeIconBtns = document.querySelectorAll<HTMLButtonElement>(".theme-icon-btn");
const openSettingsBtn = document.getElementById("open-settings-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;
const saveAccountBtn = document.getElementById("save-account-btn") as HTMLButtonElement;
const loginMenuBtn = document.getElementById("login-menu-btn") as HTMLButtonElement;
const guestBadge = document.getElementById("guest-badge") as HTMLSpanElement;
const guestBanner = document.getElementById("guest-banner") as HTMLDivElement;
const guestBannerSaveBtn = document.getElementById("guest-banner-save-btn") as HTMLButtonElement;
const guestBannerDismissBtn = document.getElementById("guest-banner-dismiss-btn") as HTMLButtonElement;
const GUEST_BANNER_DISMISSED_KEY = "guest-banner-dismissed";

let currentUser: User | null = null;
let chatInitialized = false;

function refreshGuestUi(user: User) {
  guestBadge.style.display = user.is_guest ? "inline-flex" : "none";
  saveAccountBtn.style.display = user.is_guest ? "block" : "none";
  loginMenuBtn.style.display = user.is_guest ? "block" : "none";
  const dismissed = sessionStorage.getItem(GUEST_BANNER_DISMISSED_KEY) === "1";
  guestBanner.style.display = user.is_guest && !dismissed ? "flex" : "none";
}

function refreshUserMenu(user: User) {
  applyAvatar(menuAvatar, user);
  menuUsername.textContent = user.display_name || user.username;
  menuEmail.textContent = user.email || (user.is_guest ? "Guest session" : "No email on file");
  themeIconBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeOption === user.theme);
  });
}

function enterApp(user: User) {
  currentUser = user;
  setTheme(user.theme);
  hideAuthScreen();
  appShell.style.display = "flex";
  refreshGuestUi(user);
  refreshUserMenu(user);
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
  // Never leave someone stranded on a login form — drop them straight back
  // into a fresh guest session instead.
  enterAsGuest();
}

function enterAsGuest() {
  api
    .guestLogin()
    .then(({ user }) => enterApp(user))
    .catch(() => showAuthScreen());
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

themeIconBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const theme = btn.dataset.themeOption as "light" | "dark" | "system";
    themeIconBtns.forEach((b) => b.classList.toggle("active", b === btn));
    setTheme(theme);
    if (!currentUser) return;
    try {
      const { user } = await api.updateSettings({ theme });
      currentUser = user;
      refreshUserMenu(user);
    } catch {
      // Best-effort — the theme is already applied locally even if the save fails.
    }
  });
});

logoutBtn.addEventListener("click", async () => {
  userMenu.style.display = "none";
  await api.logout().catch(() => {});
  exitApp();
});

saveAccountBtn.addEventListener("click", () => {
  userMenu.style.display = "none";
  if (currentUser) {
    appShell.style.display = "none";
    openClaimScreen(currentUser, undefined, () => (appShell.style.display = "flex"));
  }
});

loginMenuBtn.addEventListener("click", () => {
  userMenu.style.display = "none";
  appShell.style.display = "none";
  openLoginScreen(() => (appShell.style.display = "flex"));
});

guestBannerSaveBtn.addEventListener("click", () => {
  if (currentUser) {
    appShell.style.display = "none";
    openClaimScreen(currentUser, undefined, () => (appShell.style.display = "flex"));
  }
});

guestBannerDismissBtn.addEventListener("click", () => {
  sessionStorage.setItem(GUEST_BANNER_DISMISSED_KEY, "1");
  guestBanner.style.display = "none";
});

initAuthView(
  (user) => enterApp(user),
  () => enterAsGuest()
);
initSettingsView((user) => {
  currentUser = user;
  setTheme(user.theme);
  refreshGuestUi(user);
  refreshUserMenu(user);
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
  // No valid session yet — rather than stopping people at a login wall, drop
  // them straight into a working guest session. They can save it into a real
  // account any time from the user menu, with nothing lost.
  .catch(() => enterAsGuest());