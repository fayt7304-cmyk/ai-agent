import { api, type User } from "./api";
import { initTheme, setTheme } from "./theme";
import { initI18n, t, setLang, getStoredLang, type Lang } from "./lib/i18n";
import { icons } from "./lib/icons";
import { showAuthScreen, hideAuthScreen, initAuthView, openClaimScreen, openLoginScreen } from "./auth-view";
import { initChatView, updateChatUser, resetChatView } from "./chat-view";
import { initSettingsView, openSettings } from "./settings-view";
import { initLeadView } from "./lead-view";
import { initToolsView } from "./tools-view";
import { applyAvatar } from "./lib/avatar";
import { initPreferences } from "./lib/preferences";
import { warmBrowserVoices } from "./lib/speech";

// Apply the language + text direction immediately, before anything else touches the
// DOM, so there's no flash of English/LTR before we know the stored preference.
initI18n();

initLeadView();
initToolsView();

// Apply a theme immediately so there's no flash before we know if anyone is logged in.
initTheme();

// Apply user preferences (animations, fonts, voice settings)
initPreferences();

// Preload speechSynthesis voices so the first "Read aloud" is not blocked on
// Chrome's async voiceschanged event.
void warmBrowserVoices();

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
const sidebar = document.getElementById("sidebar") as HTMLDivElement;
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

const learnMoreWrap = document.getElementById("learn-more-wrap") as HTMLDivElement;
const learnMoreBtn = document.getElementById("learn-more-btn") as HTMLButtonElement;
const learnMoreSubmenu = document.getElementById("learn-more-submenu") as HTMLDivElement;
const languageMenuWrap = document.getElementById("language-menu-wrap") as HTMLDivElement;
const languageMenuBtn = document.getElementById("language-menu-btn") as HTMLButtonElement;
const languageSubmenu = document.getElementById("language-submenu") as HTMLDivElement;
const keyboardShortcutsBtn = document.getElementById("keyboard-shortcuts-btn") as HTMLButtonElement;
const shortcutsOverlay = document.getElementById("shortcuts-overlay") as HTMLDivElement;
const shortcutsCloseBtn = document.getElementById("shortcuts-close-btn") as HTMLButtonElement;

const privacyChoicesBtn = document.getElementById("privacy-choices-btn") as HTMLButtonElement;
const cookieOverlay = document.getElementById("cookie-overlay") as HTMLDivElement;
const cookieCustomize = document.getElementById("cookie-customize") as HTMLDivElement;
const cookieCustomizeBtn = document.getElementById("cookie-customize-btn") as HTMLButtonElement;
const cookieAnalyticsToggle = document.getElementById("cookie-analytics-toggle") as HTMLInputElement;
const cookieRejectBtn = document.getElementById("cookie-reject-btn") as HTMLButtonElement;
const cookieAcceptBtn = document.getElementById("cookie-accept-btn") as HTMLButtonElement;
const COOKIE_CONSENT_KEY = "cookie-consent";

// Every emoji-as-icon spot that isn't already covered by chat-view.ts's own
// mountStaticIcons() — user menu, theme row, tool grid, and the various modal
// close/back buttons — gets its SVG mounted here in one pass.
function mountGlobalIcons() {
  document.querySelector("#save-account-btn .menu-icon")!.innerHTML = icons.bookmark;
  document.querySelector("#login-menu-btn .menu-icon")!.innerHTML = icons.key;
  document.querySelector("#open-settings-btn .menu-icon")!.innerHTML = icons.gear;
  document.querySelector("#language-menu-btn .menu-icon")!.innerHTML = icons.globe;
  document.querySelector("#learn-more-btn .menu-icon")!.innerHTML = icons.lightbulb;
  document.querySelector("#keyboard-shortcuts-btn .menu-icon")!.innerHTML = icons.keyboard;
  document.querySelector("#privacy-choices-btn .menu-icon")!.innerHTML = icons.lock;
  document.querySelector("#logout-btn .menu-icon")!.innerHTML = icons.logout;

  document.querySelector('[data-theme-option="light"]')!.innerHTML = icons.sun;
  document.querySelector('[data-theme-option="dark"]')!.innerHTML = icons.moon;
  document.querySelector('[data-theme-option="system"]')!.innerHTML = icons.monitor;

  const toolIcons: Record<string, string> = {
    convert: icons.image,
    bgremove: icons.scissors,
    ocr: icons.textRecognize,
    pdf2word: icons.fileDoc,
    docx: icons.pencil,
    uconvert: icons.grid,
  };
  document.querySelectorAll<HTMLElement>(".tool-card").forEach((card) => {
    const tab = card.getAttribute("data-tool-tab");
    const iconEl = card.querySelector(".tool-card-icon");
    if (tab && iconEl && toolIcons[tab]) iconEl.innerHTML = toolIcons[tab];
  });

  document.getElementById("tools-back-btn")!.innerHTML = icons.chevronLeft;
  document.getElementById("avatar-upload-btn")!.innerHTML = icons.camera;
  const leadPhotoIcon = document.querySelector(".photo-picker-btn-icon");
  if (leadPhotoIcon) leadPhotoIcon.innerHTML = icons.camera;

  [
    "auth-close-btn",
    "settings-close-btn",
    "tools-close-btn",
    "lead-close-btn",
    "lead-photo-remove",
    "guest-banner-dismiss-btn",
    "shortcuts-close-btn",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icons.close;
  });

  const swapBtn = document.getElementById("conv-swap");
  if (swapBtn) swapBtn.innerHTML = icons.swap;
}
mountGlobalIcons();

let currentUser: User | null = null;
let chatInitialized = false;

function refreshGuestUi(user: User) {
  guestBadge.style.display = user.is_guest ? "inline-flex" : "none";
  // Use "" so the stylesheet's `display: flex` applies — forcing "block"
  // broke icon/label alignment vs Settings / Learn more / Log out.
  saveAccountBtn.style.display = user.is_guest ? "" : "none";
  loginMenuBtn.style.display = user.is_guest ? "" : "none";
  const dismissed = sessionStorage.getItem(GUEST_BANNER_DISMISSED_KEY) === "1";
  guestBanner.style.display = user.is_guest && !dismissed ? "flex" : "none";
}

function syncLanguageMenuChecks() {
  const current = getStoredLang();
  languageSubmenu.querySelectorAll<HTMLButtonElement>(".lang-option").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.lang === current);
  });
}

function refreshUserMenu(user: User) {
  applyAvatar(menuAvatar, user);
  menuUsername.textContent = user.display_name || user.username;
  // Claude-style: primary line is email (or username when none).
  menuEmail.textContent =
    user.email || (user.is_guest ? t("sidebar.guest") : user.display_name || user.username);
  menuUsername.style.display = user.email ? "" : "none";
  themeIconBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeOption === user.theme);
  });
  syncLanguageMenuChecks();
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

function setUserMenuOpen(open: boolean) {
  userMenu.style.display = open ? "block" : "none";
  // The sidebar normally clips horizontal overflow (needed so the collapse/expand
  // width transition doesn't flash a scrollbar). But that same clipping cuts off
  // this menu whenever it needs to be wider than the collapsed 64px rail — so lift
  // the clip only while the menu is actually open.
  sidebar.classList.toggle("menu-open", open);
  if (!open) {
    learnMorePinned = false;
    learnMoreSubmenu.style.display = "none";
  }
}

userMenuBtn.addEventListener("click", () => {
  setUserMenuOpen(userMenu.style.display === "none");
});

document.addEventListener("click", (e) => {
  if (!userMenuBtn.contains(e.target as Node) && !userMenu.contains(e.target as Node)) {
    setUserMenuOpen(false);
  }
});

openSettingsBtn.addEventListener("click", () => {
  setUserMenuOpen(false);
  if (currentUser) openSettings(currentUser);
});

let learnMoreCloseTimer: ReturnType<typeof setTimeout> | null = null;
let languageCloseTimer: ReturnType<typeof setTimeout> | null = null;
let learnMorePinned = false;
let languagePinned = false;

function openLearnMore() {
  if (learnMoreCloseTimer) {
    clearTimeout(learnMoreCloseTimer);
    learnMoreCloseTimer = null;
  }
  // Only one flyout open at a time.
  closeLanguage(0, true);
  languagePinned = false;
  learnMoreSubmenu.style.display = "block";
}

function closeLearnMore(delay = 0, force = false) {
  if (!force && learnMorePinned) return;
  if (learnMoreCloseTimer) clearTimeout(learnMoreCloseTimer);
  learnMoreCloseTimer = setTimeout(() => {
    learnMoreSubmenu.style.display = "none";
    learnMoreCloseTimer = null;
  }, delay);
}

function openLanguage() {
  if (languageCloseTimer) {
    clearTimeout(languageCloseTimer);
    languageCloseTimer = null;
  }
  closeLearnMore(0, true);
  learnMorePinned = false;
  syncLanguageMenuChecks();
  languageSubmenu.style.display = "block";
}

function closeLanguage(delay = 0, force = false) {
  if (!force && languagePinned) return;
  if (languageCloseTimer) clearTimeout(languageCloseTimer);
  languageCloseTimer = setTimeout(() => {
    languageSubmenu.style.display = "none";
    languageCloseTimer = null;
  }, delay);
}

learnMoreWrap.addEventListener("mouseenter", openLearnMore);
learnMoreWrap.addEventListener("mouseleave", () => closeLearnMore(150));
learnMoreSubmenu.addEventListener("mouseenter", openLearnMore);
learnMoreSubmenu.addEventListener("mouseleave", () => closeLearnMore(150));

learnMoreBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (learnMorePinned) {
    learnMorePinned = false;
    closeLearnMore(0, true);
  } else {
    learnMorePinned = true;
    openLearnMore();
  }
});

languageMenuWrap.addEventListener("mouseenter", openLanguage);
languageMenuWrap.addEventListener("mouseleave", () => closeLanguage(150));
languageSubmenu.addEventListener("mouseenter", openLanguage);
languageSubmenu.addEventListener("mouseleave", () => closeLanguage(150));

languageMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (languagePinned) {
    languagePinned = false;
    closeLanguage(0, true);
  } else {
    languagePinned = true;
    openLanguage();
  }
});

languageSubmenu.querySelectorAll<HTMLButtonElement>(".lang-option").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const lang = btn.dataset.lang as Lang | undefined;
    if (!lang) return;
    setLang(lang);
    syncLanguageMenuChecks();
    languagePinned = false;
    closeLanguage(0, true);
    // Keep the settings language select in sync if it's on the page.
    const sel = document.getElementById("language-select") as HTMLSelectElement | null;
    if (sel) sel.value = lang;
  });
});

document.addEventListener("langchange", () => syncLanguageMenuChecks());
syncLanguageMenuChecks();

function closeShortcuts() {
  shortcutsOverlay.style.display = "none";
}

keyboardShortcutsBtn.addEventListener("click", () => {
  setUserMenuOpen(false);
  shortcutsOverlay.style.display = "flex";
});
shortcutsCloseBtn.addEventListener("click", closeShortcuts);
shortcutsOverlay.addEventListener("click", (e) => {
  if (e.target === shortcutsOverlay) closeShortcuts();
});

function closeCookieModal() {
  cookieOverlay.style.display = "none";
  cookieCustomize.style.display = "none";
  cookieCustomizeBtn.textContent = cookieCustomizeBtn.dataset.defaultLabel || cookieCustomizeBtn.textContent || "";
}

function openCookieModal() {
  cookieOverlay.style.display = "flex";
}

function saveCookieConsent(choice: "all" | "rejected" | "custom", analytics: boolean) {
  try {
    localStorage.setItem(
      COOKIE_CONSENT_KEY,
      JSON.stringify({ choice, essential: true, analytics, date: new Date().toISOString() })
    );
  } catch {
    // Best-effort — if storage is unavailable the choice just won't persist across visits.
  }
}

privacyChoicesBtn.addEventListener("click", () => {
  setUserMenuOpen(false);
  // Re-opening always starts from the plain accept/reject view — the customize
  // panel only needs to expand when someone actively asks for it.
  cookieCustomize.style.display = "none";
  openCookieModal();
});

cookieCustomizeBtn.dataset.defaultLabel = cookieCustomizeBtn.textContent || "";
cookieCustomizeBtn.addEventListener("click", () => {
  const showing = cookieCustomize.style.display !== "none";
  if (!showing) {
    cookieCustomize.style.display = "flex";
    cookieCustomizeBtn.dataset.defaultLabel = cookieCustomizeBtn.dataset.defaultLabel || cookieCustomizeBtn.textContent || "";
    cookieCustomizeBtn.textContent = t("cookie.savePreferences");
  } else {
    saveCookieConsent("custom", cookieAnalyticsToggle.checked);
    closeCookieModal();
  }
});

cookieRejectBtn.addEventListener("click", () => {
  saveCookieConsent("rejected", false);
  closeCookieModal();
});

cookieAcceptBtn.addEventListener("click", () => {
  saveCookieConsent("all", true);
  closeCookieModal();
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
  setUserMenuOpen(false);
  await api.logout().catch(() => {});
  exitApp();
});

saveAccountBtn.addEventListener("click", () => {
  setUserMenuOpen(false);
  if (currentUser) {
    appShell.style.display = "none";
    openClaimScreen(currentUser, undefined, () => (appShell.style.display = "flex"));
  }
});

loginMenuBtn.addEventListener("click", () => {
  setUserMenuOpen(false);
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

function maybeShowCookieBanner() {
  try {
    if (!localStorage.getItem(COOKIE_CONSENT_KEY)) openCookieModal();
  } catch {
    // No localStorage access — just skip the banner rather than error out.
  }
}

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
  .catch(() => enterAsGuest())
  .finally(maybeShowCookieBanner);