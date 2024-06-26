import {merge} from "./utils.js";

export const SCRAPYARD_SYNC_METADATA = "scrapyard-sync-metadata";

const SCRAPYARD_SETTINGS_KEY = "scrapyard-settings";

class ScrapyardSettings {
    constructor() {
        this._default = {
            export_format: "json",
            shelf_list_height: 600,
            helper_port_number: 20202,
            show_firefox_bookmarks: true,
            switch_to_new_bookmark: true,
            visual_archive_icon: true,
            visual_archive_color: true,
            sort_shelves_in_popup: true,
            show_firefox_toolbar: !_BACKGROUND_PAGE,
            sidebar_filter_partial_match: true,
            number_of_bookmarks_toolbar_references: 25
        };

        this._bin = {};
        this._key = SCRAPYARD_SETTINGS_KEY;
    }

    async _loadPlatform() {
        if (!this._platform) {
            this._platform = {};

            if (browser.runtime.getPlatformInfo) {
                const platformInfo = await browser.runtime.getPlatformInfo();

                this._platform[platformInfo.os] = true;
            }

            if (navigator.userAgent.indexOf("Firefox") >= 0)
                this._platform.firefox = true;

            if (navigator.userAgent.indexOf("Chrome") >= 0)
                this._platform.chrome = true;
        }
    }

    async _loadSettings() {
        const object = await browser.storage.local.get(this._key);
        this._bin = merge(object?.[this._key] || {}, this._default);
    }

    async _load() {
        await this._loadPlatform();
        await this._loadSettings();
    }

    async _save() {
        return browser.storage.local.set({[this._key]: this._bin});
    }

    async _get(k) {
        const v = await browser.storage.local.get(k);
        if (v)
            return v[k];
        return null;
    }

    async _set(k, v) { return browser.storage.local.set({[k]: v}) }

    _processSetSetting(key, val) {
        // in Firefox, synchronous access to this setting is required
        if (this._platform.firefox && key === "open_sidebar_from_shortcut")
            localStorage.setItem("option-open-sidebar-from-shortcut", val? "open": "");
    }

    get(target, key, receiver) {
        if (key === "load")
            return v => this._load(); // sic !
        else if (key === "default")
            return this._default;
        else if (key === "platform")
            return this._platform;
        else if (key === "get")
            return this._get;
        else if (key === "set")
            return this._set;

        return (val, save = true) => {
            let bin = this._bin;

            if (val === undefined)
                return bin[key];

            let deleted;
            if (val === null) {
                deleted = bin[key];
                delete bin[key]
            }
            else
                bin[key] = val;

            let result = key in bin? bin[key]: deleted;
            this._processSetSetting(key, val);

            if (save)
                return this._save().then(() => result);
            else
                return result;
        }
    }

    has(target, key) {
        return key in this._bin;
    }

    * enumerate() {
        for (let key in this._bin) yield key;
    }
}

export let settings = new Proxy({}, new ScrapyardSettings());

chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (changes[SCRAPYARD_SETTINGS_KEY])
        settings.load();
});
