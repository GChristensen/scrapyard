/************************************************************************/
/*                                                                      */
/*      Save Page WE - Generic WebExtension - Content Pages             */
/*                                                                      */
/*      Javascript for Saving Content Pages (main frame)                */
/*                                                                      */
/*      Last Edit - 31 Mar 2023                                         */
/*                                                                      */
/*      Copyright (C) 2016-2023 DW-dev                                  */
/*                                                                      */
/*      Distributed under the GNU General Public License version 2      */
/*      See LICENCE.txt file and http://www.gnu.org/licenses/           */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/* Refer to Google Chrome developer documentation:                      */
/*                                                                      */
/*  https://developer.chrome.com/extensions/content_scripts             */
/*  https://developer.chrome.com/extensions/messaging                   */
/*  https://developer.chrome.com/extensions/xhr                         */
/*                                                                      */
/*  https://developer.chrome.com/extensions/match_patterns              */
/*                                                                      */
/*  https://developer.chrome.com/extensions/runtime                     */
/*  https://developer.chrome.com/extensions/storage                     */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Saving Pages in Background Tabs                                     */
/*                                                                      */
/*  Using the window.setTimeout() function in the content script        */
/*  causes long delays when saving a page in a background tab.          */
/*  Browsers always increase the timeout to at least one second and     */
/*  sometimes the timeout can be many seconds.                          */
/*                                                                      */
/*  The solution is to send a message from the content script to the    */
/*  background script requesting a delay and wait for the response.     */
/*  The background script calls the window.setTimeout() function and    */
/*  sends an asynchronous response when the timeout expires.            */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Lazy Load JS Libraries                                              */
/*                                                                      */
/*  Libraries that manage lazy loading of images in <img> elements.     */
/*                                                                      */
/*  lazysizes           data-src         data-srcset                    */
/*                                                                      */
/*  lazyload.js         data-src         data-srcset                    */
/*  (old version)       data-original    data-original-set              */
/*                                                                      */
/*  Lozad               data-src         data-srcset                    */
/*                                                                      */
/*  Vanilla Lazyload    data-src         data-srcset                    */
/*                                                                      */
/*  Layzr.js            data-normal      data-srcset                    */
/*                                                                      */
/*  blazy.js            data-src         -                              */
/*                                                                      */
/*  lazyestload.js      data-src         data-srcset                    */
/*                                                                      */
/*  yall.js             data-src         data-srcset                    */
/*                                                                      */
/*  responsivelyLazy    -                data-srcset                    */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  CSS-in-JS Libraries                                                 */
/*                                                                      */
/*  For <style> elements there may be rules in element.sheet.cssRules   */
/*  that are not in element.textContent.                                */
/*                                                                      */
/*  This is often the case for CSS-in-JS libraries, for example:        */
/*                                                                      */
/*  - Styled Components v3.1.6 Issue #1571                              */
/*    - ref. https://github.com/styled-components/                      */
/*           styled-components/issues/1571                              */
/*                                                                      */
/*  - Styled Components >= v4 - data-styled attribute                   */
/*    - e.g. observationdeck.kinja.com pages                            */
/*                                                                      */
/*  - Styled Components <= v3 - data-styled-components attribute        */
/*    - e.g. reddit.com pages                                           */
/*                                                                      */
/*  - Styled Components >= v4 - data-styled attribute                   */
/*    - e.g. observationdeck.kinja.com pages                            */
/*                                                                      */
/*  - Styled JSX - data-styled-jsx attribute                            */
/*    - e.g. www.flightstats.com pages                                  */
/*                                                                      */
/*  - React Native - id="react-native-stylesheet" attribute             */
/*    - e.g. twitter.com pages                                          */
/*                                                                      */
/*  - React-JSS or JSS - data-jss attribute                             */
/*    - e.g. https://www.dailykos.com                                   */
/*                                                                      */
/*  - Glamor - data-glamor attribute                                    */
/*    - e.g. https://www.dailykos.com                                   */
/*                                                                      */
/*  - Emotion - data-emotion attribute                                  */
/*    - not tested                                                      */
/*                                                                      */
/*  - Aphrodite - data-aphrodite attribute                              */
/*    - not tested                                                      */
/*                                                                      */
/*  - Styletron - data-styletron attribute                              */
/*    - not tested                                                      */
/*                                                                      */
/*  - Unknown - data-lights                                             */
/*    - e.g. https://www.nytimes.com                                    */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Tab Page Types                                                      */
/*                                                                      */
/*   undefined = Unknown                                                */
/*           0 = Normal Page                                            */
/*           1 = Saved Page                                             */
/*           2 = Saved Page with Resource Loader                        */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Tab Save States                                                     */
/*                                                                      */
/*   undefined = Tab does not exist or URL never committed              */
/*          -4 = URL committed (page loading or loaded)                 */
/*          -3 = Script loading                                         */
/*          -2 = Script loaded (page loaded)                            */
/*          -1 = Operation started                                      */
/*           0 = Lazy Loads                                             */
/*           1 = First Pass                                             */
/*           2 = Second Pass                                            */
/*           3 = Third Pass                                             */
/*           4 = Remove Resource Loader                                 */
/*           5 = Extract Image/Audio/Video                              */
/*           6 = Saved                                                  */
/*           7 = Removed                                                */
/*           8 = Extracted                                              */
/*                                                                      */
/************************************************************************/

"use strict";

/************************************************************************/

/* Global variables */

var isFirefox;
var ffVersion;

var platformOS;
var platformArch;

var maxTotalSize;  /* MB */

var showWarning,showResources,promptComments,skipWarningsComments,useNewSaveMethod;
var loadLazyContent,lazyLoadType,loadLazyImages,retainCrossFrames,mergeCSSImages,executeScripts,removeUnsavedURLs,removeElements,rehideElements,includeInfoBar,includeSummary,formatHTML;
var saveHTMLAudioVideo,saveHTMLObjectEmbed,saveHTMLImagesAll;
var saveCSSImagesAll,saveCSSFontsWoff,saveCSSFontsAll,saveScripts;
var savedFileName,replaceSpaces,replaceChar,maxFileNameLength;
var saveDelayTime;
var lazyLoadScrollTime,lazyLoadShrinkTime;
var maxFrameDepth;
var maxResourceSize;
var maxResourceTime;
var allowPassive;
var crossOrigin;
var useAutomation;

var pageType;  /* 0 = normal page, 1 = saved page, 2 = saved page with resource loader */

var menuAction;
var savedItems;
var toggleLazy;
var extractSrcUrl;
var swapDevices;  /* from Print Edit WE*/
var multipleSaves;
var cspRestriction;

var skipLazyLoad,cancelSave;

var htmlCssText,bodyCssText,origScrollY;

var passNumber;

var frameKey = new Array();
var frameURL = new Array();
var frameHTML = new Array();
var frameFonts = new Array();

var resourceCount;

var resourceLocation = new Array();
var resourceReferrer = new Array();
var resourceMimeType = new Array();
var resourceCharSet = new Array();
var resourcePassive = new Array();
var resourceContent = new Array();
var resourceStatus = new Array();
var resourceReason = new Array();
var resourceRemembered = new Array();
var resourceReplaced = new Array();
var resourceCSSRemembered = new Array();  /* number of times CSS image remembered */
var resourceCSSFrameKeys = new Array();  /* keys of frames in which CSS image remembered */

var firstIconLocation;  /* location of first favicon in document head */
var rootIconLocation;  /* location of favicon in website root */

var pageInfoBarText,shadowLoaderText,enteredComments;

var htmlStrings = new Array();

var timeStart = new Array();
var timeFinish = new Array();

var shadowElements = new Array("audio","video","use");  /* HTML & SVG elements that have built-in Shadow DOM */
var hrefSVGElements = new Array("a","altGlyph","animate","animateColor","animateMotion","animateTransform","cursor","discard","feImage","filter","font-face-uri","glyphRef","image",
                                "linearGradient","mpath","pattern","radialGradient","script","set","textPath","tref","use");  /* SVG 1.1 & SVG 2 elements that can have xlink:href or href attribute */

var debugEnable = false;

// Scrapyard //////////////////////////////////////////////////////////////////

var siteCapture;
var frameLinks = [];
var frameIndex = [];
var selectionLinks;

var styleCounter = 1;
var frameCounter = 1;
var resourceFileName = [];
var saveUnpacked;

var scrapyardBookmark;

var selectionElement;
var skipIfSelected;

var loadShadowDom;

var isReddit = location.origin.includes("reddit.com");

function lockDocument() {
    if (document.body.firstChild && document.body.firstChild.id !== "scrapyard-waiting") {
        const imgDomains = ["reddit.com"];
        const lock = document.createElement("div");
        lock.id = "scrapyard-waiting";

        lock.style.zIndex = 2147483647;
        lock.style.margin = "0";
        lock.style.padding = "0";
        lock.style.width = "100%";
        lock.style.height = "100%";
        lock.style.backgroundColor = "#9995";
        lock.style.position = "fixed";
        lock.style.left = lock.style.right = "0";
        lock.style.bottom = lock.style.top = "0";
        lock.style.display = "flex";
        lock.style.alignItems = "center";
        lock.style.justifyContent = "center";

        const useImg = imgDomains.some(d => location.origin.includes(d));
        const elementTagName = useImg? "img": "object";
        const propertyName = useImg? "src": "data";

        const image = document.createElement(elementTagName);
        image.setAttribute(propertyName, browser.runtime.getURL(`icons/lock.svg`));
        image.setAttribute("type", "image/svg+xml");
        lock.appendChild(image);

        document.body.insertBefore(lock, document.body.firstChild);
    }
}

function unlockDocument() {
    let lock = document.getElementById("scrapyard-waiting");

    if (lock)
        document.body.removeChild(lock);
}

function clearDocumentEncoding(doc) {
    let meta = doc.querySelector("meta[http-equiv='content-type' i]")
        || doc.querySelector("meta[charset]");

    if (meta)
        meta.parentNode.removeChild(meta);
}

var subredditVarsCtr = 0;
function scrapyardExcludeElement(element) {
    if (element?.id === "scrapyard-waiting")
        return true;
    else if (isReddit && element?.className?.startsWith && element?.className?.startsWith("subredditvars")
                && subredditVarsCtr === 0) {
        element.style.height = "0";
        subredditVarsCtr++;
        return true;
    }

    return false;
}
////////////////////////////////////////////////////////////////// Scrapyard //

/************************************************************************/

/* Initialize on script load */
// Scrapyard //////////////////////////////////////////////////////////////////
chrome.storage.local.get("savepage-settings",
////////////////////////////////////////////////////////////////// Scrapyard //
function(object)
{
    // Scrapyard //////////////////////////////////////////////////////////////////
    object = object["savepage-settings"];
    ////////////////////////////////////////////////////////////////// Scrapyard //
    /* Load environment */

    isFirefox = object["environment-isfirefox"];

    if (isFirefox) ffVersion = object["environment-ffversion"];

    platformOS = object["environment-platformos"];

    platformArch = object["environment-platformarch"];

    /* Load options */

    showWarning = object["options-showwarning"];
    showResources = object["options-showresources"];
    promptComments = object["options-promptcomments"];
    skipWarningsComments = object["options-skipwarningscomments"];
    useNewSaveMethod = object["options-usenewsavemethod"];

    loadLazyContent = object["options-loadlazycontent"];
    lazyLoadType = object["options-lazyloadtype"];
    loadLazyImages = object["options-loadlazyimages"];
    retainCrossFrames = object["options-retaincrossframes"];
    mergeCSSImages = object["options-mergecssimages"];
    executeScripts = object["options-executescripts"];
    removeUnsavedURLs = object["options-removeunsavedurls"];
    removeElements = object["options-removeelements"];
    rehideElements = object["options-rehideelements"];
    includeInfoBar = object["options-includeinfobar"];
    includeSummary = object["options-includesummary"];
    formatHTML = object["options-formathtml"];

    saveHTMLImagesAll = object["options-savehtmlimagesall"];
    saveHTMLAudioVideo = object["options-savehtmlaudiovideo"];
    saveHTMLObjectEmbed = object["options-savehtmlobjectembed"];
    saveCSSImagesAll = object["options-savecssimagesall"];
    saveCSSFontsWoff = object["options-savecssfontswoff"];
    saveCSSFontsAll = object["options-savecssfontsall"];
    saveScripts = object["options-savescripts"];
    // Scrapyard //////////////////////////////////////////////////////////////////
    loadShadowDom = object["options-loadshadow"];
    ////////////////////////////////////////////////////////////////// Scrapyard //

    savedFileName = object["options-savedfilename"];
    replaceSpaces = object["options-replacespaces"];
    replaceChar = object["options-replacechar"];
    maxFileNameLength = object["options-maxfilenamelength"];

    saveDelayTime = object["options-savedelaytime"];

    lazyLoadScrollTime = object["options-lazyloadscrolltime"];
    lazyLoadShrinkTime = object["options-lazyloadshrinktime"];

    maxFrameDepth = object["options-maxframedepth"];

    maxResourceSize = object["options-maxresourcesize"];

    maxResourceTime = object["options-maxresourcetime"];

    allowPassive = object["options-allowpassive"];

    crossOrigin = object["options-crossorigin"];

    useAutomation = object["options-useautomation"];

    /* Set maximum total size for resources */

    if (platformOS == "win")
    {
        if (isFirefox)
        {
            if (ffVersion < 55) maxTotalSize = 150;  /* 150MB */
            else maxTotalSize = (platformArch == "x86-64") ? 1000 : 400;  /* 64-bit 1000MB, 32-bit 400MB */
        }
        else  /* Chrome */
        {
            maxTotalSize = (platformArch == "x86-64") ? 250 : 500;  /* 64-bit 250MB, 32-bit 500MB */
        }
    }
    else /* linux or mac */
    {
        maxTotalSize = 200;  /* 200MB */
    }

    /* Set page type */

    pageType = (document.querySelector("script[id='savepage-pageloader']") != null ||  /* Version 7.0-14.0 */
                document.querySelector("meta[name='savepage-resourceloader']") != null) ? 2 :  /* Version 15.0-15.1 */
                document.querySelector("meta[name='savepage-url']") != null ? 1 : 0;

    /* Add listeners */

    addListeners();

    /* Script loaded */
    // Scrapyard //////////////////////////////////////////////////////////////////
    chrome.runtime.sendMessage({ type: "CAPTURE_SCRIPT_INITIALIZED" });
    ////////////////////////////////////////////////////////////////// Scrapyard //
});

/************************************************************************/

/* Add listeners */

function addListeners()
{
    /* Storage changed listener */

    chrome.storage.onChanged.addListener(
    function(changes,areaName)
    {
        // Scrapyard //////////////////////////////////////////////////////////////////
        changes = changes["savepage-settings"] || {};
        if (!changes)
            return;
        ////////////////////////////////////////////////////////////////// Scrapyard //

        if ("options-showwarning" in changes) showWarning = changes["options-showwarning"].newValue;
        if ("options-showresources" in changes) showResources = changes["options-showresources"].newValue;
        if ("options-promptcomments" in changes) promptComments = changes["options-promptcomments"].newValue;
        if ("options-skipwarningscomments" in changes) skipWarningsComments = changes["options-skipwarningscomments"].newValue;
        if ("options-usenewsavemethod" in changes) useNewSaveMethod = changes["options-usenewsavemethod"].newValue;

        if ("options-loadlazycontent" in changes) loadLazyContent = changes["options-loadlazycontent"].newValue;
        if ("options-lazyloadtype" in changes) lazyLoadType = changes["options-lazyloadtype"].newValue;
        if ("options-loadlazyimages" in changes) loadLazyImages = changes["options-loadlazyimages"].newValue;
        if ("options-retaincrossframes" in changes) retainCrossFrames = changes["options-retaincrossframes"].newValue;
        if ("options-mergecssimages" in changes) mergeCSSImages = changes["options-mergecssimages"].newValue;
        if ("options-executescripts" in changes) executeScripts = changes["options-executescripts"].newValue;
        if ("options-removeunsavedurls" in changes) removeUnsavedURLs = changes["options-removeunsavedurls"].newValue;
        if ("options-removeelements" in changes) removeElements = changes["options-removeelements"].newValue;
        if ("options-rehideelements" in changes) rehideElements = changes["options-rehideelements"].newValue;
        if ("options-includeinfobar" in changes) includeInfoBar = changes["options-includeinfobar"].newValue;
        if ("options-includesummary" in changes) includeSummary = changes["options-includesummary"].newValue;
        if ("options-formathtml" in changes) formatHTML = changes["options-formathtml"].newValue;

        if ("options-savehtmlimagesall" in changes) saveHTMLImagesAll = changes["options-savehtmlimagesall"].newValue;
        if ("options-savehtmlaudiovideo" in changes) saveHTMLAudioVideo = changes["options-savehtmlaudiovideo"].newValue;
        if ("options-savehtmlobjectembed" in changes) saveHTMLObjectEmbed = changes["options-savehtmlobjectembed"].newValue;
        if ("options-savecssimagesall" in changes) saveCSSImagesAll = changes["options-savecssimagesall"].newValue;
        if ("options-savecssfontswoff" in changes) saveCSSFontsWoff = changes["options-savecssfontswoff"].newValue;
        if ("options-savecssfontsall" in changes) saveCSSFontsAll = changes["options-savecssfontsall"].newValue;
        if ("options-savescripts" in changes) saveScripts = changes["options-savescripts"].newValue;

        if ("options-savedfilename" in changes) savedFileName = changes["options-savedfilename"].newValue;
        if ("options-replacespaces" in changes) replaceSpaces = changes["options-replacespaces"].newValue;
        if ("options-replacechar" in changes) replaceChar = changes["options-replacechar"].newValue;
        if ("options-maxfilenamelength" in changes) maxFileNameLength = changes["options-maxfilenamelength"].newValue;

        if ("options-savedelaytime" in changes) saveDelayTime = changes["options-savedelaytime"].newValue;

        if ("options-lazyloadscrolltime" in changes) lazyLoadScrollTime = changes["options-lazyloadscrolltime"].newValue;
        if ("options-lazyloadshrinktime" in changes) lazyLoadShrinkTime = changes["options-lazyloadshrinktime"].newValue;

        if ("options-maxframedepth" in changes) maxFrameDepth = changes["options-maxframedepth"].newValue;

        if ("options-maxresourcesize" in changes) maxResourceSize = changes["options-maxresourcesize"].newValue;

        if ("options-maxresourcetime" in changes) maxResourceTime = changes["options-maxresourcetime"].newValue;

        if ("options-allowpassive" in changes) allowPassive = changes["options-allowpassive"].newValue;

        if ("options-crossorigin" in changes) crossOrigin = changes["options-crossorigin"].newValue;

        if ("options-useautomation" in changes) useAutomation = changes["options-useautomation"].newValue;
    });

    /* Message received listener */

    chrome.runtime.onMessage.addListener(
    function(message,sender,sendResponse)
    {
        var i,panel,bar;

        switch (message.type)
        {
            /* Messages from background page */

            case "performAction":
                // Scrapyard //////////////////////////////////////////////////////////////////
                sendResponse({ });  /* to confirm content script has been loaded */
                ////////////////////////////////////////////////////////////////// Scrapyard //

                menuAction = message.menuaction;
                savedItems = message.saveditems;
                toggleLazy = message.togglelazy;
                extractSrcUrl = message.extractsrcurl;
                swapDevices = message.swapdevices;
                multipleSaves = message.multiplesaves;
                cspRestriction = message.csprestriction;

                cancelSave = false;

                // Scrapyard //////////////////////////////////////////////////////////////////
                scrapyardBookmark = message.bookmark;
                siteCapture = !!scrapyardBookmark.__site_capture;
                saveUnpacked = scrapyardBookmark.contains === "files";
                mergeCSSImages = !saveUnpacked;

                if (message.selection) {
                    selectionElement = document.createElement("div");
                    selectionElement.style.display = "none";
                    selectionElement.innerHTML = message.selection;

                    document.body.appendChild(selectionElement);

                    let frames = selectionElement.querySelectorAll("iframe, frame");
                    for (let frame of frames)
                        frame.src = frame.src + "#" + Math.floor((Math.random() * 1000000) + 1)

                    if (siteCapture)
                        selectionLinks = collectFrameLinks(selectionElement);
                }
                ////////////////////////////////////////////////////////////////// Scrapyard //

                /* Check if Print Edit WE is in editing mode */

                if (document.getElementById("printedit-gui-container") != null)
                {
                    showMessage("Operation failed","Operation","Print Edit WE must be suspended before performing this operation.",null,cancel);

                    function cancel() { if (menuAction <= 1) chrome.runtime.sendMessage({ type: "saveExit" }); }

                    break;
                }

                /* Close message panel if open */

                panel = document.getElementById("savepage-message-panel-container");

                if (panel != null) document.documentElement.removeChild(panel);

                /* Close lazy load panel if open */

                panel = document.getElementById("savepage-lazyload-panel-container");

                if (panel != null) document.documentElement.removeChild(panel);

                /* Close unsaved resources panel if open */

                panel = document.getElementById("savepage-unsaved-panel-container");

                if (panel != null) document.documentElement.removeChild(panel);

                /* Close comments panel if open */

                panel = document.getElementById("savepage-comments-panel-container");

                if (panel != null) document.documentElement.removeChild(panel);

                /* Close page info panel if open */

                panel = document.getElementById("savepage-pageinfo-panel-container");

                if (panel != null) document.documentElement.removeChild(panel);

                /* Close page info bar if open */

                bar = document.getElementById("savepage-pageinfo-bar-container");

                if (bar != null) document.documentElement.removeChild(bar);

                /* Perform action */

                // Scrapyard //////////////////////////////////////////////////////////////////
                if (menuAction <= 2) {
                    clearDocumentEncoding(document);
                    lockDocument();
                }

                if (document.readyState === "complete")
                {
                    performAction();
                }
                else
                {
                    window.addEventListener("load",
                        function(event)
                        {
                            if (document.readyState === "complete") performAction();
                        },false);
                }
                ////////////////////////////////////////////////////////////////// Scrapyard //

                break;

            case "loadSuccess":

                loadSuccess(message.index,message.reason,message.content,message.mimetype,message.charset);

                break;

            case "loadFailure":

                loadFailure(message.index,message.reason);

                break;

            case "replyFrame":

                i = frameKey.length;

                frameKey[i] = message.key;
                frameURL[i] = message.url;
                frameHTML[i] = message.html;
                frameFonts[i] = message.fonts;
                // Scrapyard //////////////////////////////////////////////////////////////////
                frameLinks[i] = message.links;
                frameIndex[i] = message.index;
                ////////////////////////////////////////////////////////////////// Scrapyard //

                break;

            // Scrapyard //////////////////////////////////////////////////////////////////
            case "UNLOCK_DOCUMENT":
                unlockDocument();
                break;
            ////////////////////////////////////////////////////////////////// Scrapyard //

            case "cancelSave":

                cancelSave = true;

                break;
        }
    });
}

/************************************************************************/

/* Perform action function */

function performAction()
{
    // Scrapyard //////////////////////////////////////////////////////////////////
    if (menuAction <= 1)  /* save page */
    {
        if (pageType < 2)  /* not saved page with resource loader */
        {
            new Promise(resolve => setTimeout(() => resolve(), saveDelayTime*1000)).then(   /* allow time for more content to load (e.g. search results) */
            function(object)
            {
                if (loadLazyContent) forceLazyContent(); // do not use toggleLazy in message
                else
                {
                    if (loadLazyImages) forceLazyImages();

                    initializeBeforeSave();
                }
            });
        }
        else  /* saved page with resource loader */
        {
            showMessage("Save Page failed","Save","This page was loaded using resource loader.\n\nRemove resource loader and then save page.",null,cancel);

            function cancel() { chrome.runtime.sendMessage({ type: "saveExit" }); }
        }
    }
    // else if (menuAction == 2)  /* view saved page info */
    // {
    //     if (pageType > 0)  /* saved page */
    //     {
    //         viewSavedPageInfo();
    //     }
    //     else  /* not saved page */
    //     {
    //         showMessage("View Saved Page Info failed","View Info","This page was not saved by Save Page WE.\n\nCannot perform this operation.",null,null);
    //     }
    // }
    ////////////////////////////////////////////////////////////////// Scrapyard //
    else if (menuAction == 3)  /* remove resource loader */
    {
        if (pageType == 2)  /* saved page with resource loader */
        {
            removeResourceLoader();
        }
        else  /* not saved page with resource loader */
        {
            if (pageType == 1) showMessage("Remove Resource Loader failed","Remove","This page was not loaded using resource loader.\n\nCannot perform this operation.",null,null);
            else showMessage("Remove Resource Loader failed","Remove","This page was not saved by Save Page WE.\n\nCannot perform this operation.",null,null);
        }
    }
    else if (menuAction == 4)  /* extract saved page media (image/audio/video) */
    {
        if (pageType > 0)  /* saved page */
        {
            extractSavedPageMedia();
        }
        else  /* not saved page */
        {
            showMessage("Extract Image/Audio/Video failed","Extract","This page was not saved by Save Page WE.\n\nCannot perform this operation.",null,null);
        }
    }
}

/************************************************************************/

/* Load lazy content */

function forceLazyContent()
{
    var origscrolly,scrolly,panel,scalex,scaley,originx,originy,lastscrollheight;
    var starttime,endtime;

    skipLazyLoad = false;

    // Scrapyard //////////////////////////////////////////////////////////////////
    if (lazyLoadType == 1)  /* scroll page; Scrapyard uses value 1 */
    ////////////////////////////////////////////////////////////////// Scrapyard //
    {
        chrome.runtime.sendMessage({ type: "setSaveState", savestate: 0 });

        showLazyLoad();

        starttime = performance.now();

        origscrolly = window.scrollY;
        scrolly = 0;

        window.scrollTo(0,scrolly);

        if (debugEnable) console.log("INITIAL  -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scroll Y: " + scrolly);

        // Scrapyard //////////////////////////////////////////////////////////////////
        new Promise(resolve => setTimeout(() => resolve(), lazyLoadScrollTime*1000)).then(   /* allow time for first lazy loads to complete */
        ////////////////////////////////////////////////////////////////// Scrapyard //
        function timer(object)
        {
            if (scrolly < document.documentElement.scrollHeight && !skipLazyLoad && !cancelSave)
            {
                if (debugEnable) console.log("GROWING  -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scroll Y: " + scrolly);

                scrolly += window.innerHeight;

                window.scrollTo(0,scrolly);

                // Scrapyard //////////////////////////////////////////////////////////////////
                new Promise(resolve => setTimeout(() => resolve(), lazyLoadScrollTime*1000)).then(   /* allow time for some more lazy loads to complete */
                ////////////////////////////////////////////////////////////////// Scrapyard //
                function(object)
                {
                    timer();
                });
            }
            else
            {
                if (debugEnable) console.log("WAITING  -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scroll Y: " + scrolly);

                window.scrollTo(0,document.documentElement.scrollHeight-window.innerHeight-10);
                window.scrollTo(0,document.documentElement.scrollHeight);

                // Scrapyard //////////////////////////////////////////////////////////////////
                new Promise(resolve => setTimeout(() => resolve(), 500+lazyLoadScrollTime*1000)).then(   /* allow time for final lazy loads to complete */
                ////////////////////////////////////////////////////////////////// Scrapyard //
                function(object)
                {
                    if (debugEnable) console.log("FINISHED -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scroll Y: " + scrolly);

                    endtime = performance.now();

                    if (debugEnable) console.log("LAZY LOAD TIME: " + (endtime-starttime)/1000 + "secs");

                    window.scrollTo(0,origscrolly);

                    panel = document.getElementById("savepage-lazyload-panel-container");

                    if (panel != null) document.documentElement.removeChild(panel);

                    if (cancelSave) chrome.runtime.sendMessage({ type: "saveExit" });
                    else
                    {
                        if (loadLazyImages) forceLazyImages();

                        initializeBeforeSave();
                    }
                });
            }
        });
    }
    // Scrapyard //////////////////////////////////////////////////////////////////
    else if (lazyLoadType == 2)  /* shrink page; Scrpayard uses value 2 */
    ////////////////////////////////////////////////////////////////// Scrapyard //
    {
        chrome.runtime.sendMessage({ type: "setSaveState", savestate: 0 });

        showLazyLoad();

        starttime = performance.now();

        htmlCssText = document.documentElement.style.cssText;
        bodyCssText = document.body.style.cssText;
        origScrollY = window.scrollY;

        scalex = 400/document.body.scrollWidth;
        scaley = 0.025;

        originx = window.innerWidth/2;
        originy = 10;

        window.scrollTo(0,document.body.scrollHeight);  /* trigger lazy load scripts in page */
        window.scrollTo(0,0);

        document.documentElement.style.setProperty("background","#FFFFFF","important");

        document.body.style.setProperty("transform","scaleX(" + scalex + ") scaleY(" + scaley + ")","important");
        document.body.style.setProperty("visibility","hidden","important");

        // Scrapyard //////////////////////////////////////////////////////////////////
        new Promise(resolve => setTimeout(() => resolve(), 500+lazyLoadShrinkTime*1000)).then(   /* allow time for page to settle after scroll - e.g. page with floating top bar that resizes when page scrolls */
        ////////////////////////////////////////////////////////////////// Scrapyard //
        function(object)
        {
            document.body.style.removeProperty("visibility");
            document.body.style.setProperty("transform-origin",originx + "px " + originy + "px","important");

            lastscrollheight = document.body.scrollHeight;

            window.scrollTo(0,document.body.scrollHeight);  /* trigger lazy load scripts in page */
            window.scrollTo(0,0);

            if (debugEnable) console.log("INITIAL  -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scale: " + scaley);

            // Scrapyard //////////////////////////////////////////////////////////////////
            new Promise(resolve => setTimeout(() => resolve(), 500+lazyLoadShrinkTime*1000)).then(   /* allow time for first lazy loads to complete */
            ////////////////////////////////////////////////////////////////// Scrapyard //
            function timer(object)
            {
                if (document.body.scrollHeight > lastscrollheight && document.body.scrollHeight*scaley < window.innerHeight && !skipLazyLoad && !cancelSave)
                {
                    if (debugEnable) console.log("GROWING  -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scale: " + scaley);

                    lastscrollheight = document.body.scrollHeight;

                    window.scrollTo(0,document.body.scrollHeight);
                    window.scrollTo(0,0);

                    // Scrapyard //////////////////////////////////////////////////////////////////
                    new Promise(resolve => setTimeout(() => resolve(), lazyLoadShrinkTime*1000)).then(   /* allow time for some more lazy loads to complete */
                    ////////////////////////////////////////////////////////////////// Scrapyard //
                    function(object)
                    {
                        timer();
                    });
                }
                else
                {
                    if (debugEnable) console.log("WAITING  -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scale: " + scaley);

                    window.scrollTo(0,document.body.scrollHeight);
                    window.scrollTo(0,0);

                    // Scrapyard //////////////////////////////////////////////////////////////////
                    new Promise(resolve => setTimeout(() => resolve(), 500+lazyLoadShrinkTime*1000)).then(   /* allow time for final lazy loads to complete */
                    ////////////////////////////////////////////////////////////////// Scrapyard //
                    function(object)
                    {
                        if (debugEnable) console.log("FINISHED -  Inner Height: " + window.innerHeight + "  Scroll Height: " + document.body.scrollHeight + "  Scale: " + scaley);

                        endtime = performance.now();

                        if (debugEnable) console.log("LAZY LOAD TIME: " + (endtime-starttime)/1000 + "secs");

                        panel = document.getElementById("savepage-lazyload-panel-container");

                        if (panel != null) document.documentElement.removeChild(panel);

                        if (skipLazyLoad || cancelSave) undoShrinkPage();

                        if (cancelSave) chrome.runtime.sendMessage({ type: "saveExit" });
                        else
                        {
                            if (loadLazyImages) forceLazyImages();

                            initializeBeforeSave();
                        }
                    });
                }
            });
        });
    }
}

function forceLazyImages()
{
    document.querySelectorAll("img").forEach(
    function (element)
    {
        /* Force loading of images with loading="lazy" attributes */

        if (element.getAttribute("loading") == "lazy")
        {
            element.removeAttribute("loading");
            element.setAttribute("data-savepage-loading","lazy");
        }

        /* Force loading of images managed by lazy load JS libraries */
        /* Changes are the same as if the page was scrolled by the user */

        if (element.getAttribute("data-src")) element.setAttribute("src",element.getAttribute("data-src"));
        else if (element.getAttribute("data-original")) element.setAttribute("src",element.getAttribute("data-original"));
        else if (element.getAttribute("data-normal")) element.setAttribute("src",element.getAttribute("data-normal"));

        if (element.getAttribute("data-srcset")) element.setAttribute("srcset",element.getAttribute("data-srcset"));
        else if (element.getAttribute("data-original-set")) element.setAttribute("srcset",element.getAttribute("data-original-set"));
    });
}

function showLazyLoad()
{
    var xhr,parser,lazyloaddoc,container;

    xhr = new XMLHttpRequest();
    xhr.open("GET",chrome.runtime.getURL("lazyload-panel.html"),true);
    xhr.onload = complete;
    xhr.send();

    function complete()
    {
        if (xhr.status == 200)
        {
            /* Parse lazy load document */

            parser = new DOMParser();
            lazyloaddoc = parser.parseFromString(xhr.responseText,"text/html");

            /* Create container element */

            container = document.createElement("div");
            container.setAttribute("id","savepage-lazyload-panel-container");
            document.documentElement.appendChild(container);

            /* Append lazy load elements */

            container.appendChild(lazyloaddoc.getElementById("savepage-lazyload-panel-overlay"));

            /* Add listeners for buttons */

            document.getElementById("savepage-lazyload-panel-skip").addEventListener("click",clickSkip,false);
            document.getElementById("savepage-lazyload-panel-cancel").addEventListener("click",clickCancel,false);

            /* Focus continue button */

            document.getElementById("savepage-lazyload-panel-skip").focus();

            /* Select this tab */

            chrome.runtime.sendMessage({ type: "selectTab" });
        }
    }

    function clickSkip()
    {
        skipLazyLoad = true;
    }

    function clickCancel()
    {
        cancelSave = true;
    }
}

/************************************************************************/

/* Initialize before save */

function initializeBeforeSave()
{
    /* Initialize resources */

    frameKey.length = 0;
    frameURL.length = 0;
    frameHTML.length = 0;
    frameFonts.length = 0;
    // Scrapyard //////////////////////////////////////////////////////////////////
    frameLinks.length = 0;
    ////////////////////////////////////////////////////////////////// Scrapyard //

    resourceLocation.length = 0;
    resourceReferrer.length = 0;
    resourceMimeType.length = 0;
    resourceCharSet.length = 0;
    resourcePassive.length = 0;
    resourceContent.length = 0;
    resourceStatus.length = 0;
    resourceReason.length = 0;
    resourceRemembered.length = 0;
    resourceReplaced.length = 0;
    resourceCSSRemembered.length = 0;
    resourceCSSFrameKeys.length = 0;

    firstIconLocation = "";
    rootIconLocation = "";

    pageInfoBarText = "";
    shadowLoaderText = "";
    enteredComments = "";

    htmlStrings.length = 0;

    htmlStrings[0] = "\uFEFF";  /* UTF-8 Byte Order Mark (BOM) - 0xEF 0xBB 0xBF */

    /* Identify all frames */

    // Scrapyard //////////////////////////////////////////////////////////////////
    chrome.runtime.sendMessage({ type: "requestFrames", siteCapture });
    ////////////////////////////////////////////////////////////////// Scrapyard //

    // Scrapyard //////////////////////////////////////////////////////////////////
    new Promise(resolve => setTimeout(() => resolve(), 200)).then( /* allow time for all frames to reply */
    ////////////////////////////////////////////////////////////////// Scrapyard //
    function(object)
    {
        var i;

        // for (i = 0; i < frameKey.length; i++)
        // {
            // console.log("Frame - " + (" " + i).substr(-2) + " - " + (frameKey[i] + "              ").substr(0,14) + " - " +
                        // (frameURL[i] + "                                                            ").replace(/\:/g,"").substr(0,80));
        // }

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (loadShadowDom && !shadowLoaderText)
            fetch(browser.runtime.getURL("savepage/shadowloader.js"))
                .then(response => response.text())
                .then(text => shadowLoaderText = text)
                .then(gatherStyleSheets)
        else
            gatherStyleSheets();
        ////////////////////////////////////////////////////////////////// Scrapyard //
    });
}

/************************************************************************/

/* First Pass - to find external style sheets and load into arrays */

function gatherStyleSheets()
{
    passNumber = 1;

    chrome.runtime.sendMessage({ type: "setSaveState", savestate: 1 });

    timeStart[1] = performance.now();

    findStyleSheets(0,window,document.documentElement);

    timeFinish[1] = performance.now();

    loadResources();
}

function findStyleSheets(depth,frame,element)
{
    var i,baseuri,charset,csstext,regex,parser,framedoc,shadowroot;
    var matches = new Array();

    /* External style sheet imported in <style> element */

    if (element.localName == "style")
    {
        if (!element.disabled)
        {
            csstext = element.textContent;

            baseuri = element.ownerDocument.baseURI;

            charset = element.ownerDocument.characterSet;

            regex = /@import\s*(?:url\(\s*)?((?:"[^"]+")|(?:'[^']+')|(?:[^\s);]+))(?:\s*\))?\s*;/gi;  /* @import url() */

            while ((matches = regex.exec(csstext)) != null)
            {
                matches[1] = removeQuotes(matches[1]);

                if (replaceableResourceURL(matches[1]))
                {
                    rememberURL(matches[1],baseuri,"text/css",charset,false);
                }
            }
        }
    }

    /* External style sheet referenced in <link> element */

    else if (element.localName == "link" && !(element.parentElement instanceof SVGElement))  /* <link> is invalid inside <svg> */
    {
        if (element.rel.toLowerCase().indexOf("stylesheet") >= 0 && element.getAttribute("href"))
        {
            if (!element.disabled)
            {
                if (replaceableResourceURL(element.href))
                {
                    baseuri = element.ownerDocument.baseURI;

                    if (element.charset != "") charset = element.charset;
                    else charset = element.ownerDocument.characterSet;

                    rememberURL(element.href,baseuri,"text/css",charset,false);
                }
            }
        }
    }

    /* Handle nested frames and child elements */

    if (element.localName == "iframe" || element.localName == "frame")  /* frame elements */
    {
        if (depth < maxFrameDepth)
        {
            try
            {
                if (element.contentDocument.documentElement != null)  /* in case web page not fully loaded before finding */
                {
                    findStyleSheets(depth+1,element.contentWindow,element.contentDocument.documentElement);
                }
            }
            catch (e)  /* attempting cross-domain web page access */
            {
                if (retainCrossFrames)
                {
                    for (i = 0; i < frameKey.length; i++)
                    {
                        if (frameKey[i] == element.getAttribute("data-savepage-key")) break;
                    }

                    if (i != frameKey.length)
                    {
                        parser = new DOMParser();
                        framedoc = parser.parseFromString(frameHTML[i],"text/html");

                        findStyleSheets(depth+1,null,framedoc.documentElement);
                    }
                }
            }
        }
    }
    else
    {
        /* Handle shadow child elements */

        if (isFirefox) shadowroot = element.shadowRoot || element.openOrClosedShadowRoot;
        else shadowroot = element.shadowRoot || ((chrome.dom && element instanceof HTMLElement) ? chrome.dom.openOrClosedShadowRoot(element) : null);

        if (shadowroot != null)
        {
            if (shadowElements.indexOf(element.localName) < 0)  /* ignore elements with built-in Shadow DOM */
            {
                for (i = 0; i < shadowroot.children.length; i++)
                    if (shadowroot.children[i] != null)  /* in case web page not fully loaded before finding */
                        findStyleSheets(depth,frame,shadowroot.children[i]);
            }
        }

        /* Handle normal child elements */

        for (i = 0; i < element.children.length; i++)
            if (element.children[i] != null)  /* in case web page not fully loaded before finding */
                findStyleSheets(depth,frame,element.children[i]);
    }
}

/************************************************************************/

/* Second Pass - to find other external resources and load into arrays */

async function gatherOtherResources()
{
    var loadedfonts = new Array();

    passNumber = 2;

    chrome.runtime.sendMessage({ type: "setSaveState", savestate: 2 });

    timeStart[2] = performance.now();

    document.fonts.forEach(  /* CSS Font Loading Module */
    function(font)
    {
        if (font.status == "loaded")  /* font is being used in this document */
        {
            loadedfonts.push({ family: font.family, weight: font.weight, style: font.style, stretch: font.stretch });
        }
    });

    findOtherResources(0,window,document.documentElement,false,false,loadedfonts,"0");

    // Scrapyard //////////////////////////////////////////////////////////////////
    skipIfSelected = false;
    ////////////////////////////////////////////////////////////////// Scrapyard //

    timeFinish[2] = performance.now();

    await loadResources();
}

function findOtherResources(depth,frame,element,crossframe,nosrcframe,loadedfonts,framekey)
{
    // Scrapyard //////////////////////////////////////////////////////////////////
    if (scrapyardExcludeElement(element))
        return;
    ////////////////////////////////////////////////////////////////// Scrapyard //

    var i,j,displayed,style,csstext,baseuri,charset,dupelement,dupsheet,location,currentsrc,passive,documenturi,origurl,newurl,subframekey,parser,framedoc,shadowroot;
    var subloadedfonts = new Array();

    /* Determine if element is displayed */

    if (crossframe)
    {
        /* In a cross-origin frame, the document created by DOMParser */
        /* does not have an associated frame window, which means that */
        /* the window.getComputedStyle() function cannot be called.   */

        /* Assume all elements are displayed and force saving of all CSS images */

        displayed = true;
    }
    else if ((style = frame.getComputedStyle(element)) == null) displayed = true;  /* should not happen */
    else
    {
        // Scrapyard //////////////////////////////////////////////////////////////////
        displayed = (style.getPropertyValue("display") != "none") && element.id !== "scrapyard-waiting";
        ////////////////////////////////////////////////////////////////// Scrapyard //

        /* External images referenced in any element's computed style */

        if ((savedItems == 0 || savedItems == 1 || (savedItems == 2 && !saveCSSImagesAll)) && displayed)
        {
            csstext = "";

            csstext += style.getPropertyValue("background-image") + " ";
            csstext += style.getPropertyValue("border-image-source") + " ";
            csstext += style.getPropertyValue("list-style-image") + " ";
            csstext += style.getPropertyValue("cursor") + " ";
            csstext += style.getPropertyValue("filter") + " ";
            csstext += style.getPropertyValue("clip-path") + " ";
            csstext += style.getPropertyValue("mask-image") + " ";
            csstext += style.getPropertyValue("-webkit-mask-image") + " ";

            style = frame.getComputedStyle(element,"::before");
            csstext += style.getPropertyValue("background-image") + " ";
            csstext += style.getPropertyValue("border-image-source") + " ";
            csstext += style.getPropertyValue("list-style-image") + " ";
            csstext += style.getPropertyValue("cursor") + " ";
            csstext += style.getPropertyValue("content") + " ";
            csstext += style.getPropertyValue("filter") + " ";
            csstext += style.getPropertyValue("clip-path") + " ";
            csstext += style.getPropertyValue("mask-image") + " ";
            csstext += style.getPropertyValue("-webkit-mask-image") + " ";

            style = frame.getComputedStyle(element,"::after");
            csstext += style.getPropertyValue("background-image") + " ";
            csstext += style.getPropertyValue("border-image-source") + " ";
            csstext += style.getPropertyValue("list-style-image") + " ";
            csstext += style.getPropertyValue("cursor") + " ";
            csstext += style.getPropertyValue("content") + " ";
            csstext += style.getPropertyValue("filter") + " ";
            csstext += style.getPropertyValue("clip-path") + " ";
            csstext += style.getPropertyValue("mask-image") + " ";
            csstext += style.getPropertyValue("-webkit-mask-image") + " ";

            style = frame.getComputedStyle(element,"::first-letter");
            csstext += style.getPropertyValue("background-image") + " ";
            csstext += style.getPropertyValue("border-image-source") + " ";

            style = frame.getComputedStyle(element,"::first-line");
            csstext += style.getPropertyValue("background-image") + " ";

            baseuri = element.ownerDocument.baseURI;

            rememberCSSImageURLs(csstext,baseuri,framekey);
        }
    }

    /* External images referenced in any element's style attribute */

    if (element.hasAttribute("style"))
    {
        if ((savedItems == 2 && saveCSSImagesAll) || crossframe)
        {
            csstext = element.getAttribute("style");

            baseuri = element.ownerDocument.baseURI;

            rememberCSSImageURLs(csstext,baseuri,framekey);
        }
    }

    /* External script referenced in <script> element */

    if (element.localName == "script")
    {
        if ((savedItems == 2 && saveScripts) && !crossframe && !nosrcframe)
        {
            if (element.getAttribute("src"))
            {
                if (replaceableResourceURL(element.src))
                {
                    baseuri = element.ownerDocument.baseURI;

                    if (element.charset != "") charset = element.charset;
                    else charset = element.ownerDocument.characterSet;

                    rememberURL(element.src,baseuri,"text/javascript",charset,false);
                }
            }
        }
    }

    /* External images or fonts referenced in <style> element */

    else if (element.localName == "style")
    {
        if (!element.disabled)
        {
            if (element.hasAttribute("data-savepage-sheetrules")) csstext = element.getAttribute("data-savepage-sheetrules");
            else
            {
                try
                {
                    /* Count rules in element.textContent by creating duplicate element */

                    dupelement = element.ownerDocument.createElement("style");
                    dupelement.textContent = element.textContent;
                    element.ownerDocument.body.appendChild(dupelement);
                    dupsheet = dupelement.sheet;
                    dupelement.remove();

                    /* There may be rules in element.sheet.cssRules that are not in element.textContent */
                    /* For example if the page uses CSS-in-JS Libraries */

                    if (dupsheet.cssRules.length != element.sheet.cssRules.length)
                    {
                        csstext = "";

                        for (i = 0; i < element.sheet.cssRules.length; i++)
                            csstext += element.sheet.cssRules[i].cssText + "\n";
                    }
                    else csstext = element.textContent;
                }
                catch (e)  /* sheet.cssRules does not exist or cross-origin style sheet */
                {
                    csstext = element.textContent;
                }
            }

            baseuri = element.ownerDocument.baseURI;

            rememberCSSURLsInStyleSheet(csstext,baseuri,crossframe,loadedfonts,[],framekey);
        }
    }

    /* External images or fonts referenced in <link> element */
    /* External icon referenced in <link> element */

    else if (element.localName == "link" && !(element.parentElement instanceof SVGElement))  /* <link> is invalid inside <svg> */
    {
        if (element.rel.toLowerCase().indexOf("stylesheet") >= 0 && element.getAttribute("href"))
        {
            if (!element.disabled)
            {
                if (replaceableResourceURL(element.href))
                {
                    baseuri = element.ownerDocument.baseURI;

                    if (baseuri != null)
                    {
                        location = resolveURL(element.href,baseuri);

                        if (location != null)
                        {
                            location = removeFragment(location);

                            for (i = 0; i < resourceLocation.length; i++)
                                if (resourceLocation[i] == location && resourceStatus[i] == "success") break;

                            if (i < resourceLocation.length)  /* style sheet found */
                            {
                                csstext = resourceContent[i];

                                baseuri = element.href;

                                rememberCSSURLsInStyleSheet(csstext,baseuri,crossframe,loadedfonts,[location],framekey);
                            }
                        }
                    }
                }
            }
        }
        else if ((element.rel.toLowerCase() == "icon" || element.rel.toLowerCase() == "shortcut icon") && element.getAttribute("href"))
        {
            if (replaceableResourceURL(element.href))
            {
                baseuri = element.ownerDocument.baseURI;

                rememberURL(element.href,baseuri,"image/vnd.microsoft.icon","",false);

                if (firstIconLocation == "")
                {
                    location = resolveURL(element.href,baseuri);

                    if (location != null) firstIconLocation = location;
                }
            }
        }
    }

    /* External location referenced in <a> or <area> element */

    else if ((element.localName == "a" && element instanceof HTMLElement) || element.localName == "area")
    {
    }

    /* External image referenced in <body> element */

    else if (element.localName == "body")
    {
        if (element.getAttribute("background"))
        {
            if (savedItems == 1 || (savedItems == 2 && saveHTMLImagesAll) ||
                (savedItems == 0 || (savedItems == 2 && !saveHTMLImagesAll)) && displayed)
            {
                if (replaceableResourceURL(element.background))
                {
                    baseuri = element.ownerDocument.baseURI;

                    rememberURL(element.background,baseuri,"image/png","",false);
                }
            }
        }
    }

    /* External image referenced in <img> element - can be inside <picture> element */

    else if (element.localName == "img")
    {
        /* currentSrc is set from src or srcset attributes on this <img> element */
        /* or from srcset attribute on <source> element inside <picture> element */

        /* Firefox - workaround because element.currentSrc may be empty string in cross-origin frames */

        currentsrc = (element.currentSrc != "") ? element.currentSrc : (element.getAttribute("src") ? element.src : "");

        /* Chrome - workaround because element.currentSrc may have wrong fragment identifier for SVG images */

        currentsrc = (element.currentSrc.indexOf("#") < 0) ? element.currentSrc : (element.getAttribute("src") ? element.src : "");

        if (currentsrc != "")
        {
            if (savedItems == 1 || (savedItems == 2 && saveHTMLImagesAll) ||
                (savedItems == 0 || (savedItems == 2 && !saveHTMLImagesAll)) && displayed)
            {
                if (replaceableResourceURL(currentsrc))
                {
                    baseuri = element.ownerDocument.baseURI;

                    passive = !((element.parentElement && element.parentElement.localName == "picture") || element.hasAttribute("srcset") || element.hasAttribute("crossorigin"));

                    rememberURL(currentsrc,baseuri,"image/png","",passive);
                }
            }
        }
    }

    /* External image referenced in <input> element */

    else if (element.localName == "input")
    {
        if (element.type.toLowerCase() == "image" && element.getAttribute("src"))
        {
            if (savedItems == 1 || (savedItems == 2 && saveHTMLImagesAll) ||
                (savedItems == 0 || (savedItems == 2 && !saveHTMLImagesAll)) && displayed)
            {
                if (replaceableResourceURL(element.src))
                {
                    baseuri = element.ownerDocument.baseURI;

                    rememberURL(element.src,baseuri,"image/png","",false);
                }
            }
        }
    }

    /* External audio referenced in <audio> element */

    else if (element.localName == "audio")
    {
        if (element.getAttribute("src"))
        {
            if (element.src == element.currentSrc)
            {
                if (savedItems == 1 || (savedItems == 2 && saveHTMLAudioVideo))
                {
                    if (replaceableResourceURL(element.src))
                    {
                        baseuri = element.ownerDocument.baseURI;

                        passive = !element.hasAttribute("crossorigin");

                        rememberURL(element.src,baseuri,"audio/mpeg","",passive);
                    }
                }
            }
        }
    }

    /* External video and image referenced in <video> element */

    else if (element.localName == "video")
    {
        if (element.getAttribute("src"))
        {
            if (element.src == element.currentSrc)
            {
                if (savedItems == 1 || (savedItems == 2 && saveHTMLAudioVideo))
                {
                    if (replaceableResourceURL(element.src))
                    {
                        baseuri = element.ownerDocument.baseURI;

                        passive = !element.hasAttribute("crossorigin");

                        rememberURL(element.src,baseuri,"video/mp4","",passive);
                    }
                }
            }
        }

        if (element.getAttribute("poster"))
        {
            if (savedItems == 1 || (savedItems == 2 && saveHTMLAudioVideo))
            {
                if (savedItems == 1 || (savedItems == 2 && saveHTMLImagesAll) ||
                    (savedItems == 0 || (savedItems == 2 && !saveHTMLImagesAll)) && displayed)
                {
                    if (replaceableResourceURL(element.poster))
                    {
                        baseuri = element.ownerDocument.baseURI;

                        rememberURL(element.poster,baseuri,"image/png","",false);
                    }
                }
            }
        }
    }

    /* External audio/video/image referenced in <source> element */

    else if (element.localName == "source")
    {
        if (element.parentElement)
        {
            if (element.parentElement.localName == "audio" || element.parentElement.localName == "video")
            {
                if (element.getAttribute("src"))
                {
                    if (element.src == element.parentElement.currentSrc)
                    {
                        if (savedItems == 1 || (savedItems == 2 && saveHTMLAudioVideo))
                        {
                            if (replaceableResourceURL(element.src))
                            {
                                baseuri = element.ownerDocument.baseURI;

                                passive = !element.parentElement.hasAttribute("crossorigin");

                                if (element.parentElement.localName == "audio") rememberURL(element.src,baseuri,"audio/mpeg","",passive);
                                else if (element.parentElement.localName == "video") rememberURL(element.src,baseuri,"video/mp4","",passive);
                            }
                        }
                    }
                }
            }
        }
    }

    /* External subtitles referenced in <track> element */

    else if (element.localName == "track")
    {
        if (element.getAttribute("src"))
        {
            if (savedItems == 1 || (savedItems == 2 && saveHTMLAudioVideo))
            {
                if (replaceableResourceURL(element.src))
                {
                    baseuri = element.ownerDocument.baseURI;

                    charset = element.ownerDocument.characterSet;

                    rememberURL(element.src,baseuri,"text/vtt",charset,false);
                }
            }
        }
    }

    /* External data referenced in <object> element */

    else if (element.localName == "object")
    {
        if (element.getAttribute("data"))
        {
            if (savedItems == 1 || (savedItems == 2 && saveHTMLObjectEmbed))
            {
                if (replaceableResourceURL(element.data))
                {
                    baseuri = element.ownerDocument.baseURI;

                    rememberURL(element.data,baseuri,"application/octet-stream","",false);
                }
            }
        }
    }

    /* External data referenced in <embed> element */

    else if (element.localName == "embed")
    {
        if (element.getAttribute("src"))
        {
            if (savedItems == 1 || (savedItems == 2 && saveHTMLObjectEmbed))
            {
                if (replaceableResourceURL(element.src))
                {
                    baseuri = element.ownerDocument.baseURI;

                    rememberURL(element.src,baseuri,"application/octet-stream","",false);
                }
            }
        }
    }

    /* SVG - External location referenced in <a> element */

    else if (element.localName == "a" && element instanceof SVGElement)
    {
    }

    /* SVG - External resource referenced in other SVG elements */

    else if (hrefSVGElements.indexOf(element.localName) >= 0 && element instanceof SVGElement)
    {
        if (element.getAttribute("href") || element.getAttribute("xlink:href"))
        {
            baseuri = element.ownerDocument.baseURI;

            documenturi = element.ownerDocument.documentURI;

            origurl = element.getAttribute("href") || element.getAttribute("xlink:href");

            newurl = adjustURL(origurl,baseuri,documenturi);

            if (newurl.substr(0,1) != "#")  /* not fragment only */
            {
                if (replaceableResourceURL(element.href.baseVal))
                {
                    charset = element.ownerDocument.characterSet;

                    rememberURL(element.href.baseVal,baseuri,"image/svg+xml",charset,false);
                }
            }
        }
    }

    /* Handle nested frames and child elements */

    if (element.localName == "iframe" || element.localName == "frame")  /* frame elements */
    {
        if (depth < maxFrameDepth)
        {
            if (element.localName == "iframe") nosrcframe = nosrcframe || (!element.getAttribute("src") && !element.getAttribute("srcdoc"));
            else nosrcframe = nosrcframe || !element.getAttribute("src");

            subframekey = element.getAttribute("data-savepage-key");

            try
            {
                if (element.contentDocument.documentElement != null)  /* in case web page not fully loaded before finding */
                {
                    element.contentDocument.fonts.forEach(  /* CSS Font Loading Module */
                    function(font)
                    {
                        if (font.status == "loaded")  /* font is being used in this document */
                        {
                            subloadedfonts.push({ family: font.family, weight: font.weight, style: font.style, stretch: font.stretch });
                        }
                    });

                    findOtherResources(depth+1,element.contentWindow,element.contentDocument.documentElement,crossframe,nosrcframe,subloadedfonts,subframekey);
                }
            }
            catch (e)  /* attempting cross-domain web page access */
            {
                if (retainCrossFrames)
                {
                    for (i = 0; i < frameKey.length; i++)
                    {
                        if (frameKey[i] == subframekey) break;
                    }

                    if (i != frameKey.length)
                    {
                        parser = new DOMParser();
                        framedoc = parser.parseFromString(frameHTML[i],"text/html");

                        findOtherResources(depth+1,null,framedoc.documentElement,true,nosrcframe,frameFonts[i],subframekey);
                    }
                }
            }
        }
    }
    else
    {
        /* Handle shadow child elements */

        if (isFirefox) shadowroot = element.shadowRoot || element.openOrClosedShadowRoot;
        else shadowroot = element.shadowRoot || ((chrome.dom && element instanceof HTMLElement) ? chrome.dom.openOrClosedShadowRoot(element) : null);

        if (shadowroot != null)
        {
            if (shadowElements.indexOf(element.localName) < 0)  /* ignore elements with built-in Shadow DOM */
            {
                for (i = 0; i < shadowroot.children.length; i++)
                    if (shadowroot.children[i] != null)  /* in case web page not fully loaded before finding */
                        findOtherResources(depth,frame,shadowroot.children[i],crossframe,nosrcframe,loadedfonts,framekey);
            }
        }

        /* Handle normal child elements */

        for (i = 0; i < element.children.length; i++)
            if (element.children[i] != null)  /* in case web page not fully loaded before finding */
                findOtherResources(depth,frame,element.children[i],crossframe,nosrcframe,loadedfonts,framekey);

        /* Remember location of favicon in website root */

        if (element.localName == "head" && depth == 0)
        {
            if (firstIconLocation == "")
            {
                baseuri = element.ownerDocument.baseURI;

                rememberURL("/favicon.ico",baseuri,"image/vnd.microsoft.icon","",false);

                location = resolveURL("/favicon.ico",baseuri);

                if (location != null) rootIconLocation = location;
            }
        }
    }
}

function rememberCSSURLsInStyleSheet(csstext,baseuri,crossframe,loadedfonts,importstack,framekey)
{
    var i,regex,location,fontfamily,fontweight,fontstyle,fontstretch,fontmatches;
    var includeall,includewoff,usedfilefound,wofffilefound,srcregex,urlregex,fontfiletype;
    var matches = new Array();
    var propmatches = new Array();
    var srcmatches = new Array();
    var urlmatches = new Array();
    var fontweightvalues = new Array("normal","bold","bolder","lighter","100","200","300","400","500","600","700","800","900");
    var fontstretchvalues = new Array("normal","ultra-condensed","extra-condensed","condensed","semi-condensed","semi-expanded","expanded","extra-expanded","ultra-expanded");
    var fontstylevalues = new Array("normal","italic","oblique");

    /* @import url() or */
    /* @font-face rule with font url()'s or */
    /* image url() or */
    /* avoid matches inside double-quote strings or */
    /* avoid matches inside single-quote strings or */
    /* avoid matches inside comments */

    regex = new RegExp(/(?:@import\s*(?:url\(\s*)?((?:"[^"]+")|(?:'[^']+')|(?:[^\s);]+))(?:\s*\))?\s*;)|/.source +  /* matches[1] */
                       /(?:@font-face\s*({[^}]*}))|/.source +  /* matches[2] */
                       /(?:url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\))|/.source +  /* matches[3] */
                       /(?:"(?:\\"|[^"])*")|/.source +
                       /(?:'(?:\\'|[^'])*')|/.source +
                       /(?:\/\*(?:\*[^\/]|[^\*])*?\*\/)/.source,
                       "gi");

    while ((matches = regex.exec(csstext)) != null)  /* style sheet imported into style sheet */
    {
        if (matches[0].substr(0,7).toLowerCase() == "@import")  /* @import url() */
        {
            matches[1] = removeQuotes(matches[1]);

            if (replaceableResourceURL(matches[1]))
            {
                if (baseuri != null)
                {
                    location = resolveURL(matches[1],baseuri);

                    if (location != null)
                    {
                        location = removeFragment(location);

                        for (i = 0; i < resourceLocation.length; i++)
                            if (resourceLocation[i] == location && resourceStatus[i] == "success") break;

                        if (i < resourceLocation.length)  /* style sheet found */
                        {
                            if (importstack.indexOf(location) < 0)
                            {
                                importstack.push(location);

                                rememberCSSURLsInStyleSheet(resourceContent[i],resourceLocation[i],crossframe,loadedfonts,importstack,framekey);

                                importstack.pop();
                            }
                        }
                    }
                }
            }
        }
        else if (matches[0].substr(0,10).toLowerCase() == "@font-face")  /* @font-face rule */
        {
            includeall = (savedItems == 2 && saveCSSFontsAll);
            includewoff = (savedItems == 1 || (savedItems == 2 && saveCSSFontsWoff));

            propmatches = matches[2].match(/font-family\s*:\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s;}]+(?: [^\s;}]+)*))/i);
            if (propmatches == null) fontfamily = ""; else fontfamily = removeQuotes(unescapeCSSValue(propmatches[1])).toLowerCase();

            propmatches = matches[2].match(/font-weight\s*:\s*([^\s;}]*)/i);
            if (propmatches == null) fontweight = "normal";
            else if (fontweightvalues.indexOf(propmatches[1].toLowerCase()) < 0) fontweight = "normal";
            else fontweight = propmatches[1].toLowerCase();

            propmatches = matches[2].match(/font-style\s*:\s*([^\s;}]*)/i);
            if (propmatches == null) fontstyle = "normal";
            else if (fontstylevalues.indexOf(propmatches[1].toLowerCase()) < 0) fontstyle = "normal";
            else fontstyle = propmatches[1].toLowerCase();

            propmatches = matches[2].match(/font-stretch\s*:\s*([^\s;}]*)/i);
            if (propmatches == null) fontstretch = "normal";
            else if (fontstretchvalues.indexOf(propmatches[1].toLowerCase()) < 0) fontstretch = "normal";
            else fontstretch = propmatches[1].toLowerCase();

            fontmatches = false;

            for (i = 0; i < loadedfonts.length; i++)
            {
                if (removeQuotes(loadedfonts[i].family).toLowerCase() == fontfamily && loadedfonts[i].weight == fontweight &&
                    loadedfonts[i].style == fontstyle && loadedfonts[i].stretch == fontstretch) fontmatches = true;  /* font matches this @font-face rule */
            }

            if (fontmatches)
            {
                usedfilefound = false;
                wofffilefound = false;

                srcregex = /src:([^;}]*)[;}]/gi;  /* @font-face src list */

                while ((srcmatches = srcregex.exec(matches[2])) != null)  /* src: list of font file URLs */
                {
                    urlregex = /url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)(?:\s+format\(([^)]*)\))?/gi;  /* font url() and optional font format() list */

                    while ((urlmatches = urlregex.exec(srcmatches[1])) != null)  /* font file URL */
                    {
                        urlmatches[1] = removeQuotes(urlmatches[1]);  /* url */

                        if (replaceableResourceURL(urlmatches[1]))
                        {
                            fontfiletype = "";

                            if (typeof urlmatches[2] != "undefined")  /* font format() list */
                            {
                                urlmatches[2] = urlmatches[2].replace(/"/g,"'");

                                if (urlmatches[2].indexOf("'woff2'") >= 0) fontfiletype = "woff2";  /* Firefox, Chrome & Opera */
                                else if (urlmatches[2].indexOf("'woff'") >= 0) fontfiletype = "woff";  /* all browsers */
                                else if (urlmatches[2].indexOf("'truetype'") >= 0) fontfiletype = "ttf";  /* all browsers */
                                else if (urlmatches[2].indexOf("'opentype'") >= 0) fontfiletype = "otf";  /* all browsers */
                            }
                            else
                            {
                                if (urlmatches[1].indexOf(".woff2") >= 0) fontfiletype = "woff2";  /* Firefox, Chrome & Opera */
                                else if (urlmatches[1].indexOf(".woff") >= 0 && urlmatches[1].indexOf(".woff2") < 0) fontfiletype = "woff";  /* all browsers */
                                else if (urlmatches[1].indexOf(".ttf") >= 0) fontfiletype = "ttf";  /* all browsers */
                                else if (urlmatches[1].indexOf(".otf") >= 0) fontfiletype = "otf";  /* all browsers */
                            }

                            if (fontfiletype != "")
                            {
                                if (!usedfilefound)
                                {
                                    usedfilefound = true;  /* first font file supported by this browser - should be the one used by this browser */

                                    if (fontfiletype == "woff") wofffilefound = true;

                                    rememberURL(urlmatches[1],baseuri,"application/font-woff","",false);
                                }
                                else if (includewoff && fontfiletype == "woff")
                                {
                                    wofffilefound = true;  /* woff font file supported by all browsers */

                                    rememberURL(urlmatches[1],baseuri,"application/font-woff","",false);
                                }
                                else if (includeall)
                                {
                                    rememberURL(urlmatches[1],baseuri,"application/font-woff","",false);
                                }
                            }

                            if (!includeall && (wofffilefound || (!includewoff && usedfilefound))) break;
                        }
                    }

                    if (!includeall && (wofffilefound || (!includewoff && usedfilefound))) break;
                }
            }
        }
        else if (matches[0].substr(0,4).toLowerCase() == "url(")  /* image url() */
        {
            if ((savedItems == 2 && saveCSSImagesAll) || crossframe)
            {
                matches[3] = removeQuotes(matches[3]);

                if (replaceableResourceURL(matches[3]))
                {
                    rememberCSSImageURL(matches[3],baseuri,"image/png","",false,framekey);
                }
            }
        }
        else if (matches[0].substr(0,1) == "\"") ;  /* double-quote string */
        else if (matches[0].substr(0,1) == "'") ;  /* single-quote string */
        else if (matches[0].substr(0,2) == "/*") ;  /* comment */
    }
}

function rememberCSSImageURLs(csstext,baseuri,framekey)
{
    var regex;
    var matches = new Array();

    regex = /url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;  /* image url() */

    while ((matches = regex.exec(csstext)) != null)
    {
        matches[1] = removeQuotes(matches[1]);

        if (replaceableResourceURL(matches[1]))
        {
            rememberCSSImageURL(matches[1],baseuri,"image/png","",false,framekey);
        }
    }
}

function rememberCSSImageURL(url,baseuri,mimetype,charset,passive,framekey)
{
    var i,location;

    if (pageType > 0) return -1;  /* saved page - ignore new resources when re-saving */

    if (baseuri != null)
    {
        location = resolveURL(url,baseuri);

        if (location != null)
        {
            baseuri = removeFragment(baseuri);

            location = removeFragment(location);

            if (location == "" || location == baseuri) return -1;

            for (i = 0; i < resourceLocation.length; i++)
                if (resourceLocation[i] == location) break;

            if (i == resourceLocation.length)  /* new resource */
            {
                resourceLocation[i] = location;
                resourceReferrer[i] = baseuri;
                resourceMimeType[i] = mimetype;  /* default if load fails */
                resourceCharSet[i] = charset;  /* default if load fails */
                resourcePassive[i] = passive;
                resourceContent[i] = "";  /* default if load fails */
                resourceStatus[i] = "pending";
                resourceReason[i] = "";
                resourceRemembered[i] = 1;
                resourceReplaced[i] = 0;
                resourceCSSRemembered[i] = 1;
                resourceCSSFrameKeys[i] = {};
                resourceCSSFrameKeys[i][framekey] = true;

                return i;
            }
            else  /* repeated resource */
            {
                resourceRemembered[i]++;
                resourceCSSRemembered[i]++;
                resourceCSSFrameKeys[i][framekey] = true;
            }
        }
    }

    return -1;
}

function rememberURL(url,baseuri,mimetype,charset,passive)
{
    var i,location;

    if (pageType > 0) return -1;  /* saved page - ignore new resources when re-saving */

    if (baseuri != null)
    {
        location = resolveURL(url,baseuri);

        if (location != null)
        {
            baseuri = removeFragment(baseuri);

            location = removeFragment(location);

            if (location == "" || location == baseuri) return -1;

            for (i = 0; i < resourceLocation.length; i++)
                if (resourceLocation[i] == location) break;

            if (i == resourceLocation.length)  /* new resource */
            {
                resourceLocation[i] = location;
                resourceReferrer[i] = baseuri;
                resourceMimeType[i] = mimetype;  /* default if load fails */
                resourceCharSet[i] = charset;  /* default if load fails */
                resourcePassive[i] = passive;
                resourceContent[i] = "";  /* default if load fails */
                resourceStatus[i] = "pending";
                resourceReason[i] = "";
                resourceRemembered[i] = 1;
                resourceReplaced[i] = 0;
                resourceCSSRemembered[i] = 0;
                resourceCSSFrameKeys[i] = {};

                return i;
            }
            else  /* repeated resource */
            {
                resourceRemembered[i]++;
            }
        }
    }

    return -1;
}

function unescapeCSSValue(value)
{
    var regex,codepoint;

    regex = /\\(?:([0-9A-Fa-f]{1,6})|(.))/g;

    return value.replace(regex,_replaceEscapeSequences);

    function _replaceEscapeSequences(match,p1,p2,offset,string)
    {
        if (p2) return p2;  /* single-character escape sequence */

        codepoint = parseInt(p1,16);

        if (codepoint == 0x0000 || codepoint > 0x10FFFF) return "\uFFFD";  /* not Unicode code point */
        if (codepoint >= 0xD800 && codepoint <= 0xDFFF) return "\uFFFD";  /* surrogate code point */

        return String.fromCodePoint(codepoint);  /* codepoint escape sequence */
    }
}

/************************************************************************/

/* After first or second pass - load resources */

async function loadResources()
{
    var i;

    timeStart[passNumber+3] = performance.now();

    resourceCount = 0;

    for (i = 0; i < resourceLocation.length; i++)
        if (resourceStatus[i] == "pending") resourceCount++;

    if (resourceCount <= 0)
    {
        timeFinish[passNumber+3] = performance.now();

        if (passNumber == 1) await gatherOtherResources();
        // Scrapyard //////////////////////////////////////////////////////////////////
        else if (passNumber == 2) await generateHTML();
        ////////////////////////////////////////////////////////////////// Scrapyard //
    }
    else
    {
        for (i = 0; i < resourceLocation.length; i++)
        {
            if (resourceStatus[i] == "pending")
            {
                if (safeContentOrAllowedMixedContent(i))
                {
                    loadResource(i,resourceLocation[i],resourceReferrer[i],getReferrerPolicy());
                }
                else loadFailure(i,"mixed");
            }
        }
    }
}

async function loadResource(index,location,referrer,referrerPolicy)
{
    var controller,timeout,response;
    var i,contentType,contentLength,mimetype,charset,buffer,byteArray,binaryString;
    var matches = [];

    resourceStatus[index] = "loading";

    controller = new AbortController();

    timeout = window.setTimeout(
        function()
        {
            controller.abort();
        },maxResourceTime*1000);

    try  /* load resource in content script */
    {
        response = await fetch(location,{ method: "GET", mode: "cors", cache: "no-cache", referrer: referrer, referrerPolicy: referrerPolicy, signal: controller.signal });

        if (debugEnable) console.log("Content Fetch - index: " + index + " - status: " + response.status + " - referrer: " + referrer + " - policy: " + referrerPolicy + " - location: " + location);

        window.clearTimeout(timeout);

        if (response.status == 200)
        {
            contentType = response.headers.get("Content-Type");
            if (contentType == null) contentType = "";

            contentLength = +response.headers.get("Content-Length");
            if (contentLength == null) contentLength = 0;

            if (contentLength > maxResourceSize*1024*1024)
            {
                loadFailure(index,"maxsize");
            }
            else
            {
                matches = contentType.match(/([^;]+)/i);
                if (matches != null) mimetype = matches[1].toLowerCase();
                else mimetype = "";

                // Scrapyard //////////////////////////////////////////////////////////////////
                matches = contentType.match(/;\s*charset=([^;]+)/i);
                ////////////////////////////////////////////////////////////////// Scrapyard //
                if (matches != null) charset = matches[1].toLowerCase();
                else charset = "";

                buffer = await response.arrayBuffer();

                byteArray = new Uint8Array(buffer);

                binaryString = "";
                for (i = 0; i < byteArray.byteLength; i++) binaryString += String.fromCharCode(byteArray[i]);

                loadSuccess(index,"",binaryString,mimetype,charset);
            }
        }
        else  /* load resource in background script */
        {
            if (resourceMimeType[index] == "application/font-woff")
            {
                /* Fonts must be loaded with CORS - but cannot be sure of CORS in background script */

                loadFailure(index,"corsfail");
            }
            else
            {
                /* Most likely resource for <link>/<script>/<img>/<audio>/<video> element with crossorigin attribute requiring background fetch */

                chrome.runtime.sendMessage({ type: "loadResource", index: index, location: location, referrer: referrer, referrerPolicy: referrerPolicy });
            }
        }
    }
    catch (e)
    {
        window.clearTimeout(timeout);

        if (e.name == "AbortError")
        {
            loadFailure(index,"maxtime");
        }
        else  /* load resource in background script */
        {
            if (resourceMimeType[index] == "application/font-woff")
            {
                /* Fonts must be loaded with CORS - but cannot be sure of CORS in background script */

                loadFailure(index,"corsfail");
            }
            else
            {
                /* Most likely resource for <link>/<script>/<img>/<audio>/<video> element with crossorigin attribute requiring background fetch */

                chrome.runtime.sendMessage({ type: "loadResource", index: index, location: location, referrer: referrer, referrerPolicy: referrerPolicy });
            }
        }
    }
}

// Scrapyard //////////////////////////////////////////////////////////////////
async function loadSuccess(index,reason,content,mimetype,charset)
////////////////////////////////////////////////////////////////// Scrapyard //
{
    var i,resourceURL,frameURL,csstext,baseuri,regex,documentURL;
    var matches = [];

    /* Process file based on expected MIME type */

    switch (resourceMimeType[index]/* SY */?.toLowerCase())  /* expected MIME type */
    {
        case "application/font-woff":  /* font file */

            /* font file - fall through */

        case "image/svg+xml":  /* svg file or image file*/
        case "image/png":  /* image file */
        // Scrapyard //////////////////////////////////////////////////////////////////
        case "image/jpeg":  /* image file */
        case "image/gif":  /* image file */
        ////////////////////////////////////////////////////////////////// Scrapyard //
        case "image/vnd.microsoft.icon":  /* icon file */
        case "audio/mpeg":  /* audio file */
        case "video/mp4":  /* video file */
        // Scrapyard //////////////////////////////////////////////////////////////////
        case "application/pdf":  /* pdf file */
        ////////////////////////////////////////////////////////////////// Scrapyard //
        case "application/octet-stream":  /* data file */

            if (mimetype != "image/svg+xml")  /* not svg file */
            {
                if (mimetype != "") resourceMimeType[index] = mimetype;
                resourceCharSet[index] = "";

                resourceContent[index] = content;

                break;
            }

            /* svg file - fall through */

        case "text/javascript":  /* javascript file */

            if (mimetype != "image/svg+xml")  /* svg file */
            {
                /* See Mozilla source/dom/base/nsContentUtils.cpp for list of supported JavaScript MIME types */

                if (mimetype != "text/javascript" && mimetype != "text/ecmascript" &&
                    mimetype != "application/javascript" && mimetype != "application/ecmascript" && mimetype != "application/x-javascript" && mimetype != "application/x-ecmascript" &&
                    mimetype != "text/javascript1.0" && mimetype != "text/javascript1.1" && mimetype != "text/javascript1.2" && mimetype != "text/javascript1.3" &&
                    mimetype != "text/javascript1.4" && mimetype != "text/javascript1.5" &&
                    mimetype != "text/x-ecmascript"&& mimetype != "text/x-javascript")  /* incorrect MIME type */
                {
                    await loadFailure(index,"mime");

                    return;
                }
            }

            /* svg or javascript file - fall through */

        case "text/vtt":  /* subtitles file */

            if (mimetype != "") resourceMimeType[index] = mimetype;
            if (charset != "") resourceCharSet[index] = charset;

            if (content.charCodeAt(0) == 0xEF && content.charCodeAt(1) == 0xBB && content.charCodeAt(2) == 0xBF)  /* BOM */
            {
                resourceCharSet[index] = "utf-8";
                content = content.substr(3);
            }

            if (resourceCharSet[index].toLowerCase() == "utf-8")
            {
                try
                {
                    resourceContent[index] = convertUTF8ToUTF16(content);  /* UTF-8 */
                }
                catch (e)
                {
                    resourceCharSet[index] = "iso-8859-1";  /* assume ISO-8859-1 */
                    resourceContent[index] = content;
                }
            }
            else resourceContent[index] = content;  /* ASCII, ANSI, ISO-8859-1, etc */

            break;

        case "text/css":  /* css file */

            if (mimetype != "text/css")  /* incorrect MIME type */
            {
                await loadFailure(index,"mime");

                return;
            }

            matches = content.match(/^@charset "([^"]+)";/i);
            if (matches != null) resourceCharSet[index] = matches[1];

            if (charset != "") resourceCharSet[index] = charset;

            if (content.charCodeAt(0) == 0xEF && content.charCodeAt(1) == 0xBB && content.charCodeAt(2) == 0xBF)  /* BOM */
            {
                resourceCharSet[index] = "utf-8";
                content = content.substr(3);
            }

            if (resourceCharSet[index].toLowerCase() == "utf-8")
            {
                try
                {
                    resourceContent[index] = convertUTF8ToUTF16(content);  /* UTF-8 */
                }
                catch (e)
                {
                    resourceCharSet[index] = "iso-8859-1";  /* assume ISO-8859-1 */
                    resourceContent[index] = content;
                }
            }
            else resourceContent[index] = content;  /* ASCII, ANSI, ISO-8859-1, etc */

            /* External style sheets imported in external style sheet */

            csstext = resourceContent[index];

            baseuri = resourceLocation[index];

            regex = /@import\s*(?:url\(\s*)?((?:"[^"]+")|(?:'[^']+')|(?:[^\s);]+))(?:\s*\))?\s*;/gi;  /* @import url() */

            while ((matches = regex.exec(csstext)) != null)  /* style sheet imported into style sheet */
            {
                matches[1] = removeQuotes(matches[1]);

                if (replaceableResourceURL(matches[1]))
                {
                    i = rememberURL(matches[1],baseuri,"text/css",resourceCharSet[index],false);

                    if (i >= 0)  /* new style sheet */
                    {
                        resourceCount++;

                        if (safeContentOrAllowedMixedContent(i))
                        {
                            loadResource(i,resourceLocation[i],resourceReferrer[i],getReferrerPolicy());
                        }
                        else loadFailure(i,"mixed");
                    }
                }
            }

            break;
    }

    resourceStatus[index] = "success";

    resourceReason[index] = reason;

    if (--resourceCount <= 0)
    {
        timeFinish[passNumber+3] = performance.now();

        if (passNumber == 1) await gatherOtherResources();
        // Scrapyard //////////////////////////////////////////////////////////////////
        else if (passNumber == 2) await generateHTML();
        ////////////////////////////////////////////////////////////////// Scrapyard //
    }
}

async function loadFailure(index,reason)
{
    resourceStatus[index] = "failure";

    resourceReason[index] = reason;

    if (--resourceCount <= 0)
    {
        timeFinish[passNumber+3] = performance.now();

        if (passNumber == 1) await gatherOtherResources();
        // Scrapyard //////////////////////////////////////////////////////////////////
        else if (passNumber == 2) await generateHTML();
        ////////////////////////////////////////////////////////////////// Scrapyard //
    }
}

function safeContentOrAllowedMixedContent(index)
{
    var documentURL,pagescheme,safeContent,mixedContent;

    /* Load request must not be sent if http: resource in https: page or https: referrer */
    /* unless passive mixed content and allowed by user option */

    documentURL = new URL(document.baseURI);

    pagescheme = documentURL.protocol;

    safeContent = (resourceLocation[index].substr(0,6) == "https:" || (resourceLocation[index].substr(0,5) == "http:" && resourceReferrer[index].substr(0,5) == "http:" && pagescheme == "http:"));

    mixedContent = (resourceLocation[index].substr(0,5) == "http:" && (resourceReferrer[index].substr(0,6) == "https:" || pagescheme == "https:"));

    if (safeContent || (mixedContent && resourcePassive[index] && allowPassive)) return true;

    return false;
}

function getReferrerPolicy()
{
    var  incognito;

    incognito = chrome.extension.inIncognitoContext;

    if (crossOrigin == 0 || incognito) return "strict-origin-when-cross-origin";

    return "no-referrer-when-downgrade";
}

function convertUTF8ToUTF16(utf8str)
{
    var i,byte1,byte2,byte3,byte4,codepoint,utf16str;

    /* Convert UTF-8 string to Javascript UTF-16 string */
    /* Each codepoint in UTF-8 string comprises one to four 8-bit values */
    /* Each codepoint in UTF-16 string comprises one or two 16-bit values */

    i = 0;
    utf16str = "";

    while (i < utf8str.length)
    {
        byte1 = utf8str.charCodeAt(i++);

        if ((byte1 & 0x80) == 0x00)
        {
            utf16str += String.fromCharCode(byte1);  /* one 16-bit value */
        }
        else if ((byte1 & 0xE0) == 0xC0)
        {
            byte2 = utf8str.charCodeAt(i++);

            codepoint = ((byte1 & 0x1F) << 6) + (byte2 & 0x3F);

            utf16str += String.fromCodePoint(codepoint);  /* one 16-bit value */
        }
        else if ((byte1 & 0xF0) == 0xE0)
        {
            byte2 = utf8str.charCodeAt(i++);
            byte3 = utf8str.charCodeAt(i++);

            codepoint = ((byte1 & 0x0F) << 12) + ((byte2 & 0x3F) << 6) + (byte3 & 0x3F);

            utf16str += String.fromCodePoint(codepoint);  /* one 16-bit value */
        }
        else if ((byte1 & 0xF8) == 0xF0)
        {
            byte2 = utf8str.charCodeAt(i++);
            byte3 = utf8str.charCodeAt(i++);
            byte4 = utf8str.charCodeAt(i++);

            codepoint = ((byte1 & 0x07) << 18) + ((byte2 & 0x3F) << 12) + ((byte3 & 0x3F) << 6) + (byte4 & 0x3F);

            utf16str += String.fromCodePoint(codepoint);  /* two 16-bit values */
        }
    }

    return utf16str;
}

/************************************************************************/

/* After second pass - load local files */

function loadInfoBar()
{
    var xhr;

    if (includeInfoBar)
    {
        xhr = new XMLHttpRequest();
        xhr.open("GET",chrome.runtime.getURL("pageinfo-bar-compressed.html"),true);
        xhr.onload = complete;
        xhr.send();
    }
    else loadShadowLoader();

    function complete()
    {
        if (xhr.status == 200)
        {
            pageInfoBarText = xhr.responseText;

            loadShadowLoader();
        }
    }
}

function loadShadowLoader()
{
    var xhr;

    xhr = new XMLHttpRequest();
    xhr.overrideMimeType("text/javascript");
    xhr.open("GET",chrome.runtime.getURL("shadowloader-compressed.js"),true);
    xhr.onload = complete;
    xhr.send();

    function complete()
    {
        if (xhr.status == 200)
        {
            shadowLoaderText = xhr.responseText;

            checkResources();
        }
    }
}

/************************************************************************/

/* After second pass - check resources */

function checkResources()
{
    var i,dataurisize,skipcount,failcount,count;
    var skipinflist = new Array();
    var skipurllist = new Array();
    var failinflist = new Array();
    var failurllist = new Array();

    /* Check for large resource sizes and failed resource loads */

    if (pageType == 0)  /* not saved page */
    {
        dataurisize = 0;
        skipcount = 0;
        failcount = 0;

        for (i = 0; i < resourceLocation.length; i++)
        {
            if (resourceCharSet[i] == "")  /* charset not defined - binary data */
            {
                count = mergeCSSImages ? resourceRemembered[i]-resourceCSSRemembered[i]+Object.keys(resourceCSSFrameKeys[i]).length : resourceRemembered[i];

                if (resourceContent[i].length*count > maxResourceSize*1024*1024)  /* skip large and/or repeated resource */
                {
                    skipcount++;
                    skipinflist.push((resourceContent[i].length*count/(1024*1024)).toFixed(1) + " MB");
                    try { skipurllist.push(decodeURIComponent(resourceLocation[i])); }
                    catch (e) { skipurllist.push(resourceLocation[i]); }
                }
                else dataurisize += resourceContent[i].length*count*(4/3);  /* base64 expands by 4/3 */
            }

            if (resourceStatus[i] == "failure")
            {
                if (rootIconLocation != "" && resourceLocation[i] == rootIconLocation && resourceReason[i] == "load:404")
                {
                    rootIconLocation = "";

                    if (resourceRemembered[i] == 1)
                    {
                        resourceLocation.splice(i,1);
                        resourceReferrer.splice(i,1);
                        resourceMimeType.splice(i,1);
                        resourceCharSet.splice(i,1);
                        resourcePassive.splice(i,1);
                        resourceContent.splice(i,1);
                        resourceStatus.splice(i,1);
                        resourceReason.splice(i,1);
                        resourceRemembered.splice(i,1);
                        resourceReplaced.splice(i,1);
                        resourceCSSRemembered.splice(i,1);
                        resourceCSSFrameKeys.splice(i,1);
                        i--;
                    }
                    else resourceRemembered[i]--;
                }
                else
                {
                    failcount++;
                    failinflist.push(resourceReason[i]);
                    try { failurllist.push(decodeURIComponent(resourceLocation[i])); }
                    catch (e) { failurllist.push(resourceLocation[i]); }
                }
            }
        }

        if (dataurisize > maxTotalSize*1024*1024)
        {
            showMessage("Total size of resources is too large","Save",
                        "Cannot save page because the total size of resources exceeds " + maxTotalSize + "MB.\n\n" +
                        "It may be possible to save this page by trying these suggestions:\n\n" +
                        "    •  Save Basic Items.\n" +
                        "    •  Save Custom Items with some items disabled.\n" +
                        "    •  Reduce the 'Maximum size allowed for a resource' option value.",
                        null,
                        function savecancel()
                        {
                            // Scrapyard //////////////////////////////////////////////////////////////////
                            if (loadLazyContent != toggleLazy && lazyLoadType == 2) undoShrinkPage();
                            ////////////////////////////////////////////////////////////////// Scrapyard //

                            chrome.runtime.sendMessage({ type: "saveExit" });
                        });
        }
        else if (showWarning && !(skipWarningsComments && multipleSaves))
        {
            if (skipcount > 0)
            {
                showMessage("Some resources exceed maximum size","Save",
                            skipcount + " of " + resourceLocation.length + " resources exceed maximum size allowed.\n\n" +
                            "It may be possible to save these resources by trying these suggestions:\n\n" +
                            "    •  Increase the 'Maximum size allowed for a resource' option value.",
                            function savecontinue()
                            {
                                if (failcount > 0) someResourcesNotLoaded();
                                else if (showResources) showUnsavedResources();
                                else enterComments();
                            },
                            function savecancel()
                            {
                                // Scrapyard //////////////////////////////////////////////////////////////////
                                if (loadLazyContent != toggleLazy && lazyLoadType == 2) undoShrinkPage();
                                ////////////////////////////////////////////////////////////////// Scrapyard //

                                chrome.runtime.sendMessage({ type: "saveExit" });
                            });
            }
            else if (failcount > 0) someResourcesNotLoaded();
            else enterComments();
        }
        else if (showResources && !(skipWarningsComments && multipleSaves))
        {
            if (skipcount > 0 || failcount > 0) showUnsavedResources();
            else enterComments();
        }
        else enterComments();
    }
    else enterComments();

    function someResourcesNotLoaded()
    {
        showMessage("Some resources could not be loaded","Save",
            failcount + " of " + resourceLocation.length + " resources could not be loaded.\n\n" +
            "It may be possible to load these resources by trying these suggestions:\n\n" +
            "    •  Scroll to the bottom of the page before saving.\n" +
            "    •  Use normal browsing instead of private browsing.\n" +
            "    •  Enable the 'Allow passive mixed content' option.\n" +
            "    •  Select the 'Send referrer headers with origin and path' option.\n" +
            "    •  Increase the 'Maximum time for loading a resource' option value.",
            function savecontinue()
            {
                if (showResources) showUnsavedResources();
                else enterComments();
            },
            function savecancel()
            {
                // Scrapyard //////////////////////////////////////////////////////////////////
                if (loadLazyContent != toggleLazy && lazyLoadType == 2) undoShrinkPage();
                ////////////////////////////////////////////////////////////////// Scrapyard //

                chrome.runtime.sendMessage({ type: "saveExit" });
            });
    }

    function showUnsavedResources()
    {
        var i,xhr,parser,unsaveddoc,container,div;

        /* Load unsaved resources panel */

        xhr = new XMLHttpRequest();
        xhr.open("GET",chrome.runtime.getURL("unsaved-panel.html"),true);
        xhr.onload = complete;
        xhr.send();

        function complete()
        {
            if (xhr.status == 200)
            {
                /* Parse unsaved resources document */

                parser = new DOMParser();
                unsaveddoc = parser.parseFromString(xhr.responseText,"text/html");

                /* Create container element */

                container = document.createElement("div");
                container.setAttribute("id","savepage-unsaved-panel-container");
                document.documentElement.appendChild(container);

                /* Append unsaved resources elements */

                container.appendChild(unsaveddoc.getElementById("savepage-unsaved-panel-overlay"));

                /* Add listeners for buttons */

                document.getElementById("savepage-unsaved-panel-continue").addEventListener("click",clickContinueOne,false);
                document.getElementById("savepage-unsaved-panel-cancel").addEventListener("click",clickCancel,false);

                /* Focus continue button */

                document.getElementById("savepage-unsaved-panel-continue").focus();

                /* Populate skipped resources */

                if (skipurllist.length > 0)
                {
                    document.getElementById("savepage-unsaved-panel-header").textContent = "Resources that exceed maximum size";

                    for (i = 0; i < skipurllist.length; i++)
                    {
                        div = document.createElement("div");
                        div.textContent = (i+1);
                        document.getElementById("savepage-unsaved-panel-nums").appendChild(div);

                        div = document.createElement("div");
                        div.textContent = skipinflist[i];
                        document.getElementById("savepage-unsaved-panel-infs").appendChild(div);

                        div = document.createElement("div");
                        div.textContent = skipurllist[i];
                        document.getElementById("savepage-unsaved-panel-urls").appendChild(div);
                    }

                    /* Select this tab */

                    chrome.runtime.sendMessage({ type: "selectTab" });
                }
                else clickContinueOne();
            }
        }

        function clickContinueOne()
        {
            var i,div;

            /* Remove skipped resources */

            if (skipurllist.length > 0)
            {
                for (i = 0; i < skipurllist.length; i++)
                {
                    document.getElementById("savepage-unsaved-panel-nums").removeChild(document.getElementById("savepage-unsaved-panel-nums").children[0]);
                    document.getElementById("savepage-unsaved-panel-infs").removeChild(document.getElementById("savepage-unsaved-panel-infs").children[0]);
                    document.getElementById("savepage-unsaved-panel-urls").removeChild(document.getElementById("savepage-unsaved-panel-urls").children[0]);
                }

                skipurllist.length = 0;
            }

            /* Change listener for continue button */

            document.getElementById("savepage-unsaved-panel-continue").removeEventListener("click",clickContinueOne,false);
            document.getElementById("savepage-unsaved-panel-continue").addEventListener("click",clickContinueTwo,false);

            /* Change text alignment of information column */

            document.getElementById("savepage-unsaved-panel-infs").style.setProperty("text-align","left","important");

            /* Populate failed resources */

            if (failurllist.length > 0)
            {
                document.getElementById("savepage-unsaved-panel-header").textContent = "Resources that could not be loaded";

                for (i = 0; i < failurllist.length; i++)
                {
                    div = document.createElement("div");
                    div.textContent = (i+1);
                    document.getElementById("savepage-unsaved-panel-nums").appendChild(div);

                    div = document.createElement("div");
                    div.textContent = failinflist[i];
                    document.getElementById("savepage-unsaved-panel-infs").appendChild(div);

                    div = document.createElement("div");
                    div.textContent = failurllist[i];
                    document.getElementById("savepage-unsaved-panel-urls").appendChild(div);
                }

                failurllist.length = 0;

                /* Select this tab */

                chrome.runtime.sendMessage({ type: "selectTab" });
            }
            else clickContinueTwo();
        }

        function clickContinueTwo()
        {
            document.documentElement.removeChild(document.getElementById("savepage-unsaved-panel-container"));

            enterComments();
        }

        function clickCancel()
        {
            document.documentElement.removeChild(document.getElementById("savepage-unsaved-panel-container"));

            // Scrapyard //////////////////////////////////////////////////////////////////
            if (loadLazyContent != toggleLazy && lazyLoadType == 2) undoShrinkPage();
            ////////////////////////////////////////////////////////////////// Scrapyard //

            chrome.runtime.sendMessage({ type: "saveExit" });
        }
    }
}

/************************************************************************/

/* After second pass - prompt user to enter comments */

function enterComments()
{
    var i,xhr,parser,commentsdoc,container,comments;

    /* Load comments panel */

    if (promptComments && !(skipWarningsComments && multipleSaves))
    {
        xhr = new XMLHttpRequest();
        xhr.open("GET",chrome.runtime.getURL("comments-panel.html"),true);
        xhr.onload = complete;
        xhr.send();
    }
    else
    {
        // Scrapyard //////////////////////////////////////////////////////////////////
        new Promise(resolve => setTimeout(() => resolve(), 10)).then(   /* allow time for any open panel to close */
        ////////////////////////////////////////////////////////////////// Scrapyard //
        function(object)
        {
            generateHTML();
        });
    }

    function complete()
    {
        if (xhr.status == 200)
        {
            /* Parse comments document */

            parser = new DOMParser();
            commentsdoc = parser.parseFromString(xhr.responseText,"text/html");

            /* Create container element */

            container = document.createElement("div");
            container.setAttribute("id","savepage-comments-panel-container");
            document.documentElement.appendChild(container);

            /* Append page info elements */

            container.appendChild(commentsdoc.getElementById("savepage-comments-panel-overlay"));

            /* Add listeners for buttons */

            document.getElementById("savepage-comments-panel-continue").addEventListener("click",clickContinue,false);
            document.getElementById("savepage-comments-panel-cancel").addEventListener("click",clickCancel,false);

            /* Focus text area */

            document.getElementById("savepage-comments-panel-textarea").focus();

            /* Populate comments contents */

            if (pageType > 0)  /* saved page */
            {
                comments = document.querySelector("meta[name='savepage-comments']").content;  /* decodes HTML entities */

                document.getElementById("savepage-comments-panel-textarea").value = comments;
            }

            /* Select this tab */

            chrome.runtime.sendMessage({ type: "selectTab" });
        }
    }

    function clickContinue()
    {
        var comments;

        comments = document.getElementById("savepage-comments-panel-textarea").value;

        comments = comments.replace(/&/g,"&amp;");
        comments = comments.replace(/"/g,"&quot;");
        comments = comments.replace(/\u000A/g,"&NewLine;");

        enteredComments = comments;

        document.documentElement.removeChild(document.getElementById("savepage-comments-panel-container"));

        // Scrapyard //////////////////////////////////////////////////////////////////
        new Promise(resolve => setTimeout(() => resolve(), 10)).then(   /* allow time for enter comments panel to close */
        ////////////////////////////////////////////////////////////////// Scrapyard //
        function(object)
        {
            generateHTML();
        });
    }

    function clickCancel()
    {
        document.documentElement.removeChild(document.getElementById("savepage-comments-panel-container"));

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (loadLazyContent != toggleLazy && lazyLoadType == 2) undoShrinkPage();
        ////////////////////////////////////////////////////////////////// Scrapyard //

        chrome.runtime.sendMessage({ type: "saveExit" });
    }
}

/************************************************************************/

/* Third Pass - to generate HTML and save to file */

// Scrapyard //////////////////////////////////////////////////////////////////
async function generateHTML()
////////////////////////////////////////////////////////////////// Scrapyard //
{
    var i,j,totalscans,totalloads,maxstrsize,totalstrsize,count,mimetype,charset,pageurl,htmlString,htmlIndex,filename,htmlBlob,objectURL,link;

    passNumber = 3;

    chrome.runtime.sendMessage({ type: "setSaveState", savestate: 3 });

    /* Generate HTML */

    timeStart[3] = performance.now();

    // Scrapyard //////////////////////////////////////////////////////////////////
    await extractHTML(0,window,document.documentElement,false,false,"0",0,0);
    ////////////////////////////////////////////////////////////////// Scrapyard //

    timeFinish[3] = performance.now();

    /* Append metrics and resource summary */

    if (includeSummary)
    {
        totalscans = timeFinish[1]-timeStart[1]+timeFinish[2]-timeStart[2]+timeFinish[3]-timeStart[3];
        totalloads = timeFinish[4]-timeStart[4]+timeFinish[5]-timeStart[5];

        htmlStrings[htmlStrings.length] = "\n\n<!--\n\n";

        htmlStrings[htmlStrings.length] = "SAVE PAGE WE\n\n";

        htmlStrings[htmlStrings.length] = "Metrics and Resource Summary\n\n";

        htmlStrings[htmlStrings.length] = "Pass 1 scan:  " + ("     " + Math.round(timeFinish[1]-timeStart[1])).substr(-6) + " ms\n";
        htmlStrings[htmlStrings.length] = "Pass 2 scan:  " + ("     " + Math.round(timeFinish[2]-timeStart[2])).substr(-6) + " ms\n";
        htmlStrings[htmlStrings.length] = "Pass 3 scan:  " + ("     " + Math.round(timeFinish[3]-timeStart[3])).substr(-6) + " ms\n";
        htmlStrings[htmlStrings.length] = "Total scans:  " + ("     " + Math.round(totalscans)).substr(-6) + " ms\n\n";

        htmlStrings[htmlStrings.length] = "Pass 1 loads: " + ("     " + Math.round(timeFinish[4]-timeStart[4])).substr(-6) + " ms\n";
        htmlStrings[htmlStrings.length] = "Pass 2 loads: " + ("     " + Math.round(timeFinish[5]-timeStart[5])).substr(-6) + " ms\n";
        htmlStrings[htmlStrings.length] = "Total loads:  " + ("     " + Math.round(totalloads)).substr(-6) + " ms\n\n";

        htmlStrings[htmlStrings.length] = "String count:     "  + ("    " + htmlStrings.length).substr(-5) + "\n";

        maxstrsize = totalstrsize = 0;

        for (i = 0; i < htmlStrings.length; i++)
        {
            totalstrsize += htmlStrings[i].length;

            if (htmlStrings[i].length > maxstrsize) maxstrsize = htmlStrings[i].length;
        }

        htmlStrings[htmlStrings.length] = "Max size:      "  + ("       " + maxstrsize).substr(-8) + "\n";
        htmlStrings[htmlStrings.length] = "Total size:   "  + ("        " + totalstrsize).substr(-9) + "\n\n";

        htmlStrings[htmlStrings.length] = "Resource count:    "  + ("   " + resourceLocation.length).substr(-4) + "\n";

        if (pageType == 0)
        {
            htmlStrings[htmlStrings.length] = "\nNum  Refs  Reps  Status   Reason    MimeType    CharSet   ByteSize    URL\n\n";

            for (i = 0; i < resourceLocation.length; i++)
            {
                count = mergeCSSImages ? resourceRemembered[i]-resourceCSSRemembered[i]+Object.keys(resourceCSSFrameKeys[i]).length : resourceRemembered[i];

                j = resourceMimeType[i].indexOf("/");

                mimetype = resourceMimeType[i].substr(0,j).substr(0,5);
                mimetype += "/";
                mimetype += resourceMimeType[i].substr(j+1,4);

                charset = (resourceCharSet[i] == "") ? "binary" : resourceCharSet[i];

                htmlStrings[htmlStrings.length] = ("   " + i).substr(-3) + "  " +
                                                  ("    " + resourceRemembered[i]).substr(-4) + "  " +
                                                  ("    " + resourceReplaced[i]).substr(-4) + "  " +
                                                  resourceStatus[i] + "  " +
                                                  (resourceReason[i] + "         ").substr(0,9) + "  " +
                                                  (mimetype + "          ").substr(0,10) + "  " +
                                                  (charset + "        ").substr(0,8) + "  " +
                                                  ("        " + resourceContent[i].length).substr(-8) + "    " +
                                                  resourceLocation[i] + "\n";
            }
        }

        htmlStrings[htmlStrings.length] = "\n-->\n";
    }

    /* Release resources */

    frameKey.length = 0;
    frameURL.length = 0;
    frameHTML.length = 0;
    frameFonts.length = 0;

    resourceLocation.length = 0;
    resourceReferrer.length = 0;
    resourceMimeType.length = 0;
    resourceCharSet.length = 0;
    resourcePassive.length = 0;
    resourceContent.length = 0;
    resourceStatus.length = 0;
    resourceReason.length = 0;
    resourceRemembered.length = 0;
    resourceReplaced.length = 0;
    resourceCSSRemembered.length = 0;
    resourceCSSFrameKeys.length = 0;

    firstIconLocation = "";
    rootIconLocation = "";

    pageInfoBarText = "";
    shadowLoaderText = "";
    enteredComments = "";

    // Scrapyard //////////////////////////////////////////////////////////////////
    selectionElement = null;
    skipIfSelected = false;

    if (loadLazyContent != toggleLazy && lazyLoadType == 2)
    ////////////////////////////////////////////////////////////////// Scrapyard //
    {
        undoShrinkPage();

        for (i = 0; i < htmlStrings.length; i++)
        {
            if (htmlStrings[i].indexOf("<html") == 0)
            {
                htmlStrings[i] = htmlStrings[i].replace(/ style="(?:\\"|[^"])*"/," style=\"" + htmlCssText.replace(/"/g,"&quot;") + "\"");
            }
            else if (htmlStrings[i].indexOf("<body") == 0)
            {
                htmlStrings[i] = htmlStrings[i].replace(/ style="(?:\\"|[^"])*"/," style=\"" + bodyCssText.replace(/"/g,"&quot;") + "\"");

                break;
            }
        }
    }

    // Scrapyard //////////////////////////////////////////////////////////////////
    chrome.runtime.sendMessage({ type: "setSaveState", savestate: 0 });

    let resultingHTML = htmlStrings.join("");
    htmlStrings.length = 0;

    if (siteCapture)
        scrapyardBookmark.__site_capture.links = selectionLinks || frameLinks.reduce((acc, item) => [...acc, ...item], []);

    const pageIndex = frameIndex.reduce((acc, item) => [...acc, ...item], []);
    scrapyardBookmark.__index = {words: Array.from(new Set(pageIndex))};

    chrome.runtime.sendMessage({type: "storePageHtml", html: resultingHTML, bookmark: scrapyardBookmark});
    ////////////////////////////////////////////////////////////////// Scrapyard //

    // if (cancelSave)
    // {
    //     htmlStrings.length = 0;
    //
    //     chrome.runtime.sendMessage({ type: "saveExit" });
    // }
    // else if (useNewSaveMethod || useAutomation)  /* use new save method - chrome.downloads.download() */
    // {
    //     // createLargeTestFile();
    //
    //     htmlString = "";
    //     htmlIndex = 0;
    //
    //     for (i = 0; i < htmlStrings.length; i++)
    //     {
    //         htmlString += htmlStrings[i];
    //
    //         if (htmlString.length >= 1024*1024 || i == htmlStrings.length-1)  /* >= 1MB */
    //         {
    //             chrome.runtime.sendMessage({ type: "transferString", htmlstring: htmlString, htmlindex: htmlIndex });
    //
    //             htmlString = "";
    //             htmlIndex++;
    //         }
    //     }
    //
    //     htmlStrings.length = 0;
    //
    //     pageurl = (pageType == 0) ? document.URL : document.querySelector("meta[name='savepage-url']").content;
    //
    //     filename = getSavedFileName(pageurl,document.title,false);
    //
    //     chrome.runtime.sendMessage({ type: "savePage", filename: filename });
    // }
    // else  /* use old save method - HTML5 download attribute */
    // {
    //     // createLargeTestFile();
    //
    //     pageurl = (pageType == 0) ? document.URL : document.querySelector("meta[name='savepage-url']").content;
    //
    //     filename = getSavedFileName(pageurl,document.title,false);
    //
    //     htmlBlob = new Blob(htmlStrings, { type : "text/html" });
    //
    //     objectURL = window.URL.createObjectURL(htmlBlob);
    //
    //     htmlBlob = null;
    //
    //     htmlStrings.length = 0;
    //
    //     link = document.createElement("a");
    //     link.download = filename;
    //     link.href = objectURL;
    //
    //     link.addEventListener("click",handleClick,true);
    //
    //     link.dispatchEvent(new MouseEvent("click"));  /* save page as .html file */
    //
    //     link.removeEventListener("click",handleClick,true);
    //
    //     function handleClick(event)
    //     {
    //         event.stopPropagation();
    //     }
    //
    //     // Scrapyard //////////////////////////////////////////////////////////////////
    //        new Promise(resolve => setTimeout(() => resolve(), 100)).then(   /* allow time before revoking object URL */
    //     ////////////////////////////////////////////////////////////////// Scrapyard //
    //     function(object)
    //     {
    //         window.URL.revokeObjectURL(objectURL);
    //
    //         chrome.runtime.sendMessage({ type: "setSaveState", savestate: -2 });
    //
    //         chrome.runtime.sendMessage({ type: "saveDone" });
    //     });
    // }
}

function undoShrinkPage()
{
    document.documentElement.style.cssText = htmlCssText;
    document.body.style.cssText = bodyCssText;

    window.scrollTo(0,origScrollY);
}

function createLargeTestFile()
{
    /* Create htmlStrings to test large saved file sizes */

    var i,j;

    var fileSizeMB = 1024;

    var string32 = "|--abcdefghijklmnopqrstuvwxyz--|";

    htmlStrings.length = 0;

    for (i = 0; i < fileSizeMB; i++)
    {
        htmlStrings[i] = "";

        for (j = 0; j < 1024*1024/32; j++) htmlStrings[i] += string32;
    }
}

// Scrapyard //////////////////////////////////////////////////////////////////
async function extractHTML(depth,frame,element,crossframe,nosrcframe,framekey,parentpreserve,indent)
////////////////////////////////////////////////////////////////// Scrapyard //
{
    var i,j,tagName,startTag,textContent,endTag,inline,preserve,style,display,position,whitespace,displayed,csstext,baseuri,documenturi,separator,origurl,datauri,origstr,dupelement,dupsheet,location,newurl;
    var visible,width,height,currentsrc,svgstr,parser,svgdoc,svgfragid,svgelement,svghref,subframekey,startindex,endindex,htmltext,origsrcdoc,origsandbox,framedoc,prefix,shadowroot;
    var doctype,target,text,asciistring,date,datestr,pubelement,pubstr,pubzone,pubdate,pubdatestr,pageurl,state;
    var pubmatches = new Array();
    var metadataElements = new Array("base","link","meta","noscript","script","style","template","title");  /* HTML Living Standard 3.2.5.2.1 Metadata Content */
    var voidElements = new Array("area","base","br","col","command","embed","frame","hr","img","input","keygen","link","menuitem","meta","param","source","track","wbr");  /* W3C HTML5 2011 4.3 Elements + menuitem */
    var retainElements = new Array("html","head","body","base","command","link","meta","noscript","script","style","template","title");
    var hiddenElements = new Array("area","base","datalist","head","link","meta","param","rp","script","source","style","template","track","title");  /* W3C HTML5 2014 10.3.1 Hidden Elements */

    // Scrapyard //////////////////////////////////////////////////////////////////
    // TODO: deprecate saveUnpacked
    async function saveFrame(uri, persist, sandboxed) {
        origurl = element.getAttribute("src");

        datauri = uri;

        origstr = (datauri == origurl)? "": " data-savepage-src=\"" + origurl + "\"";

        // if (sandboxed)
        //     origstr += " sandbox=\"allow-scripts\"";

        startTag = startTag.replace(/ src="[^"]*"/, origstr + " src=\"" + datauri + "\"");

        if (persist)
            return chrome.runtime.sendMessage({ type: "saveResource", content: htmltext, filename: datauri, node: scrapyardBookmark});
    }
    ////////////////////////////////////////////////////////////////// Scrapyard //

    /* Check for <button> element inside ancestor <button> element - W3C HTML5 2011 4.10.8 The button Element (no interactive content) */

    if (element.localName == "button" && element.parentElement != null && element.parentElement.closest("button") != null) tagName = "span";
    else tagName = element.localName;

    /* Create element start and end tags */

    startTag = "<" + tagName;
    for (i = 0; i < element.attributes.length; i++)
    {
        if (element.attributes[i].name != "zoompage-fontsize")
        {
            startTag += " " + element.attributes[i].name;
            startTag += "=\"";
            startTag += element.attributes[i].value.replace(/"/g,"&quot;");
            startTag += "\"";
        }
    }
    if (element.parentElement != null && element.parentElement.localName == "head" && metadataElements.indexOf(tagName) < 0)
    {
        /* Non-metadata element in head will be moved to body when saved page is opened */
        /* Add hidden attribute to keep element hidden */

        startTag += " data-savepage-nonmetadata=\"\" hidden=\"\"";
    }
    startTag += ">";

    textContent = "";

    if (voidElements.indexOf(tagName) >= 0) endTag = "";
    else endTag = "</" + tagName + ">";

    /* Determine if element is phrasing content - set inline based on CSS display value */

    /* Determine if element format should be preserved - set preserve based on CSS white-space value */
    /*   0 = collapse newlines, collapse spaces (normal or nowrap) */
    /*   1 = preserve newlines, collapse spaces (pre-line)         */
    /*   2 = preserve newlines, preserve spaces (pre or pre-wrap)  */

    if (pageType == 0 && formatHTML && depth == 0)
    {
        if (crossframe)
        {
            /* In a cross-origin frame, the document created by DOMParser */
            /* does not have an associated frame window, which means that */
            /* the window.getComputedStyle() function cannot be called.   */

            /* Assume all elements are block with collapsed newlines and spaces */

            inline = false;
            preserve = 0;
        }
        else if ((style = frame.getComputedStyle(element)) == null)  /* should not happen */
        {
            inline = false;
            preserve = 0;
        }
        else
        {
            display = style.getPropertyValue("display");
            position = style.getPropertyValue("position");
            whitespace = style.getPropertyValue("white-space");

            if (display.indexOf("inline") >= 0 || (display == "none" && document.body.contains(element))) inline = true;
            else if (position == "absolute" || position == "fixed") inline = true;
            else inline = false;

            if (whitespace == "pre" || whitespace == "pre-wrap") preserve = 2;
            else if (whitespace == "pre-line") preserve = 1;
            else /* normal or nowrap */ preserve = 0;
        }
    }
    else
    {
        inline = false;
        preserve = 0;
    }

    // Scrapyard //////////////////////////////////////////////////////////////////
    // if we have selection, skip HTML generation of all body elements, replace with selection
    if (depth == 0 && selectionElement && element.parentElement && element.parentElement.localName === "body") {
        if (skipIfSelected) {
            return;
        } else {
            for (let i = 0; i < selectionElement.children.length; ++i)
                await extractHTML(0,window,selectionElement.children[i],crossframe,nosrcframe,subframekey,preserve,indent+2);

            skipIfSelected = true;
            return;
        }
    }

    if (element.id?.startsWith("scrapyard-"))
        return;
    ////////////////////////////////////////////////////////////////// Scrapyard //

    /* Determine if element is displayed */

    if (crossframe)
    {
        /* In a cross-origin frame, the document created by DOMParser */
        /* does not have an associated frame window, which means that */
        /* the window.getComputedStyle() function cannot be called.   */

        /* Assume all elements are displayed */

        displayed = true;
    }
    else if ((style = frame.getComputedStyle(element)) == null) displayed = true;  /* should not happen */
    else displayed = (style.getPropertyValue("display") != "none");  /* element not collapsed */

    /* Extract HTML from DOM and replace external resources with data URI's */

    /* External images referenced in any element's style attribute */

    if (element.hasAttribute("style"))
    {
        csstext = element.getAttribute("style");

        baseuri = element.ownerDocument.baseURI;

        documenturi = element.ownerDocument.documentURI;

        if (isFirefox) csstext = enumerateCSSInsetProperty(csstext);

        csstext = replaceCSSImageURLs(csstext,baseuri,documenturi,framekey);

        startTag = startTag.replace(/ style="(?:\\"|[^"])*"/," style=\"" + csstext.replace(/"/g,"&quot;") + "\"");
    }

    /* Remove or Rehide elements */

    if (removeElements)
    {
        /* Remove elements that have been collapsed by the page, page editors or content blockers - so are not displayed */
        /* Do not remove elements that are essential */
        /* Do not remove <svg> elements because child elements may be referenced by <use> elements in other <svg> elements */

        if (retainElements.indexOf(element.localName) < 0 && !(element instanceof SVGElement) && !displayed)
        {
            htmlStrings[htmlStrings.length] = "<!--savepage-" + element.localName + "-remove-->";

            return;
        }
    }
    else if (rehideElements)
    {
        /* Rehide elements that have been collapsed by the page, page editors or content blockers - so are not displayed */
        /* Do not hide elements that are hidden by default */

        if (hiddenElements.indexOf(element.localName) < 0 && !displayed)
        {
            csstext = "/*savepage-rehide*/ display: none !important;";

            if (element.hasAttribute("style"))
            {
                if (element.getAttribute("style").trim().substr(-1) != ";") separator = "; ";
                else separator = " ";

                startTag = startTag.replace(/ style="(?:\\"|[^"])*"/," style=\"" + element.getAttribute("style").replace(/"/g,"&quot;") + separator + csstext + "\"");
            }
            else startTag = startTag.replace("<" + element.localName,"<" + element.localName + " style=\"" + csstext + "\"");
        }
    }

    /* Content Security Policy in <meta> element */

    if (element.localName == "meta")
    {
        if (element.httpEquiv.toLowerCase() == "content-security-policy")
        {
            origstr = " data-savepage-content=\"" + element.content + "\"";

            startTag = startTag.replace(/ content="(?:\\"|[^"])*"/,origstr + " content=\"\"");
        }
    }

    /* External script referenced in <script> element */
    /* Internal script in <script> element */

    else if (element.localName == "script")
    {
        if ((savedItems == 2 && saveScripts) && !crossframe && !nosrcframe)
        {
            if (element.getAttribute("src"))  /* external script */
            {
                if (replaceableResourceURL(element.src))
                {
                    baseuri = element.ownerDocument.baseURI;

                    documenturi = element.ownerDocument.documentURI;

                    origurl = element.getAttribute("src");

                    datauri = replaceURL(origurl,baseuri,documenturi);

                    origstr = (datauri == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                    startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                }
            }
            else  /* internal script */
            {
                textContent = element.textContent;
            }

            if (!executeScripts)
            {
                if (element.hasAttribute("type")) origstr = " data-savepage-type=\"" + element.getAttribute("type") + "\"";
                else origstr = " data-savepage-type=\"\"";

                if (element.hasAttribute("type")) startTag = startTag.replace(/ type="[^"]*"/,origstr + " type=\"text/plain\"");
                else startTag = startTag.replace(/<script/,"<script" + origstr + " type=\"text/plain\"");
            }
        }
        else
        {
            if (element.getAttribute("src"))  /* external script */
            {
                origurl = element.getAttribute("src");

                origstr = " data-savepage-src=\"" + origurl + "\"";

                startTag = startTag.replace(/ src="[^"]*"/,origstr + "");  /* replacing with src="" would be invalid HTML */
            }

            if (element.hasAttribute("type")) origstr = " data-savepage-type=\"" + element.getAttribute("type") + "\"";
            else origstr = " data-savepage-type=\"\"";

            if (element.hasAttribute("type")) startTag = startTag.replace(/ type="[^"]*"/,origstr + " type=\"text/plain\"");
            else startTag = startTag.replace(/<script/,"<script" + origstr + " type=\"text/plain\"");
        }
    }

    /* External images or fonts referenced in <style> element */

    else if (element.localName == "style")
    {
        if (element.id == "zoompage-pageload-style" || element.id == "zoompage-zoomlevel-style" || element.id == "zoompage-fontsize-style")  /* Zoom Page WE */
        {
            startTag = "";
            endTag = "";
            textContent = "";
        }
        else if (element.hasAttribute("class") && element.getAttribute("class").indexOf("darkreader") >= 0)  /* Dark Reader*/
        {
            startTag = "";
            endTag = "";
            textContent = "";
        }
        else
        {
            if (!element.disabled)
            {
                if (element.hasAttribute("data-savepage-sheetrules"))
                {
                    csstext = element.getAttribute("data-savepage-sheetrules");

                    startTag = startTag.replace(/ data-savepage-sheetrules="(?:\\"|[^"])*"/," data-savepage-sheetrules=\"\"");
                }
                else
                {
                    try
                    {
                        /* Count rules in element.textContent by creating duplicate element */

                        dupelement = element.ownerDocument.createElement("style");
                        dupelement.textContent = element.textContent;
                        element.ownerDocument.body.appendChild(dupelement);
                        dupsheet = dupelement.sheet;
                        dupelement.remove();

                        /* There may be rules in element.sheet.cssRules that are not in element.textContent */
                        /* For example if the page uses CSS-in-JS Libraries */

                        if (dupsheet.cssRules.length != element.sheet.cssRules.length)
                        {
                            csstext = "";

                            for (i = 0; i < element.sheet.cssRules.length; i++)
                                csstext += element.sheet.cssRules[i].cssText + "\n";

                            startTag = startTag.replace(/<style/,"<style data-savepage-sheetrules=\"\"");
                        }
                        else csstext = element.textContent;
                    }
                    catch (e)  /* sheet.cssRules does not exist or cross-origin style sheet */
                    {
                        csstext = element.textContent;
                    }
                }

                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                if (isFirefox) csstext = enumerateCSSInsetProperty(csstext);

                textContent = replaceCSSURLsInStyleSheet(csstext,baseuri,documenturi,[],framekey);

                if (swapDevices) textContent = swapScreenAndPrintDevices(textContent);
            }
            else
            {
                startTag = startTag.replace(/<style/,"<style data-savepage-disabled=\"\"");

                textContent = "";
            }
        }
    }

    /* External images or fonts referenced in <link> element */
    /* External icon referenced in <link> element */

    else if (element.localName == "link" && !(element.parentElement instanceof SVGElement))  /* <link> is invalid inside <svg> */
    {
        if (element.rel.toLowerCase().indexOf("stylesheet") >= 0 && element.getAttribute("href"))
        {
            if (!element.disabled)
            {
                if (replaceableResourceURL(element.href))
                {
                    baseuri = element.ownerDocument.baseURI;

                    if (baseuri != null)
                    {
                        location = resolveURL(element.href,baseuri);

                        if (location != null)
                        {
                            location = removeFragment(location);

                            for (i = 0; i < resourceLocation.length; i++)
                                if (resourceLocation[i] == location && resourceStatus[i] == "success") break;

                            if (i < resourceLocation.length)  /* style sheet found */
                            {
                                csstext = resourceContent[i];

                                /* Converting <link> into <style> means that CSS rules are embedded in saved HTML file */
                                /* Therefore need to escape any </style> end tags that may appear inside CSS strings */

                                csstext = csstext.replace(/<\/style>/gi,"<\\/style>");

                                baseuri = element.href;

                                documenturi = element.href;

                                textContent = replaceCSSURLsInStyleSheet(csstext,baseuri,documenturi,[location],framekey);

                                if (swapDevices) textContent = swapScreenAndPrintDevices(textContent);

                                // Scrapyard //////////////////////////////////////////////////////////////////
                                // TODO: deprecate save unpacked
                                if (saveUnpacked) {
                                    origurl = element.getAttribute("href");

                                    datauri = `style_${styleCounter++}.css`;

                                    origstr = (datauri == origurl)? "": " data-savepage-href=\"" + origurl + "\"";

                                    startTag = startTag.replace(/ href="[^"]*"/, origstr + " href=\"" + datauri + "\"");

                                    await chrome.runtime.sendMessage({type: "saveResource", content: textContent, filename: datauri, node: scrapyardBookmark});

                                    textContent = "";
                                }
                                else {

                                /* Converting <link> into <style> means that CSS rules are embedded in saved HTML file */
                                /* Therefore need to escape any </style> end tags that may appear inside CSS strings */

                                    textContent = textContent.replace(/<\/style>/gi,"<\\/style>");

                                ////////////////////////////////////////////////////////////////// Scrapyard //
                                startTag = "<style data-savepage-href=\"" + element.getAttribute("href") + "\"";
                                if (element.type != "") startTag += " type=\"" + element.type + "\"";
                                if (element.media != "") startTag += " media=\"" + element.media + "\"";
                                startTag += ">";
                                endTag = "</style>";
                                // Scrapyard //////////////////////////////////////////////////////////////////
                                }
                                ////////////////////////////////////////////////////////////////// Scrapyard //
                                resourceReplaced[i]++;
                            }
                        }
                    }
                }
            }
            else
            {
                origurl = element.getAttribute("href");

                origstr = " data-savepage-href=\"" + origurl + "\"";

                startTag = startTag.replace(/<link/,"<link data-savepage-disabled=\"\"");
                startTag = startTag.replace(/ href="[^"]*"/,origstr + " href=\"\"");
            }
        }
        else if ((element.rel.toLowerCase() == "icon" || element.rel.toLowerCase() == "shortcut icon") && element.getAttribute("href"))
        {
            if (replaceableResourceURL(element.href))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("href");

                datauri = replaceURL(origurl,baseuri,documenturi);

                origstr = (datauri == origurl) ? "" : " data-savepage-href=\"" + origurl + "\"";

                startTag = startTag.replace(/ href="[^"]*"/,origstr + " href=\"" + datauri + "\"");
            }
        }
        else if (element.rel.toLowerCase().indexOf("dns-prefetch") >= 0 || element.rel.toLowerCase().indexOf("preconnect") >= 0 ||
                 element.rel.toLowerCase().indexOf("prefetch") >= 0 || element.rel.toLowerCase().indexOf("preload") >= 0 ||
                 element.rel.toLowerCase().indexOf("prerender") >= 0)
        {
            origurl = element.getAttribute("href");

            origstr = " data-savepage-href=\"" + origurl + "\"";

            startTag = startTag.replace(/ href="[^"]*"/,origstr + " href=\"\"");
        }
        else  /* unsaved url */
        {
            baseuri = element.ownerDocument.baseURI;

            documenturi = element.ownerDocument.documentURI;

            origurl = element.getAttribute("href");

            newurl = unsavedURL(origurl,baseuri,documenturi);

            origstr = (newurl == origurl) ? "" : " data-savepage-href=\"" + origurl + "\"";

            startTag = startTag.replace(/ href="[^"]*"/,origstr + " href=\"" + newurl + "\"");
        }
    }
    else if (element.localName == "link" && (element.parentElement instanceof SVGElement))
    {
        /* Workaround for <link> element inside <svg> fragment which is invalid */

        startTag = "";
        endTag = "";
    }

    /* External location referenced in <a> or <area> element */
    /* Internal location referenced in <a> or <area> element */

    else if ((element.localName == "a" && element instanceof HTMLElement) || element.localName == "area")
    {
        if (element.getAttribute("href"))
        {
            baseuri = element.ownerDocument.baseURI;

            documenturi = element.ownerDocument.documentURI;

            origurl = element.getAttribute("href");

            newurl = adjustURL(origurl,baseuri,documenturi);

            if (newurl != origurl)
            {
                origstr = " data-savepage-href=\"" + origurl + "\"";

                startTag = startTag.replace(/ href="[^"]*"/,origstr + " href=\"" + newurl + "\"");
            }
        }
    }

    /* External image referenced in <body> element */

    else if (element.localName == "body")
    {
        if (element.getAttribute("background"))
        {
            if (replaceableResourceURL(element.background))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("background");

                datauri = replaceURL(origurl,baseuri,documenturi);

                origstr = (datauri == origurl) ? "" : " data-savepage-background=\"" + origurl + "\"";

                startTag = startTag.replace(/ background="[^"]*"/,origstr + " background=\"" + datauri + "\"");
            }
        }
    }

    /* External image referenced in <img> element - can be inside <picture> element */

    else if (element.localName == "img")
    {
        /* Remove src/srcset of images that have been hidden by the page, page editors or content blockers - so are not visible */

        if (removeElements)
        {
            if (crossframe)
            {
                /* In a cross-origin frame, the document created by DOMParser */
                /* does not have an associated frame window, which means that */
                /* the window.getComputedStyle() function cannot be called.   */

                /* Assume all images are visible */

                visible = true;
            }
            else if ((style = frame.getComputedStyle(element)) == null) visible = true;  /* should not happen */
            else visible = (style.getPropertyValue("visibility") != "hidden" && style.getPropertyValue("opacity") != "0");  /* element hidden */
        }
        else visible = true;

        if (!visible)
        {
            width = style.getPropertyValue("width");
            height = style.getPropertyValue("height");

            csstext = "/*savepage-remove*/ width: " + width + " !important; height: " + height + " !important;";

            if (element.hasAttribute("style"))
            {
                if (element.getAttribute("style").trim().substr(-1) != ";") separator = "; ";
                else separator = " ";

                startTag = startTag.replace(/ style="(?:\\"|[^"])*"/," style=\"" + element.getAttribute("style").replace(/"/g,"&quot;") + separator + csstext + "\"");
            }
            else startTag = startTag.replace(/<img/,"<img style=\"" + csstext + "\"");

            startTag = startTag.replace(/ src="[^"]*"/,"");

            startTag = startTag.replace(/ srcset="[^"]*"/,"");
        }
        else
        {
            /* currentSrc is set from src or srcset attributes on this <img> element */
            /* or from srcset attribute on <source> element inside <picture> element */

            /* Firefox - workaround because element.currentSrc may be empty string in cross-origin frames */

            currentsrc = (element.currentSrc != "") ? element.currentSrc : (element.getAttribute("src") ? element.src : "");

            /* Chrome - workaround because element.currentSrc may have wrong fragment identifier for SVG images */

            currentsrc = (element.currentSrc.indexOf("#") < 0) ? element.currentSrc : (element.getAttribute("src") ? element.src : "");

            if (currentsrc != "")  /* currentSrc set from src or srcset attribute */
            {
                    if (replaceableResourceURL(currentsrc))
                    {
                        baseuri = element.ownerDocument.baseURI;

                        documenturi = element.ownerDocument.documentURI;

                        origurl = element.getAttribute("src");

                        datauri = replaceURL(currentsrc,baseuri,documenturi);

                        origstr = (currentsrc == origurl) ? "" : " data-savepage-currentsrc=\"" + currentsrc + "\"";
                        origstr += " data-savepage-src=\"" + origurl + "\"";

                        if (element.hasAttribute("src")) startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                        else startTag = startTag.replace(/<img/,"<img" + origstr + " src=\"" + datauri + "\"");
                    }
                    else if (currentsrc.substr(0,5).toLowerCase() == "data:")  /* data uri */
                    {
                        origurl = element.getAttribute("src");

                        datauri = currentsrc;

                        origstr = (datauri == origurl) ? " " : " data-savepage-src=\"" + origurl + "\"";

                        if (element.hasAttribute("src")) startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                        else startTag = startTag.replace(/<img/,"<img" + origstr + " src=\"" + datauri + "\"");
                    }
                    else if (element.hasAttribute("data-savepage-blobdatauri") || currentsrc.substr(0,5) == "blob:")  /* blob url */
                    {
                        baseuri = element.ownerDocument.baseURI;

                        documenturi = element.ownerDocument.documentURI;

                        origurl = element.getAttribute("src");

                        if (element.hasAttribute("data-savepage-blobdatauri")) datauri = element.getAttribute("data-savepage-blobdatauri");
                        else datauri = createCanvasDataURL(currentsrc,baseuri,documenturi,element);

                        origstr = (currentsrc == origurl) ? "" : " data-savepage-currentsrc=\"" + currentsrc + "\"";
                        origstr += " data-savepage-src=\"" + origurl + "\"";

                        if (element.hasAttribute("src")) startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                        else startTag = startTag.replace(/<img/,"<img" + origstr + " src=\"" + datauri + "\"");

                        startTag = startTag.replace(/ data-savepage-blobdatauri="[^"]*"/,"");
                    }
            }

            if (element.getAttribute("srcset"))
            {
                /* Remove srcset URLs - currentSrc may be set to one of these URLs - other URls are unsaved */

                origurl = element.getAttribute("srcset");

                origstr = " data-savepage-srcset=\"" + origurl + "\"";

                startTag = startTag.replace(/ srcset="[^"]*"/,origstr + " srcset=\"\"");
            }
        }
    }

    /* External image referenced in <input> element */
    /* Reinstate checked state or text value of <input> element */

    else if (element.localName == "input")
    {
        if (element.type.toLowerCase() == "image" && element.getAttribute("src"))
        {
            if (replaceableResourceURL(element.src))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("src");

                datauri = replaceURL(origurl,baseuri,documenturi);

                origstr = (datauri == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
            }
        }

        if (element.type.toLowerCase() == "file" || element.type.toLowerCase() == "password")
        {
            /* maintain security */

            if (element.hasAttribute("value")) startTag = startTag.replace(/ value="[^"]*"/," value=\"\"");
            else startTag = startTag.replace(/>$/," value=\"\">");
        }
        else if (element.type.toLowerCase() == "checkbox" || element.type.toLowerCase() == "radio")
        {
            if (!element.checked) startTag = startTag.replace(/ checked="[^"]*"/,"");
            else if (!element.hasAttribute("checked")) startTag = startTag.replace(/>$/," checked=\"\">");
        }
        else
        {
            if (element.hasAttribute("value")) startTag = startTag.replace(/ value="[^"]*"/," value=\"" + element.value + "\"");
            else startTag = startTag.replace(/>$/," value=\"" + element.value + "\">");
        }
    }

    /* Reinstate text value of <textarea> element */

    else if (element.localName == "textarea")
    {
        textContent = element.value;
    }

    /* Reinstate selected state of <option> element */

    else if (element.localName == "option")
    {
        if (element.selected) startTag = startTag.replace(/ selected="[^"]*"/," selected=\"\"");
        else startTag = startTag.replace(/ selected="[^"]*"/,"");
    }

    /* Graphics drawn within <canvas> element */

    else if (element.localName == "canvas")
    {
        csstext = "background-attachment: scroll !important; " + "background-blend-mode: normal !important; " +
                  "background-clip: content-box !important; " + "background-color: transparent !important; " +
                  "background-origin: content-box !important; " + "background-position: center center !important; " +
                  "background-repeat: no-repeat !important; " + "background-size: 100% 100% !important;";

        if (element.hasAttribute("data-savepage-canvasdatauri"))  /* canvas data url */
        {
            datauri = element.getAttribute("data-savepage-canvasdatauri");

            csstext = "/*savepage-canvas-image*/ " + "background-image: url(" + datauri + ") !important; " + csstext;
        }
        else
        {
            try
            {
                    datauri = element.toDataURL("image/png","");

                    csstext = "/*savepage-canvas-image*/ " + "background-image: url(" + datauri + ") !important; " + csstext;
            }
            catch (e) { csstext = "/*savepage-canvas-dirty*/"; }
        }

        if (element.hasAttribute("style"))
        {
            if (element.getAttribute("style").trim().substr(-1) != ";") separator = "; ";
            else separator = " ";

            startTag = startTag.replace(/ style="(?:\\"|[^"])*"/," style=\"" + element.getAttribute("style").replace(/"/g,"&quot;") + separator + csstext + "\"");
        }
        else startTag = startTag.replace(/<canvas/,"<canvas style=\"" + csstext + "\"");
    }

    /* External audio referenced in <audio> element */

    else if (element.localName == "audio")
    {
        if (element.getAttribute("src"))
        {
            if (element.src == element.currentSrc)
            {
                if (replaceableResourceURL(element.src))
                {
                    baseuri = element.ownerDocument.baseURI;

                    documenturi = element.ownerDocument.documentURI;

                    origurl = element.getAttribute("src");

                    datauri = replaceURL(origurl,baseuri,documenturi);

                    origstr = (datauri == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                    startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                }
            }
            else  /* unsaved url */
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("src");

                newurl = unsavedURL(origurl,baseuri,documenturi);

                origstr = (newurl == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + newurl + "\"");
            }
        }
    }

    /* External video referenced in <video> element */

    else if (element.localName == "video")
    {
        if (element.getAttribute("src"))
        {
            if (element.src == element.currentSrc)
            {
                if (replaceableResourceURL(element.src))
                {
                    baseuri = element.ownerDocument.baseURI;

                    documenturi = element.ownerDocument.documentURI;

                    origurl = element.getAttribute("src");

                    datauri = replaceURL(origurl,baseuri,documenturi);

                    origstr = (datauri == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                    startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                }
            }
            else  /* unsaved url */
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("src");

                newurl = unsavedURL(origurl,baseuri,documenturi);

                origstr = (newurl == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + newurl + "\"");
            }
        }

        if (element.getAttribute("poster"))
        {
            if (replaceableResourceURL(element.poster))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("poster");

                datauri = replaceURL(origurl,baseuri,documenturi);

                origstr = (datauri == origurl) ? "" : " data-savepage-poster=\"" + origurl + "\"";

                startTag = startTag.replace(/ poster="[^"]*"/,origstr + " poster=\"" + datauri + "\"");
            }
        }
        else if (element.hasAttribute("data-savepage-blobdatauri") || element.src.substr(0,5) == "blob:")
        {
            baseuri = element.ownerDocument.baseURI;

            documenturi = element.ownerDocument.documentURI;

            origurl = element.getAttribute("src");

            if (element.hasAttribute("data-savepage-blobdatauri")) datauri = element.getAttribute("data-savepage-blobdatauri");
            else datauri = createCanvasDataURL(origurl,baseuri,documenturi,element);

            origstr = (datauri == origurl) ? "" : " data-savepage-poster=\"\"";

            startTag = startTag.replace(/<video/,"<video" + origstr + " poster=\"" + datauri + "\"");

            startTag = startTag.replace(/ data-savepage-blobdatauri="[^"]*"/,"");
        }
    }

    /* External audio/video/image referenced in <source> element */

    else if (element.localName == "source")
    {
        if (element.parentElement)
        {
            if (element.parentElement.localName == "audio" || element.parentElement.localName == "video")
            {
                if (element.getAttribute("src"))
                {
                    if (element.src == element.parentElement.currentSrc)
                    {
                        if (replaceableResourceURL(element.src))
                        {
                            baseuri = element.ownerDocument.baseURI;

                            documenturi = element.ownerDocument.documentURI;

                            origurl = element.getAttribute("src");

                            datauri = replaceURL(origurl,baseuri,documenturi);

                            origstr = (datauri == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                            startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                        }
                    }
                    else  /* unsaved url */
                    {
                        baseuri = element.ownerDocument.baseURI;

                        documenturi = element.ownerDocument.documentURI;

                        origurl = element.getAttribute("src");

                        newurl = unsavedURL(origurl,baseuri,documenturi);

                        origstr = (newurl == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                        startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + newurl + "\"");
                    }
                }
            }
            else if (element.parentElement.localName == "picture")
            {
                /* Remove srcset URLs - currentSrc may be set to one of these URLs - other URls are unsaved */

                if (element.getAttribute("srcset"))
                {
                    origurl = element.getAttribute("srcset");

                    origstr = " data-savepage-srcset=\"" + origurl + "\"";

                    startTag = startTag.replace(/ srcset="[^"]*"/,origstr + " srcset=\"\"");
                }
            }
        }
    }

    /* External subtitles referenced in <track> element */

    else if (element.localName == "track")
    {
        if (element.getAttribute("src"))
        {
            if (replaceableResourceURL(element.src))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("src");

                datauri = replaceURL(origurl,baseuri,documenturi);

                origstr = (datauri == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
            }
        }
    }

    /* External data referenced in <object> element */

    else if (element.localName == "object")
    {
        if (element.getAttribute("data"))
        {
            if (replaceableResourceURL(element.data))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("data");

                datauri = replaceURL(origurl,baseuri,documenturi);

                origstr = (datauri == origurl) ? "" : " data-savepage-data=\"" + origurl + "\"";

                startTag = startTag.replace(/ data="[^"]*"/,origstr + " data=\"" + datauri + "\"");
            }
        }
    }

    /* External data referenced in <embed> element */

    else if (element.localName == "embed")
    {
        if (element.getAttribute("src"))
        {
            if (replaceableResourceURL(element.src))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                origurl = element.getAttribute("src");

                datauri = replaceURL(origurl,baseuri,documenturi);

                origstr = (datauri == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
            }
        }
    }

    /* SVG - External location referenced in <a> element */
    /* SVG - Internal location referenced in <a> element */

    else if (element.localName == "a" && element instanceof SVGElement)
    {
        if (element.getAttribute("href") || element.getAttribute("xlink:href"))
        {
            baseuri = element.ownerDocument.baseURI;

            documenturi = element.ownerDocument.documentURI;

            origurl = element.getAttribute("href") || element.getAttribute("xlink:href");

            newurl = adjustURL(origurl,baseuri,documenturi);

            if (newurl != origurl)
            {
                origstr = " data-savepage-href=\"" + origurl + "\"";

                startTag = startTag.replace(/ (?:href|xlink:href)="[^"]*"/,origstr + " href=\"" + newurl + "\"");
            }
        }
    }

    /* SVG - External <symbol> element referenced in <use> element */
    /* SVG - Internal <symbol> element referenced in <use> element */

    else if (element.localName == "use" && element instanceof SVGElement)
    {
        if (element.getAttribute("href") || element.getAttribute("xlink:href"))
        {
            baseuri = element.ownerDocument.baseURI;

            documenturi = element.ownerDocument.documentURI;

            origurl = element.getAttribute("href") || element.getAttribute("xlink:href");

            newurl = adjustURL(origurl,baseuri,documenturi);

            if (newurl.substr(0,1) != "#")  /* not fragment only */
            {
                if (replaceableResourceURL(element.href.baseVal))
                {
                    svgstr = retrieveContent(origurl,baseuri);

                    parser = new DOMParser();
                    svgdoc = parser.parseFromString(svgstr,"text/html");

                    if (element.href.baseVal.indexOf("#") >= 0)  /* SVG 1.1 & SVG 2 - fragment - insert fragment element and descendants */
                    {
                        svgfragid = element.href.baseVal.substr(element.href.baseVal.indexOf("#")+1);
                        svgelement = svgdoc.getElementById(svgfragid);
                        svghref = (svgelement && svgelement.localName == "symbol") ? "#" + svgfragid : "";
                    }
                    else
                    {
                        svgelement = svgdoc.body.children[0];  /* SVG 2 - no fragment - insert root <svg> element and descendants */
                        svghref = "";
                    }

                    if (svgelement)
                    {
                        origstr = " data-savepage-href=\"" + origurl + "\"";

                        startTag = startTag.replace(/ (?:href|xlink:href)="[^"]*"/,origstr + " href=\"" + svghref + "\"");

                        endTag = endTag.replace(/>/,"><!--savepage-symbol-insert-->" + svgelement.outerHTML);
                    }
                }
            }
            else  /* fragment only */
            {
                if (newurl != origurl)
                {
                    origstr = " data-savepage-href=\"" + origurl + "\"";

                    startTag = startTag.replace(/ (?:href|xlink:href)="[^"]*"/,origstr + " href=\"" + newurl + "\"");
                }
            }
        }
    }

    /* SVG - External resource referenced in other SVG elements */
    /* SVG - Internal resource referenced in other SVG elements */

    else if (hrefSVGElements.indexOf(element.localName) >= 0 && element instanceof SVGElement)
    {
        if (element.getAttribute("href") || element.getAttribute("xlink:href"))
        {
            baseuri = element.ownerDocument.baseURI;

            documenturi = element.ownerDocument.documentURI;

            origurl = element.getAttribute("href") || element.getAttribute("xlink:href");

            newurl = adjustURL(origurl,baseuri,documenturi);

            if (newurl.substr(0,1) != "#")  /* not fragment only */
            {
                if (replaceableResourceURL(element.href.baseVal))
                {
                    datauri = replaceURL(origurl,baseuri,documenturi);

                    origstr = (datauri == origurl) ? "" : " data-savepage-href=\"" + origurl + "\"";

                    startTag = startTag.replace(/ (?:href|xlink:href)="[^"]*"/,origstr + " href=\"" + datauri + "\"");
                }
            }
            else  /* fragment only */
            {
                if (newurl != origurl)
                {
                    origstr = " data-savepage-href=\"" + origurl + "\"";

                    startTag = startTag.replace(/ (?:href|xlink:href)="[^"]*"/,origstr + " href=\"" + newurl + "\"");
                }
            }
        }
    }

    /* Handle nested frames and child elements & text nodes & comment nodes */
    /* Generate HTML into array of strings */

    if (element.localName == "iframe")  /* iframe elements */
    {
        if (pageType == 0)
        {
            if (depth < maxFrameDepth)
            {
                nosrcframe = nosrcframe || (!element.getAttribute("src") && !element.getAttribute("srcdoc"));

                subframekey = element.getAttribute("data-savepage-key");

                try
                {
                    if (element.contentDocument.documentElement != null)  /* in case web page not fully loaded before extracting */
                    {
                        startindex = htmlStrings.length;

                        // Scrapyard //////////////////////////////////////////////////////////////////
                        await extractHTML(depth+1,element.contentWindow,element.contentDocument.documentElement,crossframe,nosrcframe,subframekey,preserve,indent+2);
                        ////////////////////////////////////////////////////////////////// Scrapyard //

                        endindex = htmlStrings.length;

                        htmltext = "";

                        for (j = startindex; j < endindex; j++)
                        {
                            htmltext += htmlStrings[j];
                            htmlStrings[j] = "";
                        }

                        // Scrapyard //////////////////////////////////////////////////////////////////
                        if (saveUnpacked && element.hasAttribute("src"))
                            await saveFrame(`frame_${frameCounter++}.html`, true);
                        else {
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                        htmltext = htmltext.replace(/&/g,"&amp;");
                        htmltext = htmltext.replace(/"/g,"&quot;");

                        if (pageType == 0 && formatHTML && depth == 0)
                        {
                            htmltext = htmltext.replace(/\n/g,newlineIndent(indent+2));
                            htmltext = newlineIndent(indent+2) + "<!--savepage-srcdoc-begin-->" + newlineIndent(indent+2) + htmltext;
                            htmltext += newlineIndent(indent+2) + "<!--savepage-srcdoc-end-->";
                        }

                        startTag = startTag.replace(/<iframe/,"<iframe data-savepage-sameorigin=\"\"");

                        if (element.hasAttribute("srcdoc"))
                        {
                            origsrcdoc = element.getAttribute("srcdoc");

                            origstr = " data-savepage-srcdoc=\"" + origsrcdoc + "\"";

                            startTag = startTag.replace(/ srcdoc="[^"]*"/,origstr + " srcdoc=\"" + htmltext + "\"");
                        }
                        else startTag = startTag.replace(/<iframe/,"<iframe srcdoc=\"" + htmltext + "\"");
                        // Scrapyard //////////////////////////////////////////////////////////////////
                        }
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                    }
                }
                catch (e)  /* attempting cross-domain web page access */
                {
                    if (retainCrossFrames)
                    {
                        for (i = 0; i < frameKey.length; i++)
                        {
                            if (frameKey[i] == subframekey) break;
                        }

                        if (i != frameKey.length)
                        {
                            parser = new DOMParser();
                            framedoc = parser.parseFromString(frameHTML[i],"text/html");

                            startindex = htmlStrings.length;
                            // Scrapyard //////////////////////////////////////////////////////////////////
                            await extractHTML(depth+1,null,framedoc.documentElement,true,nosrcframe,subframekey,preserve,indent+2);
                            ////////////////////////////////////////////////////////////////// Scrapyard //
                            endindex = htmlStrings.length;

                            htmltext = "";

                            for (j = startindex; j < endindex; j++)
                            {
                                htmltext += htmlStrings[j];
                                htmlStrings[j] = "";
                            }

                            // Scrapyard //////////////////////////////////////////////////////////////////
                            if (saveUnpacked && element.hasAttribute("src"))
                                await saveFrame(`frame_${frameCounter++}.html`, true, true);
                            else {
                            ////////////////////////////////////////////////////////////////// Scrapyard //
                            htmltext = htmltext.replace(/&/g,"&amp;");
                            htmltext = htmltext.replace(/"/g,"&quot;");

                            if (pageType == 0 && formatHTML && depth == 0)
                            {
                                htmltext = htmltext.replace(/\n/g,newlineIndent(indent+2));
                                htmltext = newlineIndent(indent+2) + "<!--savepage-srcdoc-begin-->" + newlineIndent(indent+2) + htmltext;
                                htmltext += newlineIndent(indent+2) + "<!--savepage-srcdoc-end-->";
                            }

                            startTag = startTag.replace(/<iframe/,"<iframe data-savepage-crossorigin=\"\"");

                            if (element.hasAttribute("srcdoc"))
                            {
                                origsrcdoc = element.getAttribute("srcdoc");

                                origstr = " data-savepage-srcdoc=\"" + origsrcdoc + "\"";

                                startTag = startTag.replace(/ srcdoc="[^"]*"/,origstr + " srcdoc=\"" + htmltext + "\"");
                            }
                            else startTag = startTag.replace(/<iframe/,"<iframe srcdoc=\"" + htmltext + "\"");

                            // Scrapyard //////////////////////////////////////////////////////////////////
                            // if (element.hasAttribute("sandbox"))  /* prevent scripts executing in cross-origin frames */
                            // {
                            //     origsandbox = element.getAttribute("sandbox");
                            //
                            //     origstr = " data-savepage-sandbox=\"" + origsandbox + "\"";
                            //
                            //     startTag = startTag.replace(/ sandbox="[^"]*"/,origstr + " sandbox=\"allow-scripts\"");
                            // }
                            // else startTag = startTag.replace(/<iframe/,"<iframe sandbox=\"allow-scripts\"");
                            }
                            ////////////////////////////////////////////////////////////////// Scrapyard //
                        }
                    }
                }
            }

            // Scrapyard //////////////////////////////////////////////////////////////////
            if (!saveUnpacked && element.hasAttribute("src"))
            ////////////////////////////////////////////////////////////////// Scrapyard //
            {
                origurl = element.getAttribute("src");

                origstr = " data-savepage-src=\"" + origurl + "\"";

                startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"\"");
            }

            if (pageType == 0 && formatHTML && depth == 0 && !inline && parentpreserve == 0) htmlStrings[htmlStrings.length] = newlineIndent(indent);
        }

        htmlStrings[htmlStrings.length] = startTag;
        htmlStrings[htmlStrings.length] = endTag;
    }
    else if (element.localName == "frame")  /* frame elements */
    {
        if (pageType == 0)
        {
            datauri = null;

            if (depth < maxFrameDepth)
            {
                nosrcframe = nosrcframe || !element.getAttribute("src");

                subframekey = element.getAttribute("data-savepage-key");

                try
                {
                    if (element.contentDocument.documentElement != null)  /* in case web page not fully loaded before extracting */
                    {
                        startindex = htmlStrings.length;
                        // Scrapyard //////////////////////////////////////////////////////////////////
                        await extractHTML(depth+1,element.contentWindow,element.contentDocument.documentElement,crossframe,nosrcframe,subframekey,preserve,indent+2);
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                        endindex = htmlStrings.length;

                        htmltext = "";

                        for (j = startindex; j < endindex; j++)
                        {
                            htmltext += htmlStrings[j];
                            htmlStrings[j] = "";
                        }

                        // Scrapyard //////////////////////////////////////////////////////////////////
                        if (saveUnpacked && element.hasAttribute("src"))
                            await saveFrame(`frame_${frameCounter++}.html`, true);
                        else {
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                        datauri = "data:text/html;charset=utf-8," + encodeURIComponent(htmltext);

                        startTag = startTag.replace(/<frame/,"<frame data-savepage-sameorigin=\"\"");

                        if (element.hasAttribute("src"))
                        {
                            origurl = element.getAttribute("src");

                            origstr = " data-savepage-src=\"" + origurl + "\"";

                            startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                        }
                        else startTag = startTag.replace(/<frame/,"<frame src=\"" + datauri + "\"");
                        // Scrapyard //////////////////////////////////////////////////////////////////
                        }
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                    }
                }
                catch (e)  /* attempting cross-domain web page access */
                {
                    if (retainCrossFrames)
                    {
                        for (i = 0; i < frameKey.length; i++)
                        {
                            if (frameKey[i] == subframekey) break;
                        }

                        if (i != frameKey.length)
                        {
                            parser = new DOMParser();
                            framedoc = parser.parseFromString(frameHTML[i],"text/html");

                            startindex = htmlStrings.length;
                            // Scrapyard //////////////////////////////////////////////////////////////////
                            await extractHTML(depth+1,null,framedoc.documentElement,true,nosrcframe,subframekey,preserve,indent+2);
                            ////////////////////////////////////////////////////////////////// Scrapyard //
                            endindex = htmlStrings.length;

                            htmltext = "";

                            for (j = startindex; j < endindex; j++)
                            {
                                htmltext += htmlStrings[j];
                                htmlStrings[j] = "";
                            }

                            // Scrapyard //////////////////////////////////////////////////////////////////
                            if (saveUnpacked && element.hasAttribute("src"))
                                await saveFrame(`frame_${frameCounter++}.html`, true);
                            else {
                            ////////////////////////////////////////////////////////////////// Scrapyard //
                            datauri = "data:text/html;charset=utf-8," + encodeURIComponent(htmltext);

                            startTag = startTag.replace(/<frame/,"<frame data-savepage-crossorigin=\"\"");

                            if (element.hasAttribute("src"))
                            {
                                origurl = element.getAttribute("src");

                                origstr = " data-savepage-src=\"" + origurl + "\"";

                                startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + datauri + "\"");
                            }
                            else startTag = startTag.replace(/<frame/,"<frame src=\"" + datauri + "\"");
                            // Scrapyard //////////////////////////////////////////////////////////////////
                            }
                            ////////////////////////////////////////////////////////////////// Scrapyard //
                        }
                    }
                }
            }

            if (datauri == null)
            {
                if (element.getAttribute("src"))  /* unsaved url */
                {
                    baseuri = element.ownerDocument.baseURI;

                    documenturi = element.ownerDocument.documentURI;

                    origurl = element.getAttribute("src");

                    newurl = unsavedURL(origurl,baseuri,documenturi);

                    origstr = (newurl == origurl) ? "" : " data-savepage-src=\"" + origurl + "\"";

                    startTag = startTag.replace(/ src="[^"]*"/,origstr + " src=\"" + newurl + "\"");
                }
            }

            if (pageType == 0 && formatHTML && depth == 0 && !inline && parentpreserve == 0) htmlStrings[htmlStrings.length] = newlineIndent(indent);
        }

        htmlStrings[htmlStrings.length] = startTag;
    }
    else
    {
        if (element.localName == "html")
        {
            /* Add !DOCTYPE declaration */

            doctype = element.ownerDocument.doctype;

            if (doctype != null)
            {
                htmltext = '<!DOCTYPE ' + doctype.name + (doctype.publicId ? ' PUBLIC "' + doctype.publicId + '"' : '') +
                  /* SY */ ((doctype.systemId && !doctype.publicId) ? ' SYSTEM' : '') + (doctype.systemId ? ' "' + doctype.systemId + '"' : '') + '>\n';

                htmlStrings[htmlStrings.length] = htmltext;
            }

            htmlStrings[htmlStrings.length] = startTag;
        }
        else if (element.localName == "head")
        {
            if (formatHTML && depth == 0) htmlStrings[htmlStrings.length] = newlineIndent(indent);
            htmlStrings[htmlStrings.length] = startTag;

            prefix = (formatHTML && depth == 0) ? "\n    " : "\n";

            // Scrapyard //////////////////////////////////////////////////////////////////
            htmltext = prefix + `<meta charset="utf-8">`;
            htmlStrings[htmlStrings.length] = htmltext;

            // Undo style alterations made by Chrome
            // currently disabled since it changes look of some pages and is required only for the IDB storage mode on Chrome
            // htmltext = prefix + `<style>body {font-family: initial; font-size: initial;}</style>`;
            // htmlStrings[htmlStrings.length] = htmltext;
            ////////////////////////////////////////////////////////////////// Scrapyard //

            /* Add first favicon from document head or if none add favicon from website root */

            if (depth == 0 && (firstIconLocation != "" || rootIconLocation != ""))
            {
                baseuri = element.ownerDocument.baseURI;

                documenturi = element.ownerDocument.documentURI;

                location = (firstIconLocation != "") ? firstIconLocation : rootIconLocation;

                datauri = replaceURL(location,baseuri,documenturi);

                htmltext = prefix + "<link rel=\"icon\" data-savepage-href=\"" + location + "\" href=\"" + datauri + "\">";

                htmlStrings[htmlStrings.length] = htmltext;
            }
        }
        else if (startTag != "")
        {
            if (pageType == 0 && formatHTML && depth == 0 && !inline && parentpreserve == 0) htmlStrings[htmlStrings.length] = newlineIndent(indent);
            htmlStrings[htmlStrings.length] = startTag;
        }

        if (element.localName == "style" ||  /* <style> element */
            element.localName == "script" ||  /* <script> element */
            (element.localName == "link" && !(element.parentElement instanceof SVGElement) &&  /* <link> is invalid inside <svg> */
             element.rel.toLowerCase().indexOf("stylesheet") >= 0 && element.getAttribute("href")))  /* <link rel="stylesheet" href="..."> element */
        {
            if (formatHTML && depth == 0)
            {
                textContent = textContent.trim();
                if (pageType == 0) textContent = textContent.replace(/\n/g,newlineIndent(indent+2));
                if (textContent != "") textContent = newlineIndent(indent+2) + textContent;
                textContent += newlineIndent(indent);
            }

            htmlStrings[htmlStrings.length] = textContent;
        }
        else if (element.localName == "textarea")  /* <textarea> element */
        {
            textContent = textContent.replace(/&/g,"&amp;");
            textContent = textContent.replace(/</g,"&lt;");
            textContent = textContent.replace(/>/g,"&gt;");

            htmlStrings[htmlStrings.length] = textContent;
        }
        else if (voidElements.indexOf(element.localName) >= 0) ;  /* void element */
        else
        {
            /* Handle shadow child nodes */

            if (isFirefox) shadowroot = element.shadowRoot || element.openOrClosedShadowRoot;
            else shadowroot = element.shadowRoot || ((chrome.dom && element instanceof HTMLElement) ? chrome.dom.openOrClosedShadowRoot(element) : null);

            if (shadowroot != null)
            {
                if (shadowElements.indexOf(element.localName) < 0)  /* ignore elements with built-in Shadow DOM */
                {
                    if (pageType == 0 && formatHTML && depth == 0)
                    {
                        htmlStrings[htmlStrings.length] = newlineIndent(indent);
                        indent += 2;
                    }

                    htmlStrings[htmlStrings.length] = "<template data-savepage-shadowroot=\"\">";

                    for (i = 0; i < shadowroot.childNodes.length; i++)
                    {
                        if (shadowroot.childNodes[i] != null)  /* in case web page not fully loaded before extracting */
                        {
                            if (shadowroot.childNodes[i].nodeType == 1)  /* element node */
                            { // Scrapyard //////////////////////////////////////////////////////////////////
                                await extractHTML(depth,frame,shadowroot.childNodes[i],crossframe,nosrcframe,framekey,preserve,indent+2);
                            } ////////////////////////////////////////////////////////////////// Scrapyard //
                            else if (shadowroot.childNodes[i].nodeType == 3)  /* text node */
                            {
                                text = shadowroot.childNodes[i].textContent;

                                if (shadowroot.localName != "noscript")
                                {
                                    text = text.replace(/&/g,"&amp;");
                                    text = text.replace(/</g,"&lt;");
                                    text = text.replace(/>/g,"&gt;");
                                }

                                if (pageType == 0 && formatHTML && depth == 0)
                                {
                                    /* HTML whitespace == HTML space characters == spaces + newlines */
                                    /* HTML spaces: space (U+0020), tab (U+0009), form feed (U+000C) */
                                    /* HTML newlines: line feed (U+000A) or carriage return (U+000D) */

                                    if (preserve == 0) text = text.replace(/[\u0020\u0009\u000C\u000A\u000D]+/g," ");
                                    else if (preserve == 1) text = text.replace(/[\u0020\u0009\u000C]+/g," ");
                                }

                                htmlStrings[htmlStrings.length] = text;
                            }
                            else if (shadowroot.childNodes[i].nodeType == 8)  /* comment node */
                            {
                                text = shadowroot.childNodes[i].textContent;

                                if (pageType == 0 && formatHTML && depth == 0 && !inline && preserve == 0)
                                {
                                    text = text.replace(/\n/g,newlineIndent(indent+2));

                                    htmlStrings[htmlStrings.length] = newlineIndent(indent+2);
                                }

                                htmlStrings[htmlStrings.length] = "<!--" + text + "-->";
                            }
                        }
                    }

                    if (pageType == 0 && formatHTML && depth == 0)
                    {
                        indent -= 2;
                        htmlStrings[htmlStrings.length] = newlineIndent(indent);
                    }

                    htmlStrings[htmlStrings.length] = "</template>";
                }
            }

            /* Handle normal child nodes */

            for (i = 0; i < element.childNodes.length; i++)
            {
                if (element.childNodes[i] != null)  /* in case web page not fully loaded before extracting */
                {
                    if (element.childNodes[i].nodeType == 1)  /* element node */
                    {
                        if (depth == 0)
                        {
                            if (element.childNodes[i].localName == "script" && element.childNodes[i].id.substr(0,8) == "savepage") continue;
                            if (element.childNodes[i].localName == "meta" && element.childNodes[i].name.substr(0,8) == "savepage") continue;
                        }

                        /* Handle other element nodes */
                        // Scrapyard //////////////////////////////////////////////////////////////////
                        await extractHTML(depth,frame,element.childNodes[i],crossframe,nosrcframe,framekey,preserve,indent+2);
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                    }
                    else if (element.childNodes[i].nodeType == 3)  /* text node */
                    {
                        text = element.childNodes[i].textContent;

                        /* Skip text nodes before skipped elements/comments and at end of <head>/<body> elements */

                        if (pageType > 0 && formatHTML && depth == 0)
                        {
                            if (text.trim() == "" && (i+1) < element.childNodes.length && element.childNodes[i+1].nodeType == 1)
                            {
                                if (element.childNodes[i+1].localName == "base") continue;
                                if (element.childNodes[i+1].localName == "script" && element.childNodes[i+1].id.substr(0,8) == "savepage") continue;
                                if (element.childNodes[i+1].localName == "meta" && element.childNodes[i+1].name.substr(0,8) == "savepage") continue;
                            }

                            if (text.trim() == "" && (i+1) < element.childNodes.length && element.childNodes[i+1].nodeType == 8)
                            {
                                if (element.childNodes[i+1].textContent.indexOf("SAVE PAGE WE") >= 0) continue;
                            }

                            if (text.trim() == "" && i == element.childNodes.length-1)
                            {
                                if (element.localName == "head") continue;
                                if (element.localName == "body") continue;
                            }
                        }

                        /* Handle other text nodes */

                        if (element.localName != "noscript")
                        {
                            text = text.replace(/&/g,"&amp;");
                            text = text.replace(/</g,"&lt;");
                            text = text.replace(/>/g,"&gt;");
                        }

                        if (pageType == 0 && formatHTML && depth == 0)
                        {
                            /* HTML whitespace == HTML space characters == spaces + newlines */
                            /* HTML spaces: space (U+0020), tab (U+0009), form feed (U+000C) */
                            /* HTML newlines: line feed (U+000A) or carriage return (U+000D) */

                            if (preserve == 0) text = text.replace(/[\u0020\u0009\u000C\u000A\u000D]+/g," ");
                            else if (preserve == 1) text = text.replace(/[\u0020\u0009\u000C]+/g," ");
                        }

                        htmlStrings[htmlStrings.length] = text;
                    }
                    else if (element.childNodes[i].nodeType == 8)  /* comment node */
                    {
                        text = element.childNodes[i].textContent;

                        /* Skip existing Save Page WE metrics and resource summary comment */

                        if (text.indexOf("SAVE PAGE WE") >= 0) continue;

                        /* Handle other comment nodes */

                        if (pageType == 0 && formatHTML && depth == 0 && !inline && preserve == 0)
                        {
                            text = text.replace(/\n/g,newlineIndent(indent+2));

                            htmlStrings[htmlStrings.length] = newlineIndent(indent+2);
                        }

                        htmlStrings[htmlStrings.length] = "<!--" + text + "-->";
                    }
                }
            }
        }

        if (element.localName == "html" || element.localName == "body")
        {
            if (formatHTML && depth == 0) htmlStrings[htmlStrings.length] = newlineIndent(indent);
            htmlStrings[htmlStrings.length] = endTag;
        }
        else if (element.localName == "head")
        {
            prefix = (formatHTML && depth == 0) ? "\n    " : "\n";

            /* Add <style> element containing CSS URL variables */

            if (pageType == 0 && mergeCSSImages)
            {
                htmltext = prefix + "<style id=\"savepage-cssvariables\">";
                htmltext += prefix + "  :root {";

                for (i = 0; i < resourceLocation.length; i++)
                {
                    if (resourceCSSFrameKeys[i][framekey] == true)
                    {
                        try { asciistring = btoa(resourceContent[i]); }
                        catch (e) { asciistring = ""; }  /* resource content not a binary string */

                        htmltext += prefix + "    --savepage-url-" + i + ": url(data:" + resourceMimeType[i] + ";base64," + asciistring + ");";   /* binary data encoded as Base64 ASCII string */
                    }
                }

                htmltext += prefix + "  }";
                htmltext += prefix + "</style>";

                htmlStrings[htmlStrings.length] = htmltext;
            }

            if (depth == 0)
            {
                /* Add shadow loader script */
                // Scrapyard //////////////////////////////////////////////////////////////////
                if (loadShadowDom) {
                    htmltext = prefix + "<script id=\"savepage-shadowloader\" type=\"application/javascript\">";
                    htmltext += prefix + "  \"use strict\";";
                    htmltext += prefix + "  window.addEventListener(\"DOMContentLoaded\",";
                    htmltext += prefix + "  function(event) {";
                    htmltext += prefix + "    savepage_ShadowLoader(" + maxFrameDepth + ");";
                    htmltext += prefix + "  },false);";
                    htmltext += prefix + "  " + shadowLoaderText;
                    htmltext += prefix + "</script>";

                    htmlStrings[htmlStrings.length] = htmltext;
                }
                /////////////////////////////////////////////////////////////////// Scrapyard /

                /* Add page info bar html, css and script */

                if (includeInfoBar)
                {
                    date = new Date();

                    pageurl = (pageType == 0) ? document.URL : document.querySelector("meta[name='savepage-url']").content;

                    pageInfoBarText = pageInfoBarText.replace(/%URL%/,pageurl);
                    pageInfoBarText = pageInfoBarText.replace(/%DECODED-URL%/,decodeURIComponent(pageurl).replace(/'/g,"\\'"));
                    pageInfoBarText = pageInfoBarText.replace(/%DATE%/,date.toDateString().substr(8,2) + " " + date.toDateString().substr(4,3) + " " + date.toDateString().substr(11,4));
                    pageInfoBarText = pageInfoBarText.replace(/%TIME%/,date.toTimeString().substr(0,8));

                    htmltext = prefix + "<script id=\"savepage-pageinfo-bar-insert\" type=\"text/javascript\">";
                    htmltext += prefix + "  \"use strict\";";
                    htmltext += prefix + "  window.addEventListener('load',function(event) {";
                    htmltext += prefix + "    var parser = new DOMParser();";
                    htmltext += prefix + "    var pageinfodoc = parser.parseFromString('" + pageInfoBarText + "','text/html');";
                    htmltext += prefix + "    var container = document.createElement('div');";
                    htmltext += prefix + "    container.setAttribute('id','savepage-pageinfo-bar-container');";
                    htmltext += prefix + "    document.documentElement.appendChild(container);";
                    htmltext += prefix + "    container.appendChild(pageinfodoc.getElementById('savepage-pageinfo-bar-style'));";
                    htmltext += prefix + "    container.appendChild(pageinfodoc.getElementById('savepage-pageinfo-bar-content'));";
                    htmltext += prefix + "    document.getElementById('savepage-pageinfo-bar-button').addEventListener('click',function(event) {";
                    htmltext += prefix + "      var container = document.getElementById('savepage-pageinfo-bar-container');";
                    htmltext += prefix + "      document.documentElement.removeChild(container);";
                    htmltext += prefix + "    },false);";
                    htmltext += prefix + "  },false);";
                    htmltext += prefix + "</script>";

                    htmlStrings[htmlStrings.length] = htmltext;
                }

                /* Add saved page information */

                date = new Date();
                datestr = date.toString();

                if ((pubelement = document.querySelector("meta[property='article:published_time'][content]")) != null) pubstr = pubelement.getAttribute("content");  /* Open Graph - ISO8601 */
                else if ((pubelement = document.querySelector("meta[property='datePublished'][content]")) != null) pubstr = pubelement.getAttribute("content");  /* Generic RDFa - ISO8601 */
                else if ((pubelement = document.querySelector("meta[itemprop='datePublished'][content]")) != null) pubstr = pubelement.getAttribute("content");  /* Microdata - ISO8601 */
                else if ((pubelement = document.querySelector("script[type='application/ld+json']")) != null)  /* JSON-LD - ISO8601 */
                {
                    pubmatches = pubelement.textContent.match(/"datePublished"\s*:\s*"([^"]*)"/);
                    pubstr = pubmatches ? pubmatches[1] : null;
                }
                else if ((pubelement = document.querySelector("time[datetime]")) != null) pubstr = pubelement.getAttribute("datetime");  /* HTML5 - ISO8601 and similar formats */
                else pubstr = null;

                try
                {
                    if (!pubstr) throw false;
                    pubmatches = pubstr.match(/(Z|(-|\+)\d\d:?\d\d)$/);
                    pubzone = pubmatches ? (pubmatches[1] == "Z" ? " GMT+0000" : " GMT" + pubmatches[1].replace(":","")) : "";  /* extract timezone */
                    pubstr = pubstr.replace(/(Z|(-|\+)\d\d:?\d\d)$/,"");  /* remove timezone */
                    pubdate = new Date(pubstr);
                    pubdatestr = pubdate.toString();
                    pubdatestr = pubdatestr.substr(0,24) + pubzone;
                }
                catch (e) { pubdatestr = "Unknown"; }

                if (savedItems == 0)
                {
                    state = "Basic Items;";
                }
                else if (savedItems == 1)
                {
                    state = "Standard Items;";
                }
                else if (savedItems == 2)
                {
                    state = "Custom Items;";
                    if (saveHTMLImagesAll) state += " HTML image files (all);";
                    if (saveHTMLAudioVideo) state += " HTML audio & video files;";
                    if (saveHTMLObjectEmbed) state += " HTML object & embed files;";
                    if (saveCSSImagesAll) state += " CSS image files (all);";
                    if (saveCSSFontsAll) state += " CSS font files (all);";
                    else if (saveCSSFontsWoff) state += " CSS font files (woff for any browser);";
                    if (saveScripts) state += " Scripts (in same-origin frames);";
                }

                if (retainCrossFrames) state += " Retain cross-origin frames;";
                if (mergeCSSImages) state += " Merge CSS images;";
                if (executeScripts) state += " Allow scripts to execute;";
                if (removeUnsavedURLs) state += " Remove unsaved URLs;";
                if (removeElements) state += " Remove hidden elements;";
                if (rehideElements) state += " Rehide hidden elements;";
                if (allowPassive) state += " Allow passive mixed content;";
                if (crossOrigin == 1) state += " Send referrer headers with origin and path;";

                if (loadLazyContent)
                {
                    state += " Load lazy content - ";
                    // Scrapyard //////////////////////////////////////////////////////////////////
                    if (lazyLoadType == 1) state += "scroll steps = " + lazyLoadScrollTime + "s;";
                    else if (lazyLoadType == 2) state += "shrink checks = " + lazyLoadShrinkTime + "s;";
                    ////////////////////////////////////////////////////////////////// Scrapyard //
                }

                if (loadLazyImages) state += " Load lazy images in existing content;";

                state += " Max frame depth = " + maxFrameDepth + ";";
                state += " Max resource size = " + maxResourceSize + "MB;";
                state += " Max resource time = " + maxResourceTime + "s;";

                pageurl = (pageType == 0) ? document.URL : document.querySelector("meta[name='savepage-url']").content;

                htmltext = prefix + "<meta name=\"savepage-url\" content=\"" + decodeURIComponent(pageurl) + "\">";
                htmltext += prefix + "<meta name=\"savepage-title\" content=\"" + document.title + "\">";
                htmltext += prefix + "<meta name=\"savepage-pubdate\" content=\"" + pubdatestr + "\">";
                htmltext += prefix + "<meta name=\"savepage-from\" content=\"" + decodeURIComponent(document.URL) + "\">";
                htmltext += prefix + "<meta name=\"savepage-date\" content=\"" + datestr + "\">";
                htmltext += prefix + "<meta name=\"savepage-state\" content=\"" + state + "\">";
                htmltext += prefix + "<meta name=\"savepage-version\" content=\"" + chrome.runtime.getManifest().version + "\">";
                // Scrapyard //////////////////////////////////////////////////////////////////
                //htmltext += prefix + "<meta name=\"savepage-comments\" content=\"" + enteredComments + "\">";
                ////////////////////////////////////////////////////////////////// Scrapyard //

                htmlStrings[htmlStrings.length] = htmltext;
            }

            htmlStrings[htmlStrings.length] = newlineIndent(indent);
            htmlStrings[htmlStrings.length] = endTag;
        }
        else if (endTag != "")
        {
            if (pageType == 0 && formatHTML && depth == 0 && !inline && preserve == 0 && element.children.length > 0)
            {
                htmlStrings[htmlStrings.length] = newlineIndent(indent);
            }

            htmlStrings[htmlStrings.length] = endTag;
        }
    }
}

function enumerateCSSInsetProperty(csstext)
{
    /* CSS inset property is supported by Firefox but not by Chrome */
    /* So enumerate inset property as top/right/bottom/left properties */

    csstext = csstext.replace(/[{;]\s*inset\s*:\s*([^\s]+)\s*;/gi,"top: $1; right: $1; bottom: $1; left: $1;");
    csstext = csstext.replace(/[{;]\s*inset\s*:\s*([^\s]+)\s+([^\s]+)\s*;/gi,"top: $1; right: $2; bottom: $1; left: $2;");
    csstext = csstext.replace(/[{;]\s*inset\s*:\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*;/gi,"top: $1; right: $2; bottom: $3; left: $2;");
    csstext = csstext.replace(/[{;]\s*inset\s*:\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*;/gi,"top: $1; right: $2; bottom: $3; left: $4;");

    return csstext;
}

function replaceCSSURLsInStyleSheet(csstext,baseuri,documenturi,importstack,framekey)
{
    var regex;
    var matches = new Array();

    /* @import url() or */
    /* @font-face rule with font url()'s or */
    /* image url() or */
    /* avoid matches inside double-quote strings or */
    /* avoid matches inside single-quote strings or */
    /* avoid matches inside comments */

    regex = new RegExp(/(?:( ?)@import\s*(?:url\(\s*)?((?:"[^"]+")|(?:'[^']+')|(?:[^\s);]+))(?:\s*\))?\s*;)|/.source +  /* p1 & p2 */
                       /(?:( ?)@font-face\s*({[^}]*}))|/.source +  /* p3 & p4 */
                       /(?:( ?)url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\))|/.source +  /* p5 & p6 */
                       /(?:"(?:\\"|[^"])*")|/.source +
                       /(?:'(?:\\'|[^'])*')|/.source +
                       /(?:\/\*(?:\*[^\/]|[^\*])*?\*\/)/.source,
                       "gi");

    csstext = csstext.replace(regex,_replaceCSSURLOrImportStyleSheet);

    return csstext;

    function _replaceCSSURLOrImportStyleSheet(match,p1,p2,p3,p4,p5,p6,offset,string)
    {
        var i,location,csstext,newurl,datauriorcssvar,origstr,urlorvar;

        if (match.trim().substr(0,7).toLowerCase() == "@import")  /* @import url() */
        {
            p2 = removeQuotes(p2);

            if (replaceableResourceURL(p2))
            {
                if (baseuri != null)
                {
                    location = resolveURL(p2,baseuri);

                    if (location != null)
                    {
                        location = removeFragment(location);

                        for (i = 0; i < resourceLocation.length; i++)
                            if (resourceLocation[i] == location && resourceStatus[i] == "success") break;

                        if (i < resourceLocation.length)  /* style sheet found */
                        {
                            if (importstack.indexOf(location) < 0)
                            {
                                importstack.push(location);

                                csstext = replaceCSSURLsInStyleSheet(resourceContent[i],resourceLocation[i],resourceLocation[i],importstack,framekey);

                                importstack.pop();

                                return p1 + "/*savepage-import-url=" + p2 + "*/" + p1 + csstext;
                            }
                        }
                    }
                }

                if (removeUnsavedURLs) return p1 + "/*savepage-import-url=" + p2 + "*/" + p1;
                else
                {
                    newurl = adjustURL(p2,baseuri,documenturi);

                    if (newurl != p2)
                    {
                        match = match.replace(p2,newurl);
                        match = match.replace(/(@import)/i,"/*savepage-import-url=" + p2 + "*/" + p1 + "$1");
                        return match;
                    }
                    else return match;  /* original @import rule */
                }
            }
        }
        else if (match.trim().substr(0,10).toLowerCase() == "@font-face")  /* @font-face rule */
        {
            match = match.replace(/font-display\s*:\s*([^\s;}]*)\s*;?/gi,"/*savepage-font-display=$1*/");  /* remove font-display to avoid Chrome using fallback font */

            regex = /( ?)url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;  /* font url() */

            return match.replace(regex,_replaceURL);

            function _replaceURL(match,p1,p2,offset,string)
            {
                var cssvar,datauri,origstr;

                p2 = removeQuotes(p2);

                if (replaceableResourceURL(p2))
                {
                    datauri = replaceURL(p2,baseuri,documenturi);

                    origstr = (datauri == p2) ? p1 : p1 + "/*savepage-url=" + p2 + "*/" + p1;

                    return origstr + "url(" + datauri + ")";
                }
                else return match;  /* unreplaceable - original font url() */
            }
        }
        else if (match.trim().substr(0,4).toLowerCase() == "url(")  /* image url() */
        {
            p6 = removeQuotes(p6);

            if (replaceableResourceURL(p6))
            {
                datauriorcssvar = replaceCSSImageURL(p6,baseuri,documenturi,framekey);

                origstr = (datauriorcssvar == p6) ? p5 : p5 + "/*savepage-url=" + p6 + "*/" + p5;

                urlorvar = (datauriorcssvar.substr(0,2) == "--") ? "var" : "url";

                return origstr + urlorvar + "(" + datauriorcssvar + ")";
            }
            else return match;  /* unreplaceable - original image url() */
        }
        else if (match.substr(0,1) == "\"") return match;  /* double-quote string */
        else if (match.substr(0,1) == "'") return match;  /* single-quote string */
        else if (match.substr(0,2) == "/*") return match;  /* comment */
    }
}

function replaceCSSImageURLs(csstext,baseuri,documenturi,framekey)
{
    var regex;

    regex = /( ?)url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;  /* image url() */

    csstext = csstext.replace(regex,_replaceCSSImageURL);

    return csstext;

    function _replaceCSSImageURL(match,p1,p2,offset,string)
    {
        var datauriorcssvar,origstr,urlorvar;

        p2 = removeQuotes(p2);

        if (replaceableResourceURL(p2))
        {
            datauriorcssvar = replaceCSSImageURL(p2,baseuri,documenturi,framekey);

            origstr = (datauriorcssvar == p2) ? p1 : p1 + "/*savepage-url=" + p2 + "*/" + p1;

            urlorvar = (datauriorcssvar.substr(0,2) == "--") ? "var" : "url";

            return origstr + urlorvar + "(" + datauriorcssvar + ")";
        }
        else return match;  /* unreplaceable - original image url() */
    }
}

function replaceCSSImageURL(url,baseuri,documenturi,framekey)
{
    var i,location,count,asciistring;

    if (pageType > 0) return url;  /* saved page - ignore new resources when re-saving */

    if (baseuri != null)
    {
        url = url.replace(/\\26 ?/g,"&");  /* remove CSS escape */
        url = url.replace(/\\3[Aa] ?/g,":");  /* remove CSS escape */
        url = url.replace(/\\3[Dd] ?/g,"=");  /* remove CSS escape */

        location = resolveURL(url,baseuri);

        if (location != null)
        {
            location = removeFragment(location);

            for (i = 0; i < resourceLocation.length; i++)
                if (resourceLocation[i] == location && resourceStatus[i] == "success") break;

            if (i < resourceLocation.length)
            {
                if (resourceCharSet[i] == "")  /* charset not defined - binary data */
                {
                    count = mergeCSSImages ? resourceRemembered[i]-resourceCSSRemembered[i]+Object.keys(resourceCSSFrameKeys[i]).length : resourceRemembered[i];

                    if (resourceContent[i].length*count <= maxResourceSize*1024*1024)  /* skip large and/or repeated resource */
                    {
                        if (mergeCSSImages)
                        {
                            if (resourceCSSFrameKeys[i][framekey] == true)
                            {
                                resourceReplaced[i]++;

                                return "--savepage-url-" + i;
                            }
                        }
                        else
                        {
                            resourceReplaced[i]++;

                            try { asciistring = btoa(resourceContent[i]); }
                            catch (e) { asciistring = ""; }  /* resource content not a binary string */

                            // Scrapyard //////////////////////////////////////////////////////////////////
                            if (saveUnpacked)
                                return resourceFileName[i]
                            else
                            ////////////////////////////////////////////////////////////////// Scrapyard //
                                return "data:" + resourceMimeType[i] + ";base64," + asciistring;  /* binary data encoded as Base64 ASCII string */
                        }
                    }
                }
            }
        }
    }

    return unsavedURL(url,baseuri,documenturi);  /* unsaved url */
}

function replaceURL(url,baseuri,documenturi)
{
    var i,location,fragment,count,asciistring;

    if (pageType > 0) return url;  /* saved page - ignore new resources when re-saving */

    if (baseuri != null)
    {
        location = resolveURL(url,baseuri);

        if (location != null)
        {
            i = location.indexOf("#");

            fragment = (i >= 0) ? location.substr(i) : "";

            location = removeFragment(location);

            for (i = 0; i < resourceLocation.length; i++)
                if (resourceLocation[i] == location && resourceStatus[i] == "success") break;

            if (i < resourceLocation.length)
            {
                if (resourceCharSet[i] == "")  /* charset not defined - binary data */
                {
                    count = resourceRemembered[i];

                    if (resourceContent[i].length*count <= maxResourceSize*1024*1024)  /* skip large and/or repeated resource */
                    {
                        resourceReplaced[i]++;

                        try { asciistring = btoa(resourceContent[i]); }
                        catch (e) { asciistring = ""; }  /* resource content not a binary string */

                        // Scrapyard //////////////////////////////////////////////////////////////////
                        if (saveUnpacked)
                            return resourceFileName[i];
                        else
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                            return "data:" + resourceMimeType[i] + ";base64," + asciistring  + fragment;  /* binary data encoded as Base64 ASCII string */
                    }
                }
                else  /* charset defined - character data */
                {
                    resourceReplaced[i]++;
                    // Scrapyard //////////////////////////////////////////////////////////////////
                    if (saveUnpacked)
                        return resourceFileName[i];
                    else
                    ////////////////////////////////////////////////////////////////// Scrapyard //
                        return "data:" + resourceMimeType[i] + ";charset=utf-8," + encodeURIComponent(resourceContent[i]) + fragment;  /* characters encoded as UTF-8 %escaped string */
                }
            }
        }
    }

    return unsavedURL(url,baseuri,documenturi);  /* unsaved url */
}

function retrieveContent(url,baseuri)
{
    var i,location;

    if (pageType > 0) return "";  /* saved page - ignore new resources when re-saving */

    if (baseuri != null)
    {
        location = resolveURL(url,baseuri);

        if (location != null)
        {
            location = removeFragment(location);

            for (i = 0; i < resourceLocation.length; i++)
                if (resourceLocation[i] == location && resourceStatus[i] == "success") break;

            if (i < resourceLocation.length)
            {
                if (resourceCharSet[i] != "")  /* charset defined - character data */
                {
                    resourceReplaced[i]++;

                    return resourceContent[i];
                }
            }
        }
    }

    return "";  /* empty string */
}

function adjustURL(url,baseuri,documenturi)
{
    var i,location;

    if (baseuri != null)
    {
        location = resolveURL(url,baseuri);

        if (location != null)
        {
            i = location.indexOf("#");

            if (i < 0)  /* without fragment */
            {
                return location;  /* same or different page - make absolute */
            }
            else  /* with fragment */
            {
                if (location.substr(0,i) == documenturi) return location.substr(i);  /* same page - make fragment only */
                else return location;  /* different page - make absolute */
            }
        }
    }

    return url;
}

function unsavedURL(url,baseuri,documenturi)
{
    if (removeUnsavedURLs) return "";  /* empty string */
    else return adjustURL(url,baseuri,documenturi);  /* original or adjusted url */
}

function createCanvasDataURL(url,baseuri,documenturi,element)
{
    var canvas,context;

    canvas = document.createElement("canvas");
    canvas.width = element.clientWidth;
    canvas.height = element.clientHeight;

    try
    {
        context = canvas.getContext("2d");
        context.drawImage(element,0,0,canvas.width,canvas.height);
        return canvas.toDataURL("image/png","");
    }
    catch (e) {}

    return unsavedURL(url,baseuri,documenturi);  /* unsaved url */
}

function swapScreenAndPrintDevices(csstext)
{
    var regex;

    regex = /@media[^{]*{/gi;  /* @media rule */

    csstext = csstext.replace(regex,_replaceDevice);

    return csstext;

    function _replaceDevice(match,offset,string)
    {
        match = match.replace(/screen/gi,"######");
        match = match.replace(/print/gi,"screen");
        match = match.replace(/######/gi,"print");

        return match;
    }
}

function newlineIndent(indent)
{
    var i,str;

    str = "\n";

    for (i = 0; i < indent; i++) str += " ";

    return str;
}

/************************************************************************/

/* View saved page information function */

function viewSavedPageInfo()
{
    var i,xhr,parser,pageinfodoc,container,metaurl,metatitle,metapubdate,metafrom,metadate,metastate,metaversion,metacomments;

    /* Load page info panel */

    xhr = new XMLHttpRequest();
    xhr.open("GET",chrome.runtime.getURL("pageinfo-panel.html"),true);
    xhr.onload = complete;
    xhr.send();

    function complete()
    {
        if (xhr.status == 200)
        {
            /* Parse page info document */

            parser = new DOMParser();
            pageinfodoc = parser.parseFromString(xhr.responseText,"text/html");

            /* Create container element */

            container = document.createElement("div");
            container.setAttribute("id","savepage-pageinfo-panel-container");
            document.documentElement.appendChild(container);

            /* Append page info elements */

            container.appendChild(pageinfodoc.getElementById("savepage-pageinfo-panel-overlay"));

            /* Add listeners for buttons */

            document.getElementById("savepage-pageinfo-panel-open").addEventListener("click",clickOpenURL,false);
            document.getElementById("savepage-pageinfo-panel-okay").addEventListener("click",clickOkay,false);

            /* Focus okay button */

            document.getElementById("savepage-pageinfo-panel-okay").focus();

            /* Populate page info contents */

            metaurl = document.querySelector("meta[name='savepage-url']").content;
            metatitle = document.querySelector("meta[name='savepage-title']").content;
            metapubdate = document.querySelector("meta[name='savepage-pubdate']").content;
            metafrom = document.querySelector("meta[name='savepage-from']").content;
            metadate = document.querySelector("meta[name='savepage-date']").content;
            metastate = document.querySelector("meta[name='savepage-state']").content;
            metaversion = document.querySelector("meta[name='savepage-version']").content;
            metacomments = "";

            if (metaversion > +"8.0") metacomments = document.querySelector("meta[name='savepage-comments']").content;  /* decodes HTML entities */

            if (metaversion < +"6.0") metastate = metastate.replace(/(.*) (Max frame depth = \d+; Max resource size = \d+MB;) (.*)/,"$1 $3 $2");
            if (metaversion < +"7.0") metastate = metastate.replace(/CSS fonts used;/,"\n - " + "$&");

            metastate = metastate.replace(/; /g,";\n");
            metastate = metastate.replace(/;/g,"");
            metastate = metastate.replace(/Custom Items/,"$&:");
            metastate = metastate.replace(/HTML image files \(all\)/," - " + "$&");
            metastate = metastate.replace(/HTML audio & video files/," - " + "$&");
            metastate = metastate.replace(/HTML object & embed files/," - " + "$&");
            metastate = metastate.replace(/CSS image files \(all\)/," - " + "$&");
            metastate = metastate.replace(/CSS font files \(all\)/," - " + "$&");
            metastate = metastate.replace(/CSS font files \(woff for any browser\)/," - " + "$&");
            metastate = metastate.replace(/Scripts \(in same-origin frames\)/," - " + "$&");

            if (document.querySelector("script[id='savepage-pageloader']") == null &&  /* Version 7.0-14.0 */
                document.querySelector("meta[name='savepage-resourceloader']") == null)  /* Version 15.0-15.1 */
            {
                metastate = metastate.replace(/Used page loader/,"$&" + " (Removed)");
                metastate = metastate.replace(/Used resource loader/,"$&" + " (Removed)");
            }

            metaversion = "Save Page WE " + metaversion;

            document.getElementById("savepage-pageinfo-panel-url").textContent = metaurl;
            document.getElementById("savepage-pageinfo-panel-title").textContent = metatitle;
            document.getElementById("savepage-pageinfo-panel-pubdate").textContent = metapubdate;
            document.getElementById("savepage-pageinfo-panel-from").textContent = metafrom;
            document.getElementById("savepage-pageinfo-panel-date").textContent = metadate;
            document.getElementById("savepage-pageinfo-panel-state").textContent = metastate;
            document.getElementById("savepage-pageinfo-panel-version").textContent = metaversion;
            document.getElementById("savepage-pageinfo-panel-comments").children[0].value = metacomments;
        }
    }

    function clickOpenURL()
    {
        window.open(metaurl);

        document.documentElement.removeChild(document.getElementById("savepage-pageinfo-panel-container"));

        window.setTimeout(function() { chrome.runtime.sendMessage({ type: "setSaveState", savestate: -2 }); },1000);
    }

    function clickOkay()
    {
        document.documentElement.removeChild(document.getElementById("savepage-pageinfo-panel-container"));

        window.setTimeout(function() { chrome.runtime.sendMessage({ type: "setSaveState", savestate: -2 }); },1000);
    }
}

/************************************************************************/

/* Remove Resource Loader function */

/* For pages saved using Version 7.0-15.1 */

function removeResourceLoader()
{
    var resourceBlobURL = new Array();
    var resourceMimeType = new Array();
    var resourceCharSet = new Array();
    var resourceContent = new Array();
    var resourceStatus = new Array();
    var resourceRemembered = new Array();

    var resourceCount;

    gatherBlobResources();

    /* First Pass - to gather blob resources */

    function gatherBlobResources()
    {
        chrome.runtime.sendMessage({ type: "setSaveState", savestate: 4 });

        findBlobResources(0,window,document.documentElement);

        loadBlobResources();
    }

    function findBlobResources(depth,frame,element)
    {
        var i,csstext,regex,shadowroot;
        var matches = new Array();

        if (element.hasAttribute("style"))
        {
            csstext = element.style.cssText;

            regex = /url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;

            while ((matches = regex.exec(csstext)) != null)
            {
                matches[1] = removeQuotes(matches[1]);

                if (matches[1].substr(0,5).toLowerCase() == "blob:")  /* blob url */
                {
                    rememberBlobURL(matches[1],"image/png","");
                }
            }
        }

        if (element.localName == "script")
        {
            /* src will be data uri - not replaced by blob url */
        }
        else if (element.localName == "style")
        {
            csstext = element.textContent;

            regex = /url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;

            while ((matches = regex.exec(csstext)) != null)
            {
                matches[1] = removeQuotes(matches[1]);

                if (matches[1].substr(0,5).toLowerCase() == "blob:")  /* blob url */
                {
                    rememberBlobURL(matches[1],"image/png","");
                }
            }
        }
        else if (element.localName == "link" && (element.rel.toLowerCase() == "icon" || element.rel.toLowerCase() == "shortcut icon"))
        {
            if (element.href.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.href,"image/vnd.microsoft.icon","");
        }
        else if (element.localName == "body")
        {
            if (element.background.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.background,"image/png","");
        }
        else if (element.localName == "img")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.src,"image/png","");
        }
        else if (element.localName == "input" && element.type.toLowerCase() == "image")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.src,"image/png","");
        }
        else if (element.localName == "audio")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.src,"audio/mpeg","");
        }
        else if (element.localName == "video")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.src,"video/mp4","");
            if (element.poster.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.poster,"image/png","");
        }
        else if (element.localName == "source")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:")
            {
                if (element.parentElement)
                {
                    if (element.parentElement.localName == "audio") rememberBlobURL(element.src,"audio/mpeg","");
                    else if (element.parentElement.localName == "video") rememberBlobURL(element.src,"video/mp4","");
                }
            }
        }
        else if (element.localName == "track")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.src,"text/vtt","utf-8");
        }
        else if (element.localName == "object")
        {
            if (element.data.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.data,"application/octet-stream","");
        }
        else if (element.localName == "embed")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.src,"application/octet-stream","");
        }

        /* Handle nested frames and child elements */

        if (element.localName == "iframe" || element.localName == "frame")  /* frame elements */
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") rememberBlobURL(element.src,"text/html","utf-8");

            if (depth < maxFrameDepth)
            {
                try
                {
                    if (element.contentDocument.documentElement != null)  /* in case web page not fully loaded before finding */
                    {
                        findBlobResources(depth+1,element.contentWindow,element.contentDocument.documentElement);
                    }
                }
                catch (e) {}  /* attempting cross-domain web page access */
            }
        }
        else
        {
            /* Handle shadow child elements */

            if (isFirefox) shadowroot = element.shadowRoot || element.openOrClosedShadowRoot;
            else shadowroot = element.shadowRoot || ((chrome.dom && element instanceof HTMLElement) ? chrome.dom.openOrClosedShadowRoot(element) : null);

            if (shadowroot != null)
            {
                if (shadowElements.indexOf(element.localName) < 0)  /* ignore elements with built-in Shadow DOM */
                {
                    for (i = 0; i < shadowroot.children.length; i++)
                        if (shadowroot.children[i] != null)  /* in case web page not fully loaded before finding */
                            findBlobResources(depth,frame,shadowroot.children[i]);
                }
            }

            /* Handle normal child elements */

            for (i = 0; i < element.children.length; i++)
                if (element.children[i] != null)  /* in case web page not fully loaded before finding */
                    findBlobResources(depth,frame,element.children[i]);
        }
    }

    function rememberBlobURL(bloburl,mimetype,charset)
    {
        var i;

        for (i = 0; i < resourceBlobURL.length; i++)
            if (resourceBlobURL[i] == bloburl) break;

        if (i == resourceBlobURL.length)  /* new blob */
        {
            resourceBlobURL[i] = bloburl;
            resourceMimeType[i] = mimetype;  /* default if load fails */
            resourceCharSet[i] = charset;  /* default if load fails */
            resourceContent[i] = "";  /* default if load fails */
            resourceStatus[i] = "pending";
            resourceRemembered[i] = 1;
        }
        else resourceRemembered[i]++;  /* repeated blob */
    }

    /* After first pass - load blob resources */

    function loadBlobResources()
    {
        var i,xhr;

        resourceCount = 0;

        for (i = 0; i < resourceBlobURL.length; i++)
        {
            if (resourceStatus[i] == "pending")
            {
                resourceCount++;

                try
                {
                    xhr = new XMLHttpRequest();

                    xhr.open("GET",resourceBlobURL[i],true);
                    xhr.responseType = "arraybuffer";
                    xhr.timeout = 1000;
                    xhr.onload = loadSuccess;
                    xhr.onerror = loadFailure;
                    xhr.ontimeout = loadFailure;
                    xhr._resourceIndex = i;

                    xhr.send();  /* throws exception if url is invalid */
                }
                catch (e)
                {
                    resourceStatus[i] = "failure";

                    --resourceCount;
                }
            }
        }

        if (resourceCount <= 0) checkDataResources();
    }

    function loadSuccess()
    {
        var i,binaryString,contenttype,mimetype,charset;
        var byteArray = new Uint8Array(this.response);
        var matches = new Array();

        if (this.status == 200)
        {
            binaryString = "";
            for (i = 0; i < byteArray.byteLength; i++) binaryString += String.fromCharCode(byteArray[i]);

            contenttype = this.getResponseHeader("Content-Type");
            if (contenttype == null) contenttype = "";

            matches = contenttype.match(/([^;]+)/i);
            if (matches != null) mimetype = matches[1].toLowerCase();
            else mimetype = "";

            // Scrapyard //////////////////////////////////////////////////////////////////
            matches = contenttype.match(/;\s*charset=([^;]+)/i);
            ////////////////////////////////////////////////////////////////// Scrapyard //
            if (matches != null) charset = matches[1].toLowerCase();
            else charset = "";

            switch (resourceMimeType[this._resourceIndex].toLowerCase())  /* expected MIME type */
            {
                case "image/png":  /* image file */
                case "image/vnd.microsoft.icon":  /* icon file */
                case "audio/mpeg":  /* audio file */
                case "video/mp4":  /* video file */
                case "application/octet-stream":  /* data file */

                    if (mimetype != "") resourceMimeType[this._resourceIndex] = mimetype;

                    resourceContent[this._resourceIndex] = binaryString;

                    break;

               case "text/vtt":  /* subtitles file */
               case "text/html":  /* iframe html file */

                    if (mimetype != "") resourceMimeType[this._resourceIndex] = mimetype;
                    if (charset != "") resourceCharSet[this._resourceIndex] = charset;

                    resourceContent[this._resourceIndex] = binaryString;

                    break;
            }

            resourceStatus[this._resourceIndex] = "success";
        }
        else resourceStatus[this._resourceIndex] = "failure";

        if (--resourceCount <= 0) checkDataResources();
    }

    function loadFailure()
    {
        resourceStatus[this._resourceIndex] = "failure";

        if (--resourceCount <= 0) checkDataResources();
    }

    /* After first pass - check data resources */

    function checkDataResources()
    {
        var i,dataurisize,skipcount,count;

        /* Check for large resource sizes */

        dataurisize = 0;
        skipcount = 0;

        for (i = 0; i < resourceBlobURL.length; i++)
        {
            if (resourceCharSet[i] == "")  /* charset not defined - binary data */
            {
                count = resourceRemembered[i];

                if (resourceContent[i].length*count > maxResourceSize*1024*1024) skipcount++;  /* skip large and/or repeated resource */
                else dataurisize += resourceContent[i].length*count*(4/3);  /* base64 expands by 4/3 */
            }
        }

        if (dataurisize > maxTotalSize*1024*1024)
        {
            showMessage("Cannot remove resource loader","Remove",
                        "Cannot remove resource loader because the total size of resources exceeds " + maxTotalSize + "MB.\n\n" +
                        "It may be possible to remove resource loader by trying this suggestion:\n\n" +
                        "    •  Reduce the 'Maximum size allowed for a resource' option value.",
                        null,
                        function savecancel()
                        {
                            chrome.runtime.sendMessage({ type: "setSaveState", savestate: -2 });
                        });
        }
        else if (showWarning)
        {
            if (skipcount > 0)
            {
                showMessage("Some resources exceed maximum size","Remove",
                            skipcount + " resources exceed maximum size and will be discarded.\n\n" +
                            "It may be possible to retain these resources by trying this suggestion:\n\n" +
                            "    •  Increase the 'Maximum size allowed for a resource' option value.",
                            function removecontinue()
                            {
                                substituteBlobResources();
                            },
                            function removecancel()
                            {
                                chrome.runtime.sendMessage({ type: "setSaveState", savestate: -2 });
                            });
            }
            else substituteBlobResources();
        }
        else substituteBlobResources();
    }

    /* Second Pass - to substitute blob URLs with data URI's */

    function substituteBlobResources()
    {
        var i,script,meta;

        /* Remove page loader script */  /* Version 7.0-14.0 */

        script = document.getElementById("savepage-pageloader");
        if (script != null) script.parentElement.removeChild(script);

        /* Remove resource loader meta element */  /* Version 15.0+ */

        meta = document.getElementsByName("savepage-resourceloader")[0];
        if (meta != null) meta.parentElement.removeChild(meta);

        /* Release blob memory allocation */

        for (i = 0; i < resourceBlobURL.length; i++)
            window.URL.revokeObjectURL(resourceBlobURL[i]);

        /* Replace blob URLs with data URI's */

        replaceBlobResources(0,window,document.documentElement);  /* replace blob urls with data uri's */

        pageType = 1;  /* saved page */

        chrome.runtime.sendMessage({ type: "setPageType", pagetype: pageType });

        window.setTimeout(function() { chrome.runtime.sendMessage({ type: "setSaveState", savestate: 7 }); },1000);
    }

    function replaceBlobResources(depth,frame,element)
    {
        var i,csstext,regex,shadowroot;

        if (element.hasAttribute("style"))
        {
            csstext = element.style.cssText;

            regex = /url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;

            element.style.cssText = csstext.replace(regex,replaceCSSBlobURL);
        }

        if (element.localName == "script")
        {
            /* src will be data uri - not replaced by blob url */
        }
        else if (element.localName == "style")
        {
            csstext = element.textContent;

            regex = /url\(\s*((?:"[^"]+")|(?:'[^']+')|(?:[^\s)]+))\s*\)/gi;

            element.textContent = csstext.replace(regex,replaceCSSBlobURL);
        }
        else if (element.localName == "link" && (element.rel.toLowerCase() == "icon" || element.rel.toLowerCase() == "shortcut icon"))
        {
            if (element.href.substr(0,5).toLowerCase() == "blob:") element.href = replaceBlobURL(element.href);
        }
        else if (element.localName == "body")
        {
            if (element.background.substr(0,5).toLowerCase() == "blob:") element.background = replaceBlobURL(element.background);
        }
        else if (element.localName == "img")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") element.src = replaceBlobURL(element.src);
        }
        else if (element.localName == "input" && element.type.toLowerCase() == "image")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") element.src = replaceBlobURL(element.src);
        }
        else if (element.localName == "audio")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:")
            {
                element.src = replaceBlobURL(element.src);
                element.load();
            }
        }
        else if (element.localName == "video")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:")
            {
                element.src = replaceBlobURL(element.src);
                element.load();
            }
            if (element.poster.substr(0,5).toLowerCase() == "blob:") element.poster = replaceBlobURL(element.poster);
        }
        else if (element.localName == "source")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:")
            {
                element.src = replaceBlobURL(element.src);
                if (element.parentElement) element.parentElement.load();
            }
        }
        else if (element.localName == "track")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") element.src = replaceBlobURL(element.src);
        }
        else if (element.localName == "object")
        {
            if (element.data.substr(0,5).toLowerCase() == "blob:") element.data = replaceBlobURL(element.data);
        }
        else if (element.localName == "embed")
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") element.src = replaceBlobURL(element.src);
        }

        /* Handle nested frames and child elements */

        if (element.localName == "iframe" || element.localName == "frame")  /* frame elements */
        {
            if (element.src.substr(0,5).toLowerCase() == "blob:") element.src = replaceBlobURL(element.src);

            if (depth < maxFrameDepth)
            {
                try
                {
                    if (element.contentDocument.documentElement != null)  /* in case web page not fully loaded before replacing */
                    {
                        replaceBlobResources(depth+1,element.contentWindow,element.contentDocument.documentElement);
                    }
                }
                catch (e) {}  /* attempting cross-domain web page access */
            }
        }
        else
        {
            /* Handle shadow child elements */

            if (isFirefox) shadowroot = element.shadowRoot || element.openOrClosedShadowRoot;
            else shadowroot = element.shadowRoot || ((chrome.dom && element instanceof HTMLElement) ? chrome.dom.openOrClosedShadowRoot(element) : null);

            if (shadowroot != null)
            {
                if (shadowElements.indexOf(element.localName) < 0)  /* ignore elements with built-in Shadow DOM */
                {
                    for (i = 0; i < shadowroot.children.length; i++)
                        if (shadowroot.children[i] != null)  /* in case web page not fully loaded before replacing */
                            replaceBlobResources(depth,frame,shadowroot.children[i]);
                }
            }

            /* Handle normal child elements */

            for (i = 0; i < element.children.length; i++)
                if (element.children[i] != null)  /* in case web page not fully loaded before replacing */
                    replaceBlobResources(depth,frame,element.children[i]);
        }
    }

    function replaceCSSBlobURL(match,p1,offset,string)
    {
        p1 = removeQuotes(p1);

        if (p1.substr(0,5).toLowerCase() == "blob:")  /* blob url */
        {
            return "url(" + replaceBlobURL(p1) + ")";
        }
        else return match;
    }

    function replaceBlobURL(bloburl)
    {
        var i,count,asciistring;

        for (i = 0; i < resourceBlobURL.length; i++)
            if (resourceBlobURL[i] == bloburl && resourceStatus[i] == "success") break;

        if (i < resourceBlobURL.length)
        {
            if (resourceCharSet[i] == "")  /* charset not defined - binary data */
            {
                count = resourceRemembered[i];

                if (resourceContent[i].length*count <= maxResourceSize*1024*1024)  /* skip large and/or repeated resource */
                {
                    try { asciistring = btoa(resourceContent[i]); }
                    catch (e) { asciistring = ""; }  /* resource content not a binary string */

                    return "data:" + resourceMimeType[i] + ";base64," + asciistring;  /* binary data encoded as Base64 ASCII string */
                }
            }
            else  /* charset defined - character data */
            {
                return "data:" + resourceMimeType[i] + ";charset=utf-8," + encodeURIComponent(resourceContent[i]);  /* characters encoded as UTF-8 %escaped string */
            }
        }

        return bloburl;
    }
}

/************************************************************************/

/* Extract saved page media (image/audio/video) function */

function extractSavedPageMedia()
{
    chrome.runtime.sendMessage({ type: "setSaveState", savestate: 5 });

    if (!extract(0,window,document.documentElement))
    {
        showMessage("Extract Image/Audio/Video failed","Extract","Image/Audio/Video element not found.",null,null);
    }

    window.setTimeout(function() { chrome.runtime.sendMessage({ type: "setSaveState", savestate: 8 }); },1000);

    function extract(depth,frame,element)
    {
        var i,baseuri,location,filename,link,shadowroot;

        if (element.localName == "img" || element.localName == "audio" || element.localName == "video" || element.localName == "source")
        {
            if (element.src == extractSrcUrl)  /* image/audio/video found */
            {
                baseuri = element.ownerDocument.baseURI;

                if (baseuri != null)
                {
                    location = resolveURL(element.getAttribute("data-savepage-src"),baseuri);

                    if (location != null)
                    {
                        filename = getSavedFileName(location,"",true);

                        link = document.createElement("a");
                        link.download = filename;
                        link.href = extractSrcUrl;

                        link.addEventListener("click",handleClick,true);

                        link.dispatchEvent(new MouseEvent("click"));  /* save image/audio/video as file */

                        link.removeEventListener("click",handleClick,true);

                        function handleClick(event)
                        {
                            event.stopPropagation();
                        }

                        return true;
                    }
                }
            }
        }

        /* Handle nested frames and child elements */

        if (element.localName == "iframe" || element.localName == "frame")  /* frame elements */
        {
            if (depth < maxFrameDepth)
            {
                try
                {
                    if (element.contentDocument.documentElement != null)  /* in case web page not fully loaded before extracting */
                    {
                        if (extract(depth+1,element.contentWindow,element.contentDocument.documentElement)) return true;
                    }
                }
                catch (e) {}  /* attempting cross-domain web page access */
            }
        }
        else
        {
            /* Handle shadow child elements */

            if (isFirefox) shadowroot = element.shadowRoot || element.openOrClosedShadowRoot;
            else shadowroot = element.shadowRoot || ((chrome.dom && element instanceof HTMLElement) ? chrome.dom.openOrClosedShadowRoot(element) : null);

            if (shadowroot != null)
            {
                if (shadowElements.indexOf(element.localName) < 0)  /* ignore elements with built-in Shadow DOM */
                {
                    for (i = 0; i < shadowroot.children.length; i++)
                        if (shadowroot.children[i] != null)  /* in case web page not fully loaded before extracting */
                            if (extract(depth,frame,shadowroot.children[i])) return true;
                }
            }

            /* Handle normal child elements */

            for (i = 0; i < element.children.length; i++)
                if (element.children[i] != null)  /* in case web page not fully loaded before extracting */
                    if (extract(depth,frame,element.children[i])) return true;
        }

        return false;
    }
}

/************************************************************************/

/* Save utility functions */

function showMessage(messagetitle,buttonsuffix,messagetext,continuefunction,cancelfunction)
{
    // Scrapyard //////////////////////////////////////////////////////////////////
    console.log(messagetext);
    ////////////////////////////////////////////////////////////////// Scrapyard //

    var xhr,parser,messagedoc,container;

    xhr = new XMLHttpRequest();
    xhr.open("GET",chrome.runtime.getURL("message-panel.html"),true);
    xhr.onload = complete;
    xhr.send();

    function complete()
    {
        if (xhr.status == 200)
        {
            /* Parse message document */

            parser = new DOMParser();
            messagedoc = parser.parseFromString(xhr.responseText,"text/html");

            /* Create container element */

            container = document.createElement("div");
            container.setAttribute("id","savepage-message-panel-container");
            document.documentElement.appendChild(container);

            /* Append message elements */

            container.appendChild(messagedoc.getElementById("savepage-message-panel-overlay"));

            /* Set title, button names and contents */

            document.getElementById("savepage-message-panel-header").textContent = messagetitle;
            document.getElementById("savepage-message-panel-continue").textContent = "Continue " + buttonsuffix;
            document.getElementById("savepage-message-panel-cancel").textContent = "Cancel " + buttonsuffix;
            document.getElementById("savepage-message-panel-text").textContent = messagetext;

            /* Add listeners for buttons */

            document.getElementById("savepage-message-panel-cancel").addEventListener("click",clickCancel,false);
            document.getElementById("savepage-message-panel-continue").addEventListener("click",clickContinue,false);

            /* Configure for one or two buttons */

            if (continuefunction != null)
            {
                /* Focus continue button */

                document.getElementById("savepage-message-panel-continue").focus();
            }
            else
            {
                /* Hide continue button */

                document.getElementById("savepage-message-panel-continue").style.setProperty("display","none","important");

                /* Focus cancel button */

                document.getElementById("savepage-message-panel-cancel").focus();
            }

            /* Select this tab */

            chrome.runtime.sendMessage({ type: "selectTab" });
        }
    }

    function clickContinue()
    {
        document.documentElement.removeChild(document.getElementById("savepage-message-panel-container"));

        continuefunction();
    }

    function clickCancel()
    {
        document.documentElement.removeChild(document.getElementById("savepage-message-panel-container"));

        cancelfunction();
    }
}

function removeQuotes(url)
{
    if (url.substr(0,1) == "\"" || url.substr(0,1) == "'") url = url.substr(1);

    if (url.substr(-1) == "\"" || url.substr(-1) == "'") url = url.substr(0,url.length-1);

    return url;
}

function replaceableResourceURL(url)
{
    /* Exclude data: urls, blob: urls, moz-extension: urls, fragment-only urls and empty urls */

    if (url.substr(0,5).toLowerCase() == "data:" || url.substr(0,5).toLowerCase() == "blob:" ||
        url.substr(0,14).toLowerCase() == "moz-extension:" || url.substr(0,1) == "#" || url == "") return false;

    return true;
}

function resolveURL(url,baseuri)
{
    var resolvedURL;

    try
    {
        resolvedURL = new URL(url,baseuri);
    }
    catch (e)
    {
        return null;  /* baseuri invalid or null */
    }

    return resolvedURL.href;
}

function removeFragment(url)
{
    var i;

    i = url.indexOf("#");

    if (i >= 0) return url.substr(0,i);

    return url;
}

function getSavedFileName(url,title,extract)
{
    var i,documentURL,host,hostw,path,pathw,file,filew,query,fragment,date,datestr,pubelement,pubstr,pubdate,pubdatestr,filename,regex,minlength;
    var pubmatches = new Array();
    var mediaextns = new Array( ".jpe",".jpg",".jpeg",".gif",".png",".bmp",".ico",".svg",".svgz",".tif",".tiff",".ai",".drw",".pct",".psp",".xcf",".psd",".raw",".webp",  /* Firefox image extensions */
                                ".aac",".aif",".flac",".iff",".m4a",".m4b",".mid",".midi",".mp3",".mpa",".mpc",".oga",".ogg",".ra",".ram",".snd",".wav",".wma",  /* Firefox audio extensions */
                                ".avi",".divx",".flv",".m4v",".mkv",".mov",".mp4",".mpeg",".mpg",".ogm",".ogv",".ogx",".rm",".rmvb",".smil",".webm",".wmv",".xvid");  /* Firefox video extensions */

    documentURL = new URL(url);

    host = documentURL.hostname;
    host = decodeURIComponent(host);
    host = sanitizeString(host);

    hostw = host.replace(/^www\./,"");

    path = documentURL.pathname;
    path = decodeURIComponent(path);
    path = sanitizeString(path);
    path = path.replace(/^\/|\/$/g,"");

    pathw = path.replace(/\.[^.\/]+$/,"");

    file = path.replace(/[^\/]*\//g,"");

    filew = file.replace(/\.[^.]+$/,"");

    query = documentURL.search.substr(1);

    fragment = documentURL.hash.substr(1);

    title = sanitizeString(title);
    title = title.trim();
    title = title.replace(/^\./,"_");
    if (title == "") title = file;

    date = new Date();
    datestr = new Date(date.getTime()-(date.getTimezoneOffset()*60000)).toISOString();

    if ((pubelement = document.querySelector("meta[property='article:published_time'][content]")) != null) pubstr = pubelement.getAttribute("content");  /* Open Graph - ISO8601 */
    else if ((pubelement = document.querySelector("meta[property='datePublished'][content]")) != null) pubstr = pubelement.getAttribute("content");  /* Generic RDFa - ISO8601 */
    else if ((pubelement = document.querySelector("meta[itemprop='datePublished'][content]")) != null) pubstr = pubelement.getAttribute("content");  /* Microdata - ISO8601 */
    else if ((pubelement = document.querySelector("script[type='application/ld+json']")) != null)  /* JSON-LD - ISO8601 */
    {
        pubmatches = pubelement.textContent.match(/"datePublished"\s*:\s*"([^"]*)"/);
        pubstr = pubmatches ? pubmatches[1] : null;
    }
    else if ((pubelement = document.querySelector("time[datetime]")) != null) pubstr = pubelement.getAttribute("datetime");  /* HTML5 - ISO8601 and similar formats */
    else pubstr = null;

    try
    {
        if (!pubstr) throw false;
        pubstr = pubstr.replace(/(Z|(-|\+)\d\d:?\d\d)$/,"");  /* remove timezone */
        pubdate = new Date(pubstr);
        pubdatestr = new Date(pubdate.getTime()-(pubdate.getTimezoneOffset()*60000)).toISOString();
    }
    catch (e) { pubdatestr = ""; }

    filename = savedFileName;

    regex = /(%TITLE%|%DATE\((.?)\)%|%TIME\((.?)\)%|%DATEP\((.?)\)%|%TIMEP\((.?)\)%|%DATEPF\((.?)\)%|%TIMEPF\((.?)\)%|%HOST%|%HOSTW%|%PATH%|%PATHW%|%FILE%|%FILEW%|%QUERY\(([^)]*)\)%|%FRAGMENT%)/g;

    minlength = filename.replace(regex,"").length;

    filename = filename.replace(regex,_replacePredefinedFields);

    function _replacePredefinedFields(match,p1,p2,p3,p4,p5,p6,p7,p8,offset,string)
    {
        var date,time,value;
        var params = new Object();

        if (p1 == "%TITLE%") return _truncateField(p1,title);
        else if (p1.substr(0,6) == "%DATE(" && p1.substr(-2) == ")%")
        {
            date = datestr.substr(0,10).replace(/-/g,p2);
            return _truncateField(p1,date);
        }
        else if (p1.substr(0,6) == "%TIME(" && p1.substr(-2) == ")%")
        {
            time = datestr.substr(11,8).replace(/:/g,p3);
            return _truncateField(p1,time);
        }
        else if (p1.substr(0,7) == "%DATEP(" && p1.substr(-2) == ")%")
        {
            date = pubdatestr.substr(0,10).replace(/-/g,p4);
            return _truncateField(p1,date);
        }
        else if (p1.substr(0,7) == "%TIMEP(" && p1.substr(-2) == ")%")
        {
            time = pubdatestr.substr(11,8).replace(/:/g,p5);
            return _truncateField(p1,time);
        }
        else if (p1.substr(0,8) == "%DATEPF(" && p1.substr(-2) == ")%")
        {
            date = (pubdatestr != "") ? pubdatestr.substr(0,10).replace(/-/g,p6) : datestr.substr(0,10).replace(/-/g,p6);
            return _truncateField(p1,date);
        }
        else if (p1.substr(0,8) == "%TIMEPF(" && p1.substr(-2) == ")%")
        {
            time = (pubdatestr != "") ? pubdatestr.substr(11,8).replace(/:/g,p7) : datestr.substr(11,8).replace(/:/g,p7);
            return _truncateField(p1,time);
        }
        else if (p1 == "%HOST%") return _truncateField(p1,host);
        else if (p1 == "%HOSTW%") return _truncateField(p1,hostw);
        else if (p1 == "%FILE%") return _truncateField(p1,file);
        else if (p1 == "%FILEW%") return _truncateField(p1,filew);
        else if (p1 == "%PATH%") return _truncateField(p1,path);
        else if (p1 == "%PATHW%") return _truncateField(p1,pathw);
        else if (p1.substr(0,7) == "%QUERY(" && p1.substr(-2) == ")%")
        {
            if (p8 == "") return _truncateField(p1,query);
            params = new URLSearchParams(query);
            value = params.get(p8);
            if (value == null) value = "";
            return _truncateField(p1,value);
        }
        else if (p1 == "%FRAGMENT%") return _truncateField(p1,fragment);
    }

    function _truncateField(field,repstr)
    {
        var maxextnlength = 6;

        if (repstr.length > maxFileNameLength-maxextnlength-minlength) repstr = repstr.substr(0,maxFileNameLength-maxextnlength-minlength);

        minlength += repstr.length;

        return repstr;
    }

    if (!extract)
    {
        if (filename == "") filename = "html";

        if (filename.substr(-4) != ".htm" && filename.substr(-5) != ".html" &&
            filename.substr(-6) != ".shtml" && filename.substr(-6) != ".xhtml") filename += ".html";  /* Firefox HTML extensions */
    }
    else
    {
        if (filename == "") filename = "media";

        for (i = 0; i < mediaextns.length; i++)
        {
            if (file.substr(-mediaextns[i].length) == mediaextns[i] &&
                filename.substr(-mediaextns[i].length) != mediaextns[i]) filename += mediaextns[i];
        }
    }

    filename = filename.replace(/(\\|\/|:|\*|\?|"|<|>|\|)/g,"_");

    if (replaceSpaces) filename = filename.replace(/\s/g,replaceChar);

    filename = filename.trim();

    return filename;
}

function sanitizeString(string)
{
    var i,charcode;

    /* Remove control characters: 0-31 and 255 */
    /* Remove other line break characters: 133, 8232, 8233 */
    /* Remove zero-width characters: 6158, 8203, 8204, 8205, 8288, 65279 */
    /* Change all space characters to normal spaces: 160, 5760, 8192-8202, 8239, 8287, 12288 */
    /* Change all hyphen characters to normal hyphens: 173, 1470, 6150, 8208-8213, 8315, 8331, 8722, 11834, 11835, 65112, 65123, 65293 */

    for (i = 0; i < string.length; i++)
    {
        charcode = string.charCodeAt(i);

        if (charcode <= 31 || charcode == 255 ||
            charcode == 133 || charcode == 8232 || charcode == 8233 ||
            charcode == 6158 || charcode == 8203 || charcode == 8204 || charcode == 8205 || charcode == 8288 || charcode == 65279)
        {
            string = string.substr(0,i) + string.substr(i+1);
        }

        if (charcode == 160 || charcode == 5760 || (charcode >= 8192 && charcode <= 8202) || charcode == 8239 || charcode == 8287 || charcode == 12288)
        {
            string = string.substr(0,i) + " " + string.substr(i+1);
        }

        if (charcode == 173 || charcode == 1470 || charcode == 6150 || (charcode >= 8208 && charcode <= 8213) ||
            charcode == 8315 || charcode == 8331 || charcode == 8722 || charcode == 11834 || charcode == 11835 ||
            charcode == 65112 || charcode == 65123 || charcode == 65293)
        {
            string = string.substr(0,i) + "-" + string.substr(i+1);
        }
    }

    return string;
}

/************************************************************************/
