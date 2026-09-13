import {settings} from "../../settings.js";
import {selectricRefresh, ShelfList, simpleSelectric} from "../shelf_list.js";
import {send} from "../../proxy.js";
import {EVERYTHING_SHELF_NAME, NODE_TYPE_ARCHIVE, NODE_TYPE_BOOKMARK} from "../../storage.js";
import {getFaviconFromContent} from "../../favicon.js";
import {fetchWithTimeout} from "../../utils_io.js";
import {alert, confirm} from "../dialog.js";
import {showNotification} from "../../utils_browser.js";
import {Node} from "../../storage_entities.js";
import {Path} from "../../path.js";
import {Bookmark} from "../../bookmarks_bookmark.js";
import {DiskStorage} from "../../storage_external.js";

const DEFAULT_LINK_CHECK_TIMEOUT = 10;

export class LinkChecker {

    constructor() {
        $("#start-check-links").on("click", () => this.startCheckLinks());

        const linkCheckTimeoutInput = $("#link-check-timeout");
        linkCheckTimeoutInput.val(settings.link_check_timeout() || DEFAULT_LINK_CHECK_TIMEOUT)
        linkCheckTimeoutInput.on("input", async e => {
            await settings.load();
            let timeout = parseInt(e.target.value);
            settings.link_check_timeout(isNaN(timeout)? DEFAULT_LINK_CHECK_TIMEOUT: timeout);
        });

        this.shelfList = new ShelfList("#link-check-scope", {
            maxHeight: settings.shelf_list_height() || settings.default.shelf_list_height,
            _prefix: "checklinks"
        });

        this.shelfList.initDefault();

        const linkCheckModeSelect = $("#link-check-mode");
        simpleSelectric("#link-check-mode");
        selectricRefresh(linkCheckModeSelect);

        const updateIconsCheck = $("#update-icons");
        linkCheckModeSelect.on("change", e => {
           if (e.target.value === "duplicates") {
               updateIconsCheck.prop("checked", false);
               updateIconsCheck.prop("disabled", true);
           }
           else
               updateIconsCheck.prop("disabled", false);
        });

        $("#delete-selected-links").on("click", e => this.deleteSelected());

        this.resultCount = 0;
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        this.autoStartCheckLinks = !!urlParams.get("menu");

        if (this.autoStartCheckLinks) {
            $("#update-icons").prop("checked", urlParams.get("repairIcons") === "true");
            let scopePath = await Path.compute(parseInt(urlParams.get("scope")));
            $("#link-check-scope-container", $("#check-links"))
                .replaceWith(`<span style="white-space: nowrap">${scopePath.slice(-1)[0].name}&nbsp;&nbsp;</span>`);
            this.autoLinkCheckScope = scopePath.map(g => g.name).join("/");
            this.startCheckLinks();
        }
    }

    async deleteSelected() {
        const selectedItems = $(".check-result-selected:checked");

        if (selectedItems.length && await confirm("Warning", "Do you really want to delete the selected items?")) {
            const nodes = [];
            for (const check of selectedItems.get()) {
                nodes.push(parseInt(check.id));
                $(check).closest("tr").remove();
            }

            await send.deleteNodes({node_ids: nodes});
            send.nodesUpdated();
        }
        else if (!selectedItems.length)
            showNotification("Nothing is selected.");
    }

    async _makeBreadCrumb(node) {
        const path = await Path.compute(node);
        path.length = path.length - 1;

        let breadcrumb = " &nbsp; ";

        for (let i = 0; i < path.length; ++i) {
            breadcrumb += path[i].name;

            if (i !== path.length - 1)
                breadcrumb += " &#187; "
        }

        return breadcrumb;
    }

    async _checkForValidity() {
        const checkResultContainerDiv = $("#check-results-container");
        const checkResultsTitle = $("#check-results-title");
        const checkResultTable = $("#check-results");
        const currentLinkDiv = $("#current-link");
        const updateIcons = $("#update-icons").is(":checked");
        let path;

        if (this.autoStartCheckLinks)
            path = this.autoLinkCheckScope;
        else {
            let scope = this.shelfList.selectedShelfName;
            path = scope === EVERYTHING_SHELF_NAME ? undefined : scope;
        }

        currentLinkDiv.show();
        currentLinkDiv.css("visibility", "visible");
        checkResultContainerDiv.hide();
        checkResultsTitle.text("Broken links:");
        checkResultsTitle.prop("class", "header-validity");
        checkResultTable.empty();

        async function updateIcon(node, html) {
            let favicon = await getFaviconFromContent(node.uri, html);

            if (favicon) {
                node.icon = favicon;
                await Bookmark.storeIcon(node);
            }
            else if (node.icon && !node.stored_icon) {
                node.icon = undefined;
                await Node.update(node);
            }
        }

        const displayLinkError = async (error, node) => {
            checkResultContainerDiv.show();

            const breadcrumb = await this._makeBreadCrumb(node);

            checkResultTable.append(
                `<tr>
                    <td class="link-check-service-cell">
                        <input class="check-result-selected" id="${node.id}" type="checkbox"/>
                    </td>
                    <td class="link-check-service-cell">
                        <img id="link-check-select-${node.id}" class="result-action-icon"
                             src="../icons/tree-select.svg" title="Select"/>
                    </td>
                    <td class="link-check-service-cell">
                        <a href="${node.uri}"
                           target="_blank"><img id="link-check-open-url-${node.id}" class="result-action-icon"
                                                src="../icons/url.svg" title="Open URL"/></a>
                    </td>
                    <td class="link-check-service-cell">
                        <a href="http://web.archive.org/web/${encodeURIComponent(node.uri)}"
                           target="_blank"><img class="result-action-icon-last"
                                                src="../icons/web-archive.svg"
                                                title="Web Archive"/></a>
                    </td>
                    <td class="link-check-error link-check-service-cell">${error}</td>
                    <td class="validated-link">
                        <span id="checked-link-${node.id}" title="${breadcrumb}"
                              class="validated-node">${node.name}</span>
                        <span class="link-check-breadcrumb">${breadcrumb}</span>
                    </td>
                 </tr>`
            );

            $(`#link-check-select-${node.id}`).click(e => send.selectNode({node}));

            const link = $(`#checked-link-${node.id}`);
            link.click(e => send.browseNode({node}));

            if (node.type === NODE_TYPE_ARCHIVE) {
                link.addClass("archive-link");
                $(`#link-check-open-url-${node.id}`).prop("title", "Open Original URL")
            }
        }

        const nodes = await Bookmark.list({path: path, types: [NODE_TYPE_ARCHIVE, NODE_TYPE_BOOKMARK]});

        try {
            if (updateIcons)
                await DiskStorage.openBatchSession();

            for (let node of nodes) {
                if (this.abortCheckLinks)
                    break;

                if (!node.uri)
                    continue;

                $("#current-link-title").text(node.name);
                $("#current-link-url").text(node.uri);

                let error;
                let networkError;
                let contentType;
                let response;

                try {
                    let timeout = parseInt($("#link-check-timeout").val());
                    timeout = isNaN(timeout)? DEFAULT_LINK_CHECK_TIMEOUT: timeout;
                    response = await fetchWithTimeout(node.uri, {timeout: timeout * 1000});

                    if (this.abortCheckLinks)
                        break;

                    if (!response.ok)
                        error = `[HTTP Error: ${response.status}]`;
                    else
                        contentType = response.headers.get("content-type");
                } catch (e) {
                    networkError = true;

                    if (e.name === "AbortError")
                        error = `[Timeout]`;
                    else
                        error = "[Unavailable]"
                }

                if (error) {
                    this.resultCount += 1;
                    this._appendSelectAllRow(checkResultTable, 5);
                    await displayLinkError(error, node);

                    if (networkError && updateIcons && node.icon && !node.stored_icon) {
                        node.icon = undefined;
                        await Node.update(node);
                    }
                }
                else if (updateIcons && contentType?.toLowerCase()?.startsWith("text/html")) {
                    try {
                        await updateIcon(node, await response.text());
                    } catch (e) {
                        console.error(e)
                    }
                }
            }
        }
        finally {
            if (updateIcons)
                await DiskStorage.closeBatchSession();
        }

        if (!this.resultCount && !this.abortCheckLinks)
            await alert("Link Check", "No outdated links found.");
    }

    async _checkForDuplicates() {
        const checkResultContainerDiv = $("#check-results-container");
        const checkResultsTitle = $("#check-results-title");
        const checkResultTable = $("#check-results");
        const currentLinkDiv = $("#current-link");
        const scope = this.shelfList.selectedShelfName;
        const path = scope === EVERYTHING_SHELF_NAME ? undefined : scope;

        currentLinkDiv.hide();
        checkResultContainerDiv.hide();
        checkResultsTitle.text("Duplicate links:");
        checkResultsTitle.prop("class", "header-duplicates");
        checkResultTable.empty();

        send.startProcessingIndication({noWait: true})

        const nodes = await Bookmark.list({path: path, types: [NODE_TYPE_ARCHIVE, NODE_TYPE_BOOKMARK]});
        const links = new Map();

        for (let node of nodes) {
            if (this.abortCheckLinks)
                break;

            if (!node.uri)
                continue;

            const uri = node.uri.toLocaleLowerCase();

            if (links.has(uri)) {
                let counter = links.get(uri);
                counter += 1;
                links.set(uri, counter)
                this.resultCount += 1;
            }
            else {
                links.set(uri, 1);
            }
        }

        const buckets = new Map();
        for (const [link, count] of links.entries()) {
            if (count > 1) {
                const duplicates = nodes.filter(n => n.uri?.toLocaleLowerCase() === link);
                duplicates.sort((a, b) => a.id - b.id);
                buckets.set(link, duplicates);
            }
        }

        function displayLink(link) {
            checkResultTable.append(
                `<tr>
                    <td colspan="3" class="duplicate-link">${decodeURIComponent(link)}</td>
                 </tr>`
            );
        }

        const displayLinkDuplicate = async node => {
            checkResultContainerDiv.show();

            const breadcrumb = await this._makeBreadCrumb(node);

            checkResultTable.append(
                `<tr>
                    <td class="link-check-service-cell">
                        <input class="check-result-selected" id="${node.id}" type="checkbox"/>
                    </td>
                    <td class="link-check-service-cell">
                        <img id="link-check-select-${node.id}" class="result-action-icon"
                             src="../icons/tree-select.svg" title="Select"/>
                    </td>
                    <td>
                        <span id="checked-link-${node.id}" class="duplicate-node"
                              title="${breadcrumb}">${node.name}</span>
                        <span class="link-check-breadcrumb">${breadcrumb}</span>
                    </td>
                 </tr>`
            );

            $(`#link-check-select-${node.id}`).click(e => send.selectNode({node}));

            const link = $(`#checked-link-${node.id}`);
            link.click(e => send.browseNode({node}));

            if (node.type === NODE_TYPE_ARCHIVE) {
                link.addClass("archive-link");
                link.prop("href", `ext+scrapyard://${node.uuid}`);
            }
        }

        if (this.resultCount) {
            for (const [link, bucket] of buckets.entries()) {
                this._appendSelectAllRow(checkResultTable, 2);
                displayLink(link);
                for (const node of bucket) {
                    await displayLinkDuplicate(node);
                }
            }
        }
        else {
            showNotification("No duplicates found.");
        }

        send.stopProcessingIndication();
    }

    _appendSelectAllRow(table, span) {
        if (table.children().length === 0) {
            table.append(`
                <tr>
                    <td class="link-check-service-cell">
                        <input class="check-result-selected" id="check-all-links" type="checkbox"/>
                    </td>
                    <td colspan="${span}"><label for="check-all-links">Select all</label></td>
                </tr>`);

            $("#check-all-links").on("change", e => {
                if ($(e.target).is(":checked"))
                    $(".check-result-selected").prop("checked", true);
                else
                    $(".check-result-selected").prop("checked", false);
            });
        }
    }

    async startCheckLinks() {
        const startCheckLinksButton = $("#start-check-links");

        if (!this.checkIsInProgress && startCheckLinksButton.val() === "Check") {
            this.resultCount = 0;
            this.checkIsInProgress = true;
            try {
                startCheckLinksButton.val("Stop");
                $("#delete-selected-links").hide();

                if ($("#link-check-mode").val() === "validity")
                    await this._checkForValidity();
                else
                    await this._checkForDuplicates();
            }
            finally {
                this.checkIsInProgress = false;
                this.stopCheckLinks();
            }
        } else if (this.checkIsInProgress && startCheckLinksButton.val() === "Check") {
            showNotification("Please wait and retry later.")
        }
        else {
            this.stopCheckLinks();
            this.abortCheckLinks = true;
        }
    }

    stopCheckLinks() {
        $("#start-check-links").val("Check");
        $("#current-link-title").text("");
        $("#current-link-url").text("");
        $("#current-link").css("visibility", "hidden");
        this.abortCheckLinks = false;

        if (this.resultCount)
            $("#delete-selected-links").show();

        if ($("#update-icons").is(":checked")) {
            setTimeout(() => send.nodesUpdated(), 500);
        }
    }
}

export function load() {
    return new LinkChecker().init();
}
