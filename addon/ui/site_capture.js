var pageURL = null;
var pageLinks = [];

const DOMAIN_STUB = "INSERT_YOUR_DOMAIN";

$(init);

function init() {
    setUpMenu("include");
    setUpMenu("exclude");

    const helpLink = document.getElementById("help-link");
    helpLink.href = browser.runtime.getURL("ui/options.html#help:site-capture-manual");

    document.addEventListener("click", e => {
        if (!e.target.matches(".dropdown"))
            hideMenu();
    });

    document.getElementById("cancel-button")
        .addEventListener("click", e => {
            browser.runtime.sendMessage({type: "cancelSiteCapture"});
        });

    document.getElementById("ok-button")
        .addEventListener("click", e => {
            const options = {
                depth: parseInt(document.getElementById("option-crawling-depth").value) || 1,
                delay: parseInt(document.getElementById("option-crawling-delay").value) || 0,
                threads: parseInt(document.getElementById("option-processing-threads").value) || 5,
                ignoreHashes: document.getElementById("option-ignore-hashes").checked,
                includeRules: document.getElementById("include-links").value,
                excludeRules: document.getElementById("exclude-links").value
            }
            browser.runtime.sendMessage({type: "continueSiteCapture", options});
        });

    browser.runtime.sendMessage({type: "collectTabLinks"})
        .then(response => {
            if (response) {
                pageURL = response.url || null;
                pageLinks = response.links || [];
            }
        })
        .catch(e => console.error(e));
};

function setUpMenu(id) {
    document.querySelectorAll(`#${id}-presets-menu-dropdown, #${id}-presets-menu-dropdown .dropdown-symbol`)
        .forEach(element => {
            element.addEventListener("click", e => {
                e.stopPropagation();
                const menu = document.getElementById(`${id}-presets-menu`);
                const hidden = menu.style.display !== "block";
                hideMenu();
                menu.style.display = hidden? "block": "none";
            });
        });

    document.getElementById(`${id}-presets-menu-site`)
        .addEventListener("click", e => {
            const url = pageURL? new URL(pageURL): null;
            const host = url?.host || DOMAIN_STUB;
            const urlRegex = host.replace(/\./g, "\\.");
            insertRule(id, `/^https?://(?:[^.]*\\.)*?${urlRegex}(?:\\d+)?//`)
        });

    document.getElementById(`${id}-presets-menu-domain`)
        .addEventListener("click", e => {
            const url = pageURL? new URL(pageURL): null;
            const origin = url?.origin || DOMAIN_STUB;
            const urlRegex = origin.replace(/\./g, "\\.");
            insertRule(id, `/^${urlRegex}//`)
        });

    document.getElementById(`${id}-presets-menu-directory`)
        .addEventListener("click", e => {
            const urlRegex = (pageURL || DOMAIN_STUB)
                .replace(/[^/]*$/g, "")
                .replace(/\./g, "\\.");;
            insertRule(id, `/^${urlRegex}/`);
        });

    document.getElementById(`${id}-presets-menu-path`)
        .addEventListener("click", e => {
            const urlRegex = (pageURL || DOMAIN_STUB).replace(/\./g, "\\.");
            insertRule(id, `/^${urlRegex}(?=[?#]|$)/`);
        });

    document.getElementById(`${id}-presets-menu-all-links`)
        .addEventListener("click", e => {
            let links = "";
            for (const link of pageLinks)
                links += `${link.url} ${formatLinkText(link.text)}\n`;
            insertRule(id, links.trim());
        });

    document.getElementById(`${id}-presets-menu-text`)
        .addEventListener("click", e => {
            insertRule(id, "$text:/^Chapter \\d+$/i");
        });
}

function hideMenu() {
    document.querySelectorAll(".simple-menu")
        .forEach(element => {
            element.style.display = "none";
        });
}

function insertRule(id, rule) {
    const textarea = document.getElementById(`${id}-links`);
    textarea.value = textarea.value + (textarea.value? "\n": "") + `${rule}`;
}

function formatLinkText(text) {
    text = text?.trim()?.replace(/\n/g, " ")?.replace(/\s+/g, " ") || "";

    let result = `[${text}]`;

    if (result === "[]")
        result = "";

    return result;
}
