import {settings} from "../../settings.js";
import {setSaveCheckHandler} from "../options.js";
import {selectricRefresh, simpleSelectric} from "../shelf_list.js";
import {STORAGE_POPULATED} from "../../storage.js";
import {send} from "../../proxy.js";
import {confirm} from "../dialog.js";
import {helperApp, HELPER_APP_v2_1_IS_REQUIRED} from "../../helper_app.js";
import {filesShelf} from "../../plugin_files_shelf.js";

function configureScrapyardSettingsPage() {
    simpleSelectric("#option-sidebar-theme");
    const storageModeSelect = simpleSelectric("#option-storage-mode");

    let dataFolderInputTimeout;
    $("#option-data-folder-path").on("input", e => {
        clearTimeout(dataFolderInputTimeout);
        dataFolderInputTimeout = setTimeout(async () => {
            await settings.load();

            const path = e.target.value
            await settings.data_folder_path(path);

            const status = await send.checkSyncDirectory({path});

            if (status === STORAGE_POPULATED)
                send.performSync();

        }, 1000);
    });

    storageModeSelect.on("change", async e => {
        if (e.target.value === "filesystem")
            setStorageModeToFilesystem();
        else
            setStorageModeToInternal();
    });

    if (settings.storage_mode_internal()) {
        $("#option-data-folder-path").prop("disabled", true);
        $("#option-synchronize-at-startup").prop("disabled", true);
    }

    $("#option-sidebar-theme").on("change", e => {
        localStorage.setItem("scrapyard-sidebar-theme", e.target.value);
        send.sidebarThemeChanged({theme: e.target.value});
    });

    let listHeightInputTimeout;
    $("#option-shelf-list-max-height").on("input", e => {
        clearTimeout(listHeightInputTimeout);
        listHeightInputTimeout = setTimeout(async () => {
            await settings.load();
            await settings.shelf_list_height(+e.target.value);
            send.reloadSidebar({height: +e.target.value});
        }, 1000)
    });

    let filesEditorInputTimeout;
    $("#option-editor-executable").on("input", e => {
        clearTimeout(filesEditorInputTimeout);
        filesEditorInputTimeout = setTimeout(async () => {
            await settings.load();
            await settings.files_editor_executable(e.target.value);
        }, 1000)
    });

    $("#option-number-of-bookmarks-toolbar-references").on("input", async e => {
        await settings.load();
        let value = parseInt(e.target.value) || 0;

        await settings.number_of_bookmarks_toolbar_references(value);
    });

    $("#transfer-content").on("click", async e => {
        e.preventDefault();

        const success = await send.transferContentToDisk();

        if (success)
            $("#transfer-content-container").hide();
    });

    if (settings.transition_to_disk()) {
        $("#transfer-content-container").show();
        $("#synchronize-at-startup-wrapper").hide();
        $("#storage-mode-wrapper").hide();
    }

    setSaveCheckHandler("option-synchronize-at-startup", "synchronize_storage_at_startup",
        () => send.shelvesChanged());
    setSaveCheckHandler("option-capitalize-builtin-shelf-names", "capitalize_builtin_shelf_names",
        () => send.shelvesChanged());
    setSaveCheckHandler("option-show-firefox-bookmarks", "show_firefox_bookmarks",
        () => send.reconcileBrowserBookmarkDb());
    setSaveCheckHandler("option-show-firefox-bookmarks-toolbar", "show_firefox_toolbar",
        () => send.externalNodesReady());
    setSaveCheckHandler("option-enable-files-shelf", "enable_files_shelf",
        e => enableFilesShelf(e));
    setSaveCheckHandler("option-visually-emphasise-archives", "visually_emphasise_archives",
        () => send.shelvesChanged());
    setSaveCheckHandler("option-archives-icon", "visual_archive_icon",
        () => send.shelvesChanged());
    setSaveCheckHandler("option-archives-color", "visual_archive_color",
        () => send.shelvesChanged());
    setSaveCheckHandler("option-display-random-bookmark", "display_random_bookmark",
        e => send.displayRandomBookmark({display: e.target.checked}));
    setSaveCheckHandler("option-sort-shelves-in-popup", "sort_shelves_in_popup");
    setSaveCheckHandler("option-show-firefox-bookmarks-mobile", "show_firefox_mobile");
    setSaveCheckHandler("option-do-not-show-archive-toolbar", "do_not_show_archive_toolbar");
    setSaveCheckHandler("option-switch-to-bookmark", "switch_to_new_bookmark");
    setSaveCheckHandler("option-open-bookmark-in-active-tab", "open_bookmark_in_active_tab");
    setSaveCheckHandler("option-open-sidebar-from-shortcut", "open_sidebar_from_shortcut");
    setSaveCheckHandler("option-do-not-switch-to-ff-bookmark", "do_not_switch_to_ff_bookmark");
    setSaveCheckHandler("option-add-to-bookmarks-toolbar", "add_to_bookmarks_toolbar");
    setSaveCheckHandler("option-undo-failed-imports", "undo_failed_imports");
    setSaveCheckHandler("option-sidebar-filter-partial-match", "sidebar_filter_partial_match");
    setSaveCheckHandler("option-remember-last-filtering-mode", "remember_last_filtering_mode");
}

function loadScrapyardSettings() {
    $("#option-data-folder-path").val(settings.data_folder_path() || "");
    $("#option-storage-mode").val(settings.storage_mode_internal()? "internal": "filesystem");
    $("#option-synchronize-at-startup").prop("checked", settings.synchronize_storage_at_startup());
    $("#option-sidebar-theme").val(localStorage.getItem("scrapyard-sidebar-theme") || "light");
    $("#option-shelf-list-max-height").val(settings.shelf_list_height());
    $("#option-show-firefox-bookmarks").prop("checked", settings.show_firefox_bookmarks());
    $("#option-show-firefox-bookmarks-toolbar").prop("checked", settings.show_firefox_toolbar());
    $("#option-enable-files-shelf").prop("checked", settings.enable_files_shelf());
    $("#option-editor-executable").val(settings.files_editor_executable());
    $("#option-visually-emphasise-archives").prop("checked", settings.visually_emphasise_archives());
    $("#option-archives-icon").prop("checked", settings.visual_archive_icon());
    $("#option-archives-color").prop("checked", settings.visual_archive_color());
    $("#option-sort-shelves-in-popup").prop("checked", settings.sort_shelves_in_popup());
    $("#option-show-firefox-bookmarks-mobile").prop("checked", settings.show_firefox_mobile());
    $("#option-switch-to-bookmark").prop("checked", settings.switch_to_new_bookmark());
    $("#option-do-not-show-archive-toolbar").prop("checked", settings.do_not_show_archive_toolbar());
    $("#option-do-not-switch-to-ff-bookmark").prop("checked", settings.do_not_switch_to_ff_bookmark());
    $("#option-add-to-bookmarks-toolbar").prop("checked", settings.add_to_bookmarks_toolbar());
    $("#option-number-of-bookmarks-toolbar-references").val(settings.number_of_bookmarks_toolbar_references() || "");
    $("#option-display-random-bookmark").prop("checked", settings.display_random_bookmark());
    $("#option-open-bookmark-in-active-tab").prop("checked", settings.open_bookmark_in_active_tab());
    $("#option-open-sidebar-from-shortcut").prop("checked", settings.open_sidebar_from_shortcut());
    $("#option-capitalize-builtin-shelf-names").prop("checked", settings.capitalize_builtin_shelf_names());
    $("#option-sidebar-filter-partial-match").prop("checked", settings.sidebar_filter_partial_match());
    $("#option-remember-last-filtering-mode").prop("checked", settings.remember_last_filtering_mode());
    $("#option-undo-failed-imports").prop("checked", settings.undo_failed_imports());

    selectricRefresh($("#option-sidebar-theme"));
    selectricRefresh($("#option-storage-mode"));
}

export function load() {
    configureScrapyardSettingsPage();
    loadScrapyardSettings();
}

async function setStorageModeToFilesystem() {
    if (await confirm("Warning", "This will reset the Scrapyard browser internal storage. "
            + "Make sure that you have exported important content. Continue?")) {
        $("#option-data-folder-path").prop("disabled", false);
        $("#option-synchronize-at-startup").prop("disabled", false);

        await settings.storage_mode_internal(false);

        await send.resetScrapyard();
        browser.runtime.reload();
    }
    else {
        const storageModeSelect = $("#option-storage-mode").val("internal");
        selectricRefresh(storageModeSelect);
    }
}

async function setStorageModeToInternal() {
    if (await confirm("Warning", "This will reset the Scrapyard browser internal storage. Continue?")) {
        $("#option-data-folder-path")
            .val("")
            .prop("disabled", true);
        $("#option-synchronize-at-startup")
            .prop("checked", false)
            .prop("disabled", true)

        settings.save_unpacked_archives(false, false);
        settings.data_folder_path("", false);
        settings.synchronize_storage_at_startup(false, false);
        await settings.storage_mode_internal(true);

        await send.storageModeInternal();
        await send.resetScrapyard();
        browser.runtime.reload();
    }
    else {
        const storageModeSelect = $("#option-storage-mode").val("filesystem");
        selectricRefresh(storageModeSelect);
    }
}

async function enableFilesShelf(e) {
    const helper = await helperApp.hasVersion("2.1", HELPER_APP_v2_1_IS_REQUIRED);

    if (helper)
        return filesShelf.enable(e.target.checked);
    else
        e.target.checked = false;
}
