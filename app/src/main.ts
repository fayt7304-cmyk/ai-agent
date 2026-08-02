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

// Bootstrap: is there already a valid session cookie?
api
  .me()
  .then(({ user }) => enterApp(user))
  .catch(() => showAuthScreen());
