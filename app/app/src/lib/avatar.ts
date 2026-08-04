// Renders a user's avatar into any element with the .avatar class: their uploaded
// photo if they have one, otherwise the initials-based fallback everyone starts with.
// Centralized so every place an avatar shows up (sidebar, user menu, settings) stays
// in sync the moment someone uploads or removes a profile picture.
export function applyAvatar(el: HTMLElement, user: { username: string; avatar?: string | null }): void {
  if (user.avatar) {
    el.style.backgroundImage = `url("${user.avatar}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.textContent = user.username.slice(0, 2).toUpperCase();
  }
}
