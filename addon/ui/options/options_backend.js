import {settings} from "../../settings.js";
import {fetchWithTimeout} from "../../utils_io.js";
import {send} from "../../proxy.js";

async function loadHelperAppLinks() {
    const helperAppVersionP = $("#helper-app-version");
    if (helperAppVersionP.data("loaded"))
        return;

    helperAppVersionP.data("loaded", true);

    function setDownloadLinks(assets) {
        const app = assets.find(a => a.browser_download_url.endsWith(".exe")).browser_download_url;
        const archive = assets.find(a => a.browser_download_url.endsWith(".tgz")).browser_download_url;
        $("#helper-windows-inst").attr("href", app);
        $("#helper-manual-inst").attr("href", archive);
    }

    try {
        const apiURL = "https://api.github.com/repos/gchristensen/scrapyard/releases/latest";
        const response = await fetchWithTimeout(apiURL, {timeout: 30000});

        if (response.ok) {
            let release = JSON.parse(await response.text());
            setDownloadLinks(release.assets);

            let version = release.name.split(" ");
            version = version[version.length - 1];

            helperAppVersionP.html(`<b>Latest version:</b> ${version}`);
        }
        else
            throw new Error();
    }
    catch (e) {
        console.error(e);
        setDownloadLinks("#heperapp", "#heperapp");
        helperAppVersionP.html(`<b>Latest version:</b> error`);
    }

    const installedVersion = await send.helperAppGetVersion();
    const INSTALLED_VERSION_TEXT = `<b>Installed version:</b> %%%`;

    if (installedVersion)
        $("#helper-app-version-installed").html(INSTALLED_VERSION_TEXT
            .replace("%%%", "v" + installedVersion));
    else
        $("#helper-app-version-installed").html(INSTALLED_VERSION_TEXT
            .replace("%%%", "not installed"));
}

function configureBackendSettingsPage() {
    $("#option-helper-port").val(settings.helper_port_number());

    $("#option-helper-port").on("input", async e => {
        await settings.load();
        settings.helper_port_number(+e.target.value);
    });
}

export async function load() {
    configureBackendSettingsPage();
    await loadHelperAppLinks();
}
