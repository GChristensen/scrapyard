import {settings} from "./settings.js"
import {Backend} from "./backend.js"
import {scriptsAllowed, showNotification, getColorFilter} from "./utils.js"
import {getMainMimeExt} from "./libs/mime.types.js"

var currTree;
var windowId;

var msg_hub = new MsgHub();

let backend = new Backend("http://localhost:31800", "default:default");

const DEFAULT_SHELF_NAME = "default"

/* show members of an object */
function dir(o, delimiter){
    var a = [];
    for(let i in o){
        a.push(i)
    }
    return a.join(delimiter || "\n");
}
function withCurrTab(fn){
    browser.tabs.query({currentWindow: true, active: true}).then(function(tabs){
        fn.apply(null, [tabs[0]]);
    });
}
function genItemId(){
    return new Date().format("yyyyMMddhhmmss");
}
function saveRdf(){
}
function getCurrContainer(){
    var $container;
    var $f = $(".item.focus");
    if($f.length){
    	if($f.hasClass("folder")){
    	    $container = $f.next(".folder-content");
    	}else{
    	    $container = $f.parent(".folder-content");
    	}
    }else{
    	$container = $(".root.folder-content");
    }
    return $container;;
}
function getCurrRefId(){
    var $f = $(".item.focus");
    if($f.length){
    	if(!$f.hasClass("folder")){
    	    return $f.attr("id");
    	}
    }
}
function showDlg(name, data, callback){
    if($(".dlg-cover:visible").length)
	return
    var $dlg = $(".dlg-cover.dlg-" + name).clone().appendTo(document.body);
    $dlg.show();
    data = data||{}
    $dlg.html($dlg.html().replace(/\[([^\[\]]+?)\]/g, function(a, b){
	return data[b] || ""
    }));
    $dlg.find("input").each(function(){
	if(this.name){
	    if(this.type=="radio"){
		if(this.value == data[this.name])
		    this.checked = true;
	    } else {
		if(typeof data[this.name] != "undefined")
		    this.value = data[this.name];
	    }
	}
    });
    $dlg.find("input.button-ok").unbind(".dlg");
    $dlg.find("input.button-cancel").unbind(".dlg");
    $dlg.find("input.dialog-input").first().focus();
    /** return promise object */
    var p = new Promise(function(resolve, reject){
        function proceed() {
            var data = {};
            $dlg.find("input").each(function(){
                if(this.name){
                    if(this.type=="radio"){
                        if(this.checked)
                            data[this.name] = $(this).val();
                    }else{
                        data[this.name] = $(this).val();
                    }
                }
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
        $dlg.find("input.button-cancel").bind("click.dlg", function(){
           $dlg.remove();
	    });
    });
    return p;
}
function alert(title, message){
   return showDlg("alert", {title:title.translate(), message:message.translate()});
}
function confirm(title, message){
   return showDlg("confirm", {title:title.translate(), message:message.translate()});
}
// /* context menu listener */
// var menulistener={};
// menulistener.onDelete = function(){
//     confirm("{Warning}", "{ConfirmDeleteItem}").then(function(){
// 	currTree.removeItem($(".item.focus"), function(){
// 	    saveRdf(); // all done (all sub nodes removed)
// 	});
//     });
// }
// menulistener.onCreateFolder = function(){
//     showDlg("folder", {}).then(function(d){
// 	var p;
// 	if(d.pos == "root"){
// 	    p = $(".root.folder-content");
// 	}else{
// 	    p = getCurrContainer();
// 	}
//     	currTree.createFolder(p, genItemId(), getCurrRefId(), d.title, true);
//     	saveRdf();
//     });
// }
// menulistener.onCreateSeparator = function(){
//     currTree.createSeparator(getCurrContainer(), genItemId(), getCurrRefId(), true);
// }
// menulistener.onDebug = function(){}
// menulistener.onRename = function(){
//     if($(".item.focus").length){
//     	var $label = $(".item.focus label");
//     	var t0 = $(".item.focus").attr("title");
// 	showDlg("prompt", {pos:"root", title: t0.htmlDecode()}).then(function(d){
// 	    var t1 = d.title.htmlEncode();
// 	    if(t1 != t0){
//    		currTree.renameItem($(".item.focus"), t1, function(){
//     		    saveRdf();
//     		});
// 	    }
// 	});
//     }
// }
function showRdfList(){
    var lastRdf = settings.last_rdf;
    $("#listRdf").html("");
    var saw = false;

    backend.httpGet("/api/list/shelves", (shelves) => {
        $("#listRdf").find("option").remove()
        for (let shelf of shelves) {
            var $opt = $("<option></option>").appendTo($("#listRdf")).html(shelf.name).attr("value", shelf.id);
            if(!saw && typeof lastRdf != "undefined" && shelf.id == lastRdf){
                saw = true;
                $opt.attr("selected", true);
            }
        }
        switchRdf($("#listRdf").val());
    });
}
function applyColor(){
    // var id = "scrapyard_setting_style";
    // $("#"+id).remove();
    // var sheet = document.createElement('style');
    // sheet.id=id;
    //
    // var item_h = parseInt(settings.font_size) * 1.4;
    // var origin_h = parseInt(settings.font_size) * 0.75;
    // var bg_color = settings.bg_color;
    //
    // sheet.innerHTML = [
	// "*{color:", settings.font_color, "}",
	// ".item.local, .item.folder{color:#", settings.font_color, "}",
	// ".item.bookmark label{color:#", settings.bookmark_color, "}",
	// ".toolbar{backgroud-color:#", settings.bg_color, "}",
	// "body{background:#", settings.bg_color, "}",
    //     ".toolbar{border-color:#", settings.separator_color, ";background:#", settings.bg_color, "}",
	// ".item.separator{border-color:#", settings.bg_color, ";background:#", settings.separator_color, "}",
    //     ".tool-button{", getColorFilter("#"+settings.font_color).filter, "}",
    //     `.item.local,.item.bookmark,.item.folder{padding-left:${item_h}px;background-size:${item_h}px ${item_h}px;font-size:${settings.font_size}px;line-height:${item_h}px}`,
    //     //`.folder-content{margin-left:${item_h}px}`,
    //     `.item .origin{background-size:${origin_h}px ${origin_h}px};`
    // ].join("");
    //
    // document.body.appendChild(sheet);
}
// window.addEventListener("storage", function(e){
//     if(e.key == "rdf_path_names" || e.key == "rdf_paths"){
// 	showRdfList();
//     }else if(e.key == "font_size" || e.key.match(/\w+_color/)){
// 	applyColor();
//     }else if(e.key == "last_rdf"){
//     }else if(e.key == "backend_port"){
// 	msg_hub.send('START_WEB_SERVER_REQUEST', {port: settings.backend_port}, function(){
// 	    loadAll();
// 	});
//     }
// });
/* on page loaded */
function loadAll(){    
    /** rdf list */
    showRdfList(); /** this will trigger loading a rdf initially */
    $("#listRdf").change(function(){
	    switchRdf(this.value);  // switch rdf and notify other side bar.
    });
}

function populateTree(data) {
    $("#treeview").jstree({
        plugins : ["themes", "ui", "contextmenu"],
        core: {
            worker: false,
            animation: 0,
            data: data,
            themes: {
                name: "default",
                dots: false,
                icons: true,
            }
        }
    });
}

function switchRdf(rdf){
    settings.set('last_rdf', rdf);

    let path = $(`#listRdf option[value="${rdf}"]`).text();

    backend.httpPost("/api/list/nodes", {
           path: path
        },
        nodes => {

            for (let n of nodes) {
                n.text = n.name;
                delete n.name;

                n.parent = n.parent_id;
                if (!n.parent)
                    n.parent = "#";

                if (n.type == 1)
                    n.icon = "/icons/group.svg";
                else
                    n.li_attr = { "class": "show_tooltip",
                                  "title": `${n.text}\x0A${n.uri}` };

                if (!n.icon)
                    n.icon = "/icons/homepage.png";
            }

            $('#treeview').jstree(true).settings.core.data = nodes;
            $('#treeview').jstree(true).refresh();

            populateTree(nodes);
        },
        error => {
            console.log(error);
        });
}
function requestUrlSaving(itemId){
    withCurrTab(function(tab){
	var icon = tab.favIconUrl;
	var ref_id;
	function Next(){
	    var $container = null;
	    var $f = $(".item.focus");
	    if($f.length){
		if($f.hasClass("folder")){
	    	    $container = $f.next(".folder-content");
		}else{
		    ref_id=$f.attr("id");
	    	    $container = $f.parent(".folder-content");
		}
	    }else{
		$container = $(".root.folder-content");
	    }
	    currTree.createLink(getCurrContainer(), "bookmark", itemId, getCurrRefId(), tab.url, icon, tab.title, false, true);
	    saveRdf();
	    showNotification({message: `Capture url "${tab.title}" done`, title: "Info"});
	}
	if(icon.match(/^data:image/i)){
	    var rdf_path = settings.getLastRdfPath();
	    var filename = `${rdf_path}/data/${itemId}/favicon.ico`;
	    $.post(settings.backend_url + "download", {url: icon, itemId: itemId, filename: filename}, function(r){
		icon = "resource://scrapbook/data/" + itemId + "/favicon.ico";
		Next();
	    })
	}else{
	    Next();
	}
    });
}
function requestPageSaving(itemId, type){
    withCurrTab(async function(tab){
	var ico = "icons/loading.gif"
	try{
	    if (!(await scriptsAllowed(tab.id))) {
		var err = "Content script is not allowed on this page";
		log.error(err)
		await showNotification({message: err, title: "Error"});
		return;
	    }
	    currTree.createLink(getCurrContainer(), "local", itemId, getCurrRefId(), tab.url, ico, tab.title, true, true);
            browser.tabs.sendMessage(tab.id, {type: type, itemId: itemId, windowId: windowId}, null);
	}catch(e){
	    log.error(e.message)
	}
    });
}
function updateMenuItem(t){
    browser.contextMenus.removeAll(function(){
        browser.contextMenus.create({id: "catch", title: `catch ${t}`, onclick:function(){}});
    });
}
function withFocusedWindow(callback){
    browser.windows.getLastFocused().then((win) => callback(win));
}

/* receive message from background page */
browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type == 'UPDATE_CONTEXTMENU_REQUEST') {

    } else if (request.type == 'SAVE_CONTENT2') {
        savePage2(request.path, request.title, request.content);
    } else if (request.type == 'SAVE_CONTENT' && request.windowId == windowId) {
        savePage(request.itemId, request.content.title, request.content.html,
            request.content.css, request.content.res, function () {
            browser.tabs.sendMessage(sender.tab.id, {
                type: 'SAVE_CONTENT_FINISHED',
                itemId: request.itemId,
                title: request.content.title
            }, null);
        });
    } else if (request.type == 'GET_OTHER_INSTANCE_REQUEST') {
        browser.runtime.sendMessage({session_id: request.session_id});
    } else if (request.type == 'RDF_EDITED') {
        if (request.content.rdf == currTree.rdf) {
            alert("{Warning}", "{SAME_RDF_MODIFIED}").then(function (r) {
                //loadXml(currTree.rdf);
            });
        }
    } else if (request.type == 'SAVE_PAGE_SELECTION_REQUEST') {
        if (currTree && currTree.rendered) {
            withFocusedWindow(function (win) {
                if (win.id == windowId)
                    requestPageSaving(genItemId(), 'GET_PAGE_SELECTION_REQUEST');
            });
        } else {
            log.error("rdf have not been loaded")
        }
    } else if (request.type == 'SAVE_PAGE_REQUEST') {
        if (currTree && currTree.rendered) {
            withFocusedWindow(function (win) {
                if (win.id == windowId) {
                    requestPageSaving(genItemId(), 'GET_PAGE_REQUEST');
                }
            });
        } else {
            log.error("rdf have not been loaded")
        }
    } else if (request.type == 'SAVE_URL_REQUEST') {
        if (currTree && currTree.rendered) {
            withFocusedWindow(function (win) {
                if (win.id == windowId)
                    requestUrlSaving(genItemId());
            });
        } else {
            log.error("rdf have not been loaded")
        }
    }
});
msg_hub.send('GET_OTHER_INSTANCE_REQUEST', '', function(response){
    // alert("Warning", "Found another window")
});
function postBlob(url, blob, filename, itemId, onload, onerror){
    var rdf_path = currTree.rdf_path;
    var formData = new FormData();
    formData.append("filename", `${rdf_path}/data/${itemId}/${filename}`);
    formData.append("file", blob);   // add file object
    var request = new XMLHttpRequest();
    request.open("POST", url, false);
    // request.responseType='text';
    request.onload = function(oEvent) {
	onload && onload();
    };
    request.onerror = function(oEvent) {
	onerror && onerror();
    };    
    request.send(formData);
}
function savePage(itemId, title, content, css, res, callback){
    var finished=0, all=0;
    $.each(res, function(i, item){
	if(item.blob) all++;
    });
    $.each(res, function(i, item){
	if(item.blob){
	    var ext = getMainMimeExt(item.blob.type) || "";
            var reg = new RegExp(item.hex, "g" )
     	    if(item.hex)content = content.replace(reg, item.hex+ext);
	    postBlob(settings.backend_url + "savebinfile", item.blob, item.filename || (item.hex+ext), itemId, function(){
	    	if(++finished == all){
		    content = ['<!Doctype html>', content,].join("\n");
		    var rdf_path = currTree.rdf_path;
		    $.post(settings.backend_url + "savefile", {filename: `${rdf_path}/data/${itemId}/index.html`, content: content}, function(r){
			$.post(settings.backend_url + "savefile", {filename:`${rdf_path}/data/${itemId}/index.css`, content:css, folder:settings.getLastRdfPath() + "data/" + itemId}, function(r){
			    /** update the icon */
			    var icon = "resource://scrapbook/data/" + itemId + "/favicon.ico";
			    $("#"+itemId).removeAttr("disabled");
			    currTree.updateItemIcon($("#"+itemId), icon);
			    /** save xml file when all files uploaded */
			    saveRdf();
			    showNotification({message: `Capture content of "${title}" done`, title: "Info"});
			    callback && callback();
			});
		    });
		}
	    }, function(){
	    	// error
	    });
	}
    });
}
function savePage2(path, title, content){
    $.post(settings.backend_url + "savefile", {filename: `${path}/index.html`, content: content}, function(r){
	showNotification({message: `Save content of "${title}" done`, title: "Info"});
    });
}
document.addEventListener('contextmenu', function(event){
    if($(".dlg-cover:visible").length)
	event.preventDefault()
    return false;
});
browser.windows.getCurrent({populate: true}).then((windowInfo) => {
    windowId = windowInfo.id;
});

window.onclick = function(event) {
    if (!event.target.matches("#shelf-menu-button"))
        $(".simple-menu").hide();
};

window.onload=function(){
    /* i18n */
    document.title = document.title.translate();
    document.body.innerHTML = document.body.innerHTML.translate();
    var btn = document.getElementById("btnLoad");
    btn.onclick = function(){
        //if(currTree && currTree.rdf)loadXml(currTree.rdf);
    };
    var btn = document.getElementById("btnSet");
    btn.onclick = function(){
        browser.tabs.create({
            "url": "options.html"
        });
    }
    var btn = document.getElementById("btnHelp");
    btn.onclick = function(){
        browser.tabs.create({
            "url": "options.html#help"
        });
    }
    var btn = document.getElementById("btnSearch");
    btn.onclick = function(){
        browser.tabs.create({
            "url": "search.html"
        });
    }

    $("#shelf-menu-button").click(() => {$("#shelf-menu").toggle()});
    $("#shelf-menu-create").click(() => {

        showDlg("prompt").then(data => {
            let name;
            if (name = data.title) {
                let existingOption = $(`#listRdf option:contains("${name}")`);
                let selectedOption = $("#listRdf option:selected");

                if (existingOption.length) {
                    selectedOption.removeAttr("selected");
                    existingOption.attr("selected", true);

                    // TODO: add tree switching
                }

                if (name !== DEFAULT_SHELF_NAME) {
                    backend.httpPost("/api/create/shelf", {"name": name}, (shelf) => {
                            if (shelf) {
                                selectedOption.removeAttr("selected");
                                $("<option></option>").appendTo($("#listRdf"))
                                    .html(shelf.name)
                                    .attr("value", shelf.id)
                                    .attr("selected", true);

                                switchRdf(shelf.id);
                            }
                        }
                    );
                }
            }
        });
    });

    $("#shelf-menu-rename").click(() => {
        let selectedOption = $("#listRdf option:selected");
        let name = selectedOption.text();

        if (name && name !== DEFAULT_SHELF_NAME) {
            // TODO: 118n
            showDlg("prompt").then(data => {
                let newName;
                if (newName = data.title) {
                    backend.httpPost("/api/rename/shelf", {"name": name, "new_name": newName}, () => {
                            selectedOption.html(newName);
                        },
                        e => {
                            console.log(JSON.stringify(e))
                        }
                    );
                }
            });
        }

    });

    $("#shelf-menu-delete").click(() => {
        let selectedOption = $("#listRdf option:selected");
        let name = selectedOption.text();

        // TODO: 118n
        confirm( "{Warning}", "Do you really want to delete '" + name + "'?").then(() => {
            if (name && name !== DEFAULT_SHELF_NAME) {
                backend.httpPost("/api/delete/shelf", {"name": name}, () => {
                        let prevItem = null;
                        let found = false;
                        $("#listRdf option").each((i, o) => {
                            if (found) {
                                return;
                            }

                            if (o.value === selectedOption.val()) {
                                found = true;
                                return;
                            }
                            prevItem = o;
                        });

                        selectedOption.removeAttr("selected");
                        if (prevItem) {
                            $(prevItem).attr("selected", true);
                            switchRdf(prevItem.value);
                        }
                        selectedOption.remove();
                    },
                    e => {
                        console.log(JSON.stringify(e))
                    }
                );
            }
        });
    });

    populateTree();
    loadAll();
};
console.log("==> main.js loaded");
