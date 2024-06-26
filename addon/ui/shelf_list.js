import {settings} from "../settings.js";
import {
    isBuiltInShelf,
    CLOUD_SHELF_ID,
    CLOUD_SHELF_NAME,
    CLOUD_SHELF_UUID,
    DEFAULT_SHELF_ID,
    DEFAULT_SHELF_NAME,
    DONE_SHELF_ID,
    DONE_SHELF_NAME,
    EVERYTHING_SHELF_UUID,
    EVERYTHING_SHELF_ID,
    BROWSER_SHELF_ID,
    BROWSER_SHELF_NAME,
    BROWSER_SHELF_UUID,
    TODO_SHELF_ID,
    TODO_SHELF_NAME, DEFAULT_SHELF_UUID, EVERYTHING_SHELF_NAME, FILES_SHELF_UUID, FILES_SHELF_NAME, FILES_SHELF_ID
} from "../storage.js";
import {formatShelfName} from "../bookmarking.js";
import {Query} from "../storage_query.js";

const DEFAULT_SHELF_LIST_WIDTH = 91;

function createSelectricMeter() {
    let meter = $("#selectric-meter");
    if (!meter.length)
        meter = $(`<div id="selectric-meter" style="position: absolute; white-space: nowrap; font-size: 12px;`
                     + `bottom: 0; left: 0; visibility: hidden"></div>`).appendTo(document.body);
    return meter;
}

function measureSelectricWidth(options) {
    const meter = createSelectricMeter();

    let longestText = "";
    options.each(function() {
        const optionText = this.textContent;
        if (optionText.length > longestText.length)
            longestText = optionText;
    });

    meter.text(longestText);

    if (longestText.toLowerCase() === EVERYTHING_SHELF_NAME)
        meter.addClass("option-builtin");
    else
        meter.removeClass("option-builtin");

    return meter.width() + 33; // + selectric margins & 5 pixels
}

export class ShelfList {
    constructor(select, options) {
        this._options = options || {};
        this._options.inheritOriginalWidth = !options._prefix;
        this._options.arrowButtonMarkup =
            `<b class="button"><img class="midnight-filter" src="../images/dropdown.svg"/></b>`;

        $(`${select}-placeholder`).remove();
        this._select = $(select).selectric(this._options);
        this._element = this._select.closest(".selectric-wrapper");

        const shelfListWidth = localStorage.getItem(`${options._prefix}-shelf-list-width`) || DEFAULT_SHELF_LIST_WIDTH;
        this._element.css("width", shelfListWidth)
    }

    _refresh() {
        this._select.selectric('refresh');
        const width = measureSelectricWidth($("option", this._select));
        this._element.css("width", width);

        if (this._options._prefix)
            localStorage.setItem(`${this._options._prefix}-shelf-list-width`, width)
    }

    _styleBuiltinShelf() {
        let {name} = this.getCurrentShelf();

        const label = $("span.label", this._element);

        if (isBuiltInShelf(name))
            label.addClass("option-builtin");
        else
            label.removeClass("option-builtin");
    }

    static getStoredWidth(prefix) {
        return localStorage.getItem(`${prefix}-shelf-list-width`)
    }

    show() {
        this._element.show();
    }

    getCurrentShelf() {
        let selectedOption = $(`option[value='${this._select.val()}']`, this._select);
        return {
            id: parseInt(selectedOption.val()),
            name: selectedOption.text(),
            uuid: selectedOption.attr("data-uuid"),
            external: selectedOption.attr("data-external"),
            option: selectedOption
        };
    }

    async reload() {
        let html = `
            <option class="option-builtin" value="${TODO_SHELF_ID}" data-uuid="${TODO_SHELF_NAME}">${TODO_SHELF_NAME}</option>
            <option class="option-builtin" value="${DONE_SHELF_ID}" data-uuid="${DONE_SHELF_NAME}">${DONE_SHELF_NAME}</option>
            <option class="option-builtin divide" value="${EVERYTHING_SHELF_ID}"
                    data-uuid="${EVERYTHING_SHELF_UUID}">${formatShelfName(EVERYTHING_SHELF_NAME)}</option>`

        if (settings.enable_files_shelf())
            html += `<option class=\"option-builtin\" data-uuid="${FILES_SHELF_UUID}"
                             value=\"${FILES_SHELF_ID}\">${formatShelfName(FILES_SHELF_NAME)}</option>`;

        if (settings.cloud_enabled())
            html += `<option class=\"option-builtin\" data-uuid="${CLOUD_SHELF_UUID}"
                             value=\"${CLOUD_SHELF_ID}\">${formatShelfName(CLOUD_SHELF_NAME)}</option>`;

        if (settings.show_firefox_bookmarks())
            html += `<option class=\"option-builtin\" data-uuid="${BROWSER_SHELF_UUID}"
                             value=\"${BROWSER_SHELF_ID}\">${formatShelfName(BROWSER_SHELF_NAME)}</option>`;

        let shelves = await Query.allShelves();

        let orgShelfNode = shelves.find(s => s.id === FILES_SHELF_ID);
        if (orgShelfNode)
            shelves.splice(shelves.indexOf(orgShelfNode), 1);

        let cloudShelfNode = shelves.find(s => s.id === CLOUD_SHELF_ID);
        if (cloudShelfNode)
            shelves.splice(shelves.indexOf(cloudShelfNode), 1);

        let browserShelfNode = shelves.find(s => s.id === BROWSER_SHELF_ID);
        if (browserShelfNode)
            shelves.splice(shelves.indexOf(browserShelfNode), 1);

        let defaultShelf = shelves.find(s => s.name.toLowerCase() === DEFAULT_SHELF_NAME);
        shelves.splice(shelves.indexOf(defaultShelf), 1);
        defaultShelf.name = formatShelfName(defaultShelf.name);
        html += `<option class="option-builtin" data-uuid="${DEFAULT_SHELF_UUID}"
                         value="${defaultShelf.id}">${formatShelfName(defaultShelf.name)}</option>`;

        shelves.sort((a, b) => a.name.localeCompare(b.name));

        for (let shelf of shelves)
            html += `<option data-uuid="${shelf.uuid}" data-external="${shelf.external || ''}"
                        value="${shelf.id}">${shelf.name}</option>`;

        this._select.html(html);
    }

    load() {
        return this.reload();
    }

    async initDefault() {
        const label = $("span.label", this._element);
        label.addClass("option-builtin");
        await this.load();
        this.selectShelf(EVERYTHING_SHELF_ID);
        this.change(() => null);
    }

    hasShelf(name) {
        name = name.toLocaleLowerCase();
        let existingOption = $(`option`, this._select).filter(function(i, e) {
            return e.textContent.toLocaleLowerCase() === name;
        });

        return !!existingOption.length;
    }

    selectShelf(id) {
        const option = $(`option[value="${id}"]`, this._select);
        id = option.length? id: DEFAULT_SHELF_ID;

        this._select.val(id);
        this._styleBuiltinShelf();
        this._refresh();
    }

    get selectedShelfId() {
        return parseInt(this._select.val());
    }

    get selectedShelfName() {
        let selectedOption = $(`option[value='${this._select.val()}']`, this._select);
        return selectedOption.text();
    }

    get selectedShelfExternal() {
        let selectedOption = $(`option[value='${this._select.val()}']`, this._select);
        return selectedOption.attr("data-external");
    }

    change(handler) {
        const wrapper = (...args) => {
            this._styleBuiltinShelf();
            handler.apply(this._select[0], args);
        }
        this._select.change(wrapper);
    }

    removeShelves(ids) {
        if (!Array.isArray(ids))
            ids = [ids];

        for (const id of ids)
            $(`option[value="${id}"]`, this._select).remove();

        this._refresh();
    }

    renameShelf(id, name) {
        $(`option[value="${id}"]`, this._select).text(name);
        this._refresh();
    }
}

ShelfList.DEFAULT_WIDTH = DEFAULT_SHELF_LIST_WIDTH;

export function simpleSelectric(element) {
    return $(element).selectric({
        inheritOriginalWidth: false,
        arrowButtonMarkup:
            `<b class="button"><img class="midnight-filter" src="../images/dropdown.svg"/></b>`
    });
}

export function selectricRefresh(element) {
    element.selectric("refresh");
    let wrapper = element.closest(".selectric-wrapper");
    let width = measureSelectricWidth($("option", element));
    wrapper.css("width", width);
}
