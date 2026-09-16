import {BROWSER_EXTERNAL_TYPE, NODE_TYPE_FILE, NODE_TYPE_NOTES, RDF_EXTERNAL_TYPE} from "../storage.js";
import {formatBytes} from "../utils.js";

const DEFAULT_CONTAINER = "--default-container";

function showDlg(name, data, init = () => {}) {
    if ($(".dlg-dim:visible").length)
        return

    let $dlg = $(".dlg-dim.dlg-" + name).clone().prependTo(document.body);

    init($dlg);

    if (data.width)
        $dlg.find(".dlg").css("width", data.width);

    if (data.wrap)
        $dlg.find(".dlg-table .row").css("white-space", "normal");

    $dlg.show();

    if (name === "prompt")
        setTimeout(() => $("input.dialog-input", $dlg).focus());

    data = data || {}
    $dlg.html($dlg.html().replace(/\[([^\[\]]+?)\]/g, function (a, b) {
        return data[b] || ""
    }));
    $dlg.find("input").each(function () {
        if (this.name) {
            if (this.type === "radio") {
                if (this.value == data[this.name])
                    this.checked = true;
            } else {
                if (typeof data[this.name] != "undefined" && !(this.name === "icon" && data["icon"]?.startsWith("var(")))
                    this.value = data[this.name];
            }
        }
    });
    $dlg.find("textarea").each(function () {
        if (typeof data[this.name] != "undefined")
            this.value = data[this.name];
    });

    // fill in object size
    if (data.size) {
        let size = $dlg.find("#prop-size");
        size.text(formatBytes(data.size));
    }

    $dlg.find("input.button-ok").unbind(".dlg");
    $dlg.find("input.button-cancel").unbind(".dlg");
    //$dlg.find("input.dialog-input").first().focus();

    $(".more-properties", $dlg).hide();

    if (data.external === RDF_EXTERNAL_TYPE)
        $("#copy-reference-url").hide();

    // handle bookmark comments
    const commentsIcon = $dlg.find("#prop-dlg-comments-icon").first();
    if (commentsIcon.length) {
        if (data.external === BROWSER_EXTERNAL_TYPE)
            commentsIcon.hide();

        let comments_container = $dlg.find(" #dlg-comments-container").first();
        let dlg_title = $dlg.find(" #prop-dlg-title-text").first();

        if (data.comments) {
            commentsIcon.css("background-image", "var(--themed-comments-filled-icon)");
        }
        else
            commentsIcon.css("background-image", "var(--themed-comments-icon)");

        let old_icon = commentsIcon.css("background-image");

        commentsIcon.click(e => {
            comments_container.toggle();
            if (comments_container.is(":visible")) {
                commentsIcon.css("background-image", "var(--themed-properties-icon)");
                commentsIcon.attr("title", "Properties");
                dlg_title.text("Comments");
            }
            else {
                commentsIcon.css("background-image", old_icon);
                commentsIcon.attr("title", "Comments");
                dlg_title.text("Properties");
            }
        });
    }

    // handle bookmark containers
    const containersIcon = $dlg.find("#prop-dlg-containers-icon").first();
    if (browser.contextualIdentities && containersIcon.length && data.type !== NODE_TYPE_NOTES) {
        containersIcon.click(() => {
            $("#containers-menu", $dlg).toggle();
        });

        let containers_menu = $dlg.find("#containers-menu").first();
        let icon_style = `background-image: var(--themed-containers-icon); background-size: 15px 15px;`
                       + `background-repeat: no-repeat; background-position: center; background-color: transparent !important`;
        let container_item = `<div class="container-item" id="${DEFAULT_CONTAINER}"><i class="container-icon" style='${icon_style}'></i>`
            + `Default</div>`;

        containers_menu.append(container_item);

        if (data.containers)
            for (let container of data.containers) {
                icon_style = `mask-image: url("${container.iconUrl}"); mask-size: contain; `
                    + `mask-repeat: no-repeat; mask-position: center; background-color: ${container.colorCode} !important;`

                container_item = `<div class="container-item" id="${container.cookieStoreId}">`
                               +`<i class="container-icon" style='${icon_style}'></i>${container.name}</div>`;

                containers_menu.append(container_item);
            }

        let makeButtonStyle = (elt) => {
            let style = $("i", elt).attr("style") + "background-image: none; ";

            if (elt.id !== DEFAULT_CONTAINER)
                style += " margin-top: 0;"

            return style;
        }

        $(".container-item").click(e => {
            containersIcon.attr("style", makeButtonStyle(e.target));
            data.container = e.target.id;

            if (data.container === DEFAULT_CONTAINER)
                data.container = null;
        });

        if (data.container && data.container !== DEFAULT_CONTAINER) {
            let elt = $(`#${data.container}`, containers_menu).get(0);
            if (elt)
                containersIcon.attr("style", makeButtonStyle(elt));
        }
    }
    else {
        containersIcon.remove();
    }

    const bookmarkIconDiv = $dlg.find("#prop-title-icon-image").first();
    if (bookmarkIconDiv.length) {
        if (data.type === NODE_TYPE_NOTES || data.type === NODE_TYPE_FILE)
            bookmarkIconDiv.hide();
        else if (data.displayed_icon)
            bookmarkIconDiv.css("background-image", `url("${data.displayed_icon}")`);
        else
            bookmarkIconDiv.css("background-image", `var(--themed-globe-icon)`);

        bookmarkIconDiv.on("click.dlg", () => {
            $dlg.find("#prop-row-user_icon").show();
        });
    }

    const doNotAssign = ["date_added"];

    /** return promise object */
    let promise = new Promise(function (resolve, reject) {
        function proceed() {
            var data = {};
            $dlg.find("input").each(function () {
                if (this.name) {
                    if (this.type == "radio") {
                        if (this.checked)
                            data[this.name] = $(this).val();
                    } else {
                        if (!doNotAssign.some(p => p === this.name))
                            data[this.name] = $(this).val();
                    }
                }
            })
            $dlg.find("select").each(function () {
                if (this.name)
                    data[this.name] = $(this).val();
            })
            $dlg.find("textarea").each(function () {
                if (this.name)
                    data[this.name] = $(this).val();
            })
            $dlg.remove();
            resolve(data);
            // callback && callback(data);
        }

        $dlg.find("input.button-ok").bind("click.dlg", proceed);
        $dlg.find("input.dialog-input").bind("keydown.dlg", ev => {
            if (ev.key == "Enter")
                proceed()
            if (ev.key == "Escape")
                $dlg.remove();
        });
        $dlg.find("input.button-cancel").bind("click.dlg", function () {
            $dlg.remove();
            resolve(null);
        });

        let morePropertiesLink = $dlg.find("#more-properties");

        morePropertiesLink.bind("click.dlg", function () {
            if (morePropertiesLink.text() === "More") {
                let fields = $(".more-properties");

                fields = fields.filter(function() {
                    if (!["prop-row-size"].some(id => this.id === id))
                        return true;

                    if (this.id === "prop-row-size" && data.size)
                        return true;

                    return false;
                });

                fields.show();
                morePropertiesLink.text("Less");
            }
            else {
                $(".more-properties").hide();
                morePropertiesLink.text("More");
            }
        });

        let setDefaultIconLink = $dlg.find("#set-default-icon");

        setDefaultIconLink.bind("click.dlg", function () {
            $dlg.find("#prop-user_icon").val("");
        });

        let copyReferenceLink = $dlg.find("#copy-reference-url");

        copyReferenceLink.bind("click.dlg", function () {
            let url = "ext+scrapyard://" + $dlg.find("#prop-uuid").val();
            navigator.clipboard.writeText(url);
        });
    });
    return promise;
}

function alert(title, message) {
    return showDlg("alert", {title, message});
}

function confirm(title, message) {
    return showDlg("confirm", {title, message});
}

function showUploadDlg() {
    if ($(".dlg-dim:visible").length)
        return;

    let $dlg = $(".dlg-dim.dlg-upload").clone().prependTo(document.body);
    $dlg.show();

    const fileRow = $dlg.find("#upload-file-row");
    const pathRow = $dlg.find("#upload-path-row");
    const fileInput = $dlg.find("#upload-file-input")[0];
    const pathInput = $dlg.find("#upload-path-input")[0];

    const close = () => $dlg.remove();

    return new Promise(resolve => {
        $dlg.find("input.button-cancel").bind("click.dlg", () => {
            close();
            resolve(null);
        });

        $dlg.find("input.dialog-input").bind("keydown.dlg", ev => {
            if (ev.key === "Enter")
                $dlg.find("input.button-ok").trigger("click");
        });

        $dlg.find("input.button-ok").bind("click.dlg", async () => {
            if (pathRow.is(":visible")) {
                if (pathInput.value) {
                    close();
                    resolve({path: pathInput.value});
                }
                return;
            }

            const file = fileInput.files && fileInput.files[0];
            if (!file)
                return;

            if (/\.html?$/i.test(file.name)) {
                $dlg.hide();
                const proceed = await confirm("Upload",
                    "Capture this page with its linked resources <br>(images, stylesheets, etc.)?<br>"
                    + "This requires the full path of the file.");

                if (proceed) {
                    fileRow.hide();
                    pathRow.show();
                    pathInput.value = "";
                    $dlg.show();
                    pathInput.focus();
                    return;
                }
            }

            close();
            resolve({file});
        });
    });
}

export {showDlg, alert, confirm, showUploadDlg}
