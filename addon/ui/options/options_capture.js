import {send} from "../../proxy.js";
import {settings} from "../../settings.js";
import {setSaveCheckHandler} from "../options.js";

async function loadCaptureSettings() {
    let object = await browser.storage.local.get("savepage-settings");
    object = object["savepage-settings"];

    function loadCheck(id, v) {
        $(`#${id}`).prop("checked", v || object[id]);
    }

    function loadValue(id) {
        $(`#${id}`).val(object[id]);
    }

    /* General options */
    loadCheck("options-retaincrossframes");
    loadCheck("options-removeunsavedurls");
    loadCheck("options-loadshadow");

    /* Saved Items options */
    loadCheck("options-savehtmlaudiovideo");
    loadCheck("options-savehtmlobjectembed");
    loadCheck("options-savehtmlimagesall");
    loadCheck("options-savecssimagesall");
    loadCheck("options-savecssfontswoff");
    loadCheck("options-savecssfontsall");
    loadCheck("options-savescripts");

    $("#options-savecssfontswoff").prop("disabled", $("#options-savecssfontsall").is(":checked"));
    $("#options-savecssfontsall").on("click", e => {
        $("#options-savecssfontswoff").prop("disabled", $("#options-savecssfontsall").is(":checked"));
    });

    loadCheck("options-removeelements");

    /* Advanced options */
    loadValue("options-maxframedepth");
    loadValue("options-maxresourcesize");
    loadValue("options-maxresourcetime");
    loadCheck("options-allowpassive");

    $(`#options-refererheader input[name="header"]`, "").val([object["options-crossorigin"]]);

    if (object["options-lazyloadtype"] === "1")
        loadCheck("options-lazyloadtype-1", true);
    else if (object["options-lazyloadtype"] === "2")
        loadCheck("options-lazyloadtype-2", true);
}

async function storeCaptureSettings(e) {

    if (e.target.id === "options-lazyloadtype-1")
        $("#options-lazyloadtype-2").prop("checked", false);
    else if (e.target.id === "options-lazyloadtype-2")
        $("#options-lazyloadtype-1").prop("checked", false);

    let lazyLoadType = "0";
    if ($("#options-lazyloadtype-1").is(":checked"))
        lazyLoadType = "1";
    else if ($("#options-lazyloadtype-2").is(":checked"))
        lazyLoadType = "2";

    // option "options-savedelaytime" is currently not represented in UI, 0 by default

    let newSettings = {
        /* General options */

        "options-retaincrossframes": $("#options-retaincrossframes").is(":checked"),
        "options-removeunsavedurls": $("#options-removeunsavedurls").is(":checked"),
        "options-loadshadow": $("#options-loadshadow").is(":checked"),

        /* Saved Items options */

        "options-savehtmlaudiovideo": $("#options-savehtmlaudiovideo").is(":checked"),
        "options-savehtmlobjectembed": $("#options-savehtmlobjectembed").is(":checked"),
        "options-savehtmlimagesall": $("#options-savehtmlimagesall").is(":checked"),
        "options-savecssimagesall": $("#options-savecssimagesall").is(":checked"),
        "options-savecssfontswoff": $("#options-savecssfontswoff").is(":checked"),
        "options-savecssfontsall": $("#options-savecssfontsall").is(":checked"),
        "options-savescripts": $("#options-savescripts").is(":checked"),

        /* Advanced options */

        "options-maxframedepth": +$("#options-maxframedepth").val(),
        "options-maxresourcesize": +$("#options-maxresourcesize").val(),
        "options-maxresourcetime": +$("#options-maxresourcetime").val(),
        "options-allowpassive": $("#options-allowpassive").is(":checked"),
        "options-crossorigin": +$(`#options-refererheader input[name="header"]:checked`).val(),
        "options-removeelements": $("#options-removeelements").is(":checked"),
        "options-lazyloadtype": lazyLoadType
    };

    let settings = await browser.storage.local.get("savepage-settings");
    settings = settings["savepage-settings"] || {};

    Object.assign(settings, newSettings);

    await browser.storage.local.set({"savepage-settings": settings});

    send.savepageSettingsChanged();
}

async function loadSaveSettings() {
    $("#option-save-unpacked-archives").prop("checked", settings.save_unpacked_archives());
}

function configureCaptureSettingsPage() {
    $(`#div-capture input[type="checkbox"]`).on("click", storeCaptureSettings);
    $(`#div-capture input[type="radio"]`).on("click", storeCaptureSettings);
    $(`#div-capture input[type="number"]`).on("input", storeCaptureSettings);

    if (!settings.platform.firefox) {
        $("#options-originonly").prop("disabled", true);
        $("#options-originpath").prop("disabled", true);
        $("label[for='options-originonly']").css("color", "grey");
        $("label[for='options-originpath']").css("color", "grey");
    }

    setSaveCheckHandler("option-save-unpacked-archives", "save_unpacked_archives");

    // if (settings.platform.firefox && !settings.storage_mode_internal())
    //     $("#save-options-row").show();
}

export async function load() {
    await settings.load();
    await loadCaptureSettings();
    await loadSaveSettings();
    configureCaptureSettingsPage();
}
