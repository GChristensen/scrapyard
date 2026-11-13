// Applies the interface theme to the notes page. A classic script loaded in <head>, so the class is set before
// the first paint. Follows changes made on the options page while the notes are open.

const NOTES_THEME_KEY = "scrapyard-sidebar-theme";

function applyNotesTheme() {
    let theme;
    try {
        theme = localStorage.getItem(NOTES_THEME_KEY);
    } catch (e) {
        theme = null;
    }
    document.documentElement.classList.toggle("dark-theme", theme === "dark");
}

applyNotesTheme();

window.addEventListener("storage", e => {
    if (e.key === NOTES_THEME_KEY || e.key === null)
        applyNotesTheme();
});
