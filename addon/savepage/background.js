/************************************************************************/
/*                                                                      */
/*      Save Page WE - Generic WebExtension - Background Page           */
/*                                                                      */
/*      Javascript for Background Page                                  */
/*                                                                      */
/*      Last Edit - 19 Apr 2022                                         */
/*                                                                      */
/*      Copyright (C) 2016-2022 DW-dev                                  */
/*                                                                      */
/*      Distributed under the GNU General Public License version 2      */
/*      See LICENCE.txt file and http://www.gnu.org/licenses/           */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Refer to Google Chrome developer documentation:                     */
/*                                                                      */
/*  https://developer.chrome.com/extensions/overview                    */
/*  https://developer.chrome.com/extensions/content_scripts             */
/*  https://developer.chrome.com/extensions/messaging                   */
/*  https://developer.chrome.com/extensions/xhr                         */
/*  https://developer.chrome.com/extensions/contentSecurityPolicy       */
/*                                                                      */
/*  https://developer.chrome.com/extensions/manifest                    */
/*  https://developer.chrome.com/extensions/declare_permissions         */
/*  https://developer.chrome.com/extensions/match_patterns              */
/*                                                                      */
/*  https://developer.chrome.com/extensions/browserAction               */
/*  https://developer.chrome.com/extensions/contextMenus                */
/*  https://developer.chrome.com/extensions/downloads                   */
/*  https://developer.chrome.com/extensions/notifications               */
/*  https://developer.chrome.com/extensions/runtime                     */
/*  https://developer.chrome.com/extensions/storage                     */
/*  https://developer.chrome.com/extensions/tabs                        */
/*                                                                      */
/*  Refer to IETF data uri and mime type documentation:                 */
/*                                                                      */
/*  RFC 2397 - https://tools.ietf.org/html/rfc2397                      */
/*  RFC 2045 - https://tools.ietf.org/html/rfc2045                      */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Notes on Save Page WE Operation                                     */
/*                                                                      */
/*  1. The basic approach is to identify all frames in the page and     */
/*     then traverse the DOM tree in three passes.                      */
/*                                                                      */
/*  2. The current states of the HTML elements are extracted from       */
/*     the DOM tree. External resources are downloaded and scanned.     */
/*                                                                      */
/*  3. A content script in each frame finds and sets keys on all        */
/*     sub-frame elements that are reachable from that frame.           */
/*                                                                      */
/*  4. The first pass gathers external style sheet resources:           */
/*                                                                      */
/*     - <style> element: find style sheet url()'s in @import rules,    */
/*       then remember locations.                                       */
/*                                                                      */
/*     - <link rel="stylesheet" href="..."> element: find style sheet   */
/*       url()'s in @import rules, then remember locations.             */
/*                                                                      */
/*  5. After the first pass, the referenced external style sheets are   */
/*     downloaded from the remembered locations.                        */
/*                                                                      */
/*  6. The second pass gathers external script/font/image resources:    */
/*                                                                      */
/*     - <script> element: remember location from src attribute.        */
/*                                                                      */
/*     - <link rel="icon" href="..."> element: remember location        */
/*       from href attribute.                                           */
/*                                                                      */
/*     - <img> element: remember location from src attribute.           */
/*                                                                      */
/*     if just saving currently displayed CSS images:                   */
/*                                                                      */
/*     - all elements: find url()'s in CSS computed style for element   */
/*       and for before/after pseudo-elements and remember locations.   */
/*                                                                      */
/*     otherwise, if saving all CSS images:                             */
/*                                                                      */
/*     - style attribute on any element: find image url()'s in CSS      */
/*       rules and remember locations.                                  */
/*                                                                      */
/*     - <style> element: handle @import rules, then find font and      */
/*       image url()'s in CSS rules and remember locations.             */
/*                                                                      */
/*     - <link rel="stylesheet" href="..."> element: handle @import     */
/*       rules, then find font and image url()'s in CSS rules and       */
/*       remember locations.                                            */
/*                                                                      */
/*  7. After the second pass, the referenced external resources are     */
/*     downloaded from the remembered locations.                        */
/*                                                                      */
/*  8. The third pass generates HTML and data uri's:                    */
/*                                                                      */
/*     - style attribute on any element: replace image url()'s in       */
/*       CSS rules with data uri's.                                     */
/*                                                                      */
/*     - <script> element: Javascript is not changed.                   */
/*                                                                      */
/*     - <script src="..."> element: convert Javascript to data uri     */
/*       and use this to replace url in src attribute.                  */
/*                                                                      */
/*     - <style> element: handle @import rules, then replace font and   */
/*       image url()'s in CSS rules with data uri's.                    */
/*                                                                      */
/*     - <link rel="stylesheet" href="..."> element: handle @import     */
/*       rules, then replace font and image url()'s in CSS rules        */
/*       with data uri's, then enclose in new <style> element and       */
/*       replace original <link> element.                               */
/*                                                                      */
/*     - <link rel="icon" href="..."> element: convert icon to data     */
/*       uri and use this to replace url in href attribute.             */
/*                                                                      */
/*     - <base href="..." target="..."> element: remove existing        */
/*       base element (if any) and insert new base element with href    */
/*       attribute set to document.baseURI and target attribute set     */
/*       to the same value as for removed base element (if any).        */
/*                                                                      */
/*     - <body background="..."> element: convert image to data uri     */
/*       and use this to replace url in background attribute.           */
/*                                                                      */
/*     - <img src="..."> element: convert current source image to       */
/*       data uri and use this to replace url in src attribute.         */
/*                                                                      */
/*     - <img srcset="..."> element: replace list of images in srcset   */
/*       attribute by empty string.                                     */
/*                                                                      */
/*     - <input type="image" src="..."> element: convert image to       */
/*       data uri and use this to replace url in src attribute.         */
/*                                                                      */
/*     - <input type="file"> or <input type="password"> element:        */
/*       no changes made to maintain security.                          */
/*                                                                      */
/*     - <input type="checkbox"> or <input type="radio"> element:       */
/*       add or remove checked attribute depending on the value of      */
/*       element.checked reflecting any user changes.                   */
/*                                                                      */
/*     - <input type="-other-"> element: add value attribute set to     */
/*       element.value reflecting any user changes.                     */
/*                                                                      */
/*     - <canvas> element: convert graphics to data uri and use this    */
/*       to define background image in style attribute.                 */
/*                                                                      */
/*     - <audio src="..."> element: if current source, convert audio    */
/*       to data uri and use this to replace url in src attribute.      */
/*                                                                      */
/*     - <video src="..."> element: if current source, convert video    */
/*       to data uri and use this to replace url in src attribute.      */
/*                                                                      */
/*     - <video poster="..."> element: convert image to data uri and    */
/*       use this to replace url in poster attribute.                   */
/*                                                                      */
/*     - <source src="..."> element in <audio> or <video> element:      */
/*       if current source, convert audio or video to data uri and      */
/*       use this to replace url in src attribute.                      */
/*                                                                      */
/*     - <source srcset="..."> element in <picture> element: replace    */
/*       list of images in srcset attribute by empty string.            */
/*                                                                      */
/*     - <track src="..."> element: convert subtitles to data uri and   */
/*       use this to replace url in src attribute.                      */
/*                                                                      */
/*     - <object data="..."> element: convert binary data to data uri   */
/*       and use these to replace url in data attribute.                */
/*                                                                      */
/*     - <embed src="..."> element: convert binary data to data uri     */
/*       and use this to replace url in src attribute.                  */
/*                                                                      */
/*     - <frame src="..."> element: process sub-tree to extract HTML,   */
/*       then convert HTML to data uri and use this to replace url in   */
/*       src attribute.                                                 */
/*                                                                      */
/*     - <iframe src="..."> or <iframe srcdoc="..."> element: process   */
/*       sub-tree to extract HTML, then convert HTML to text and use    */
/*       this to replace text in srcdoc attribute or to create new      */
/*       srcdoc attribute.                                              */
/*                                                                      */
/*     - <iframe src="..."> element: replace url in srcdoc attribute    */
/*       by empty string.                                               */
/*                                                                      */
/*     - other elements: process child nodes to extract HTML.           */
/*                                                                      */
/*     - text nodes: escape '<' and '>' characters.                     */
/*                                                                      */
/*     - comment nodes: enclose within <!-- and  -->                    */
/*                                                                      */
/*  9. Data URI syntax and defaults:                                    */
/*                                                                      */
/*     - data:[<media type>][;base64],<encoded data>                    */
/*                                                                      */
/*     - where <media type> is: <mime type>[;charset=<charset>]         */
/*                                                                      */
/*     - default for text content: text/plain;charset=US-ASCII          */
/*                                                                      */
/*     - default for binary content: application/octet-stream;base64    */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Potential Improvements                                              */
/*                                                                      */
/*  1. The main document and <frame> and <iframe> documents could be    */
/*     downloaded and parsed to extract the original states of the      */
/*     HTML elements, as an alternative to the current states.          */
/*                                                                      */
/*  2. <script src="..."> element could be converted to <script>        */
/*     element to avoid data uri in href attribute, which would also    */
/*     avoid using encodeURIComponent(), but any 'async' or 'defer'     */
/*     attributes would be lost and the order of execution of scripts   */
/*     could change.                                                    */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  General Handling of URLs                                            */
/*                                                                      */
/*  HTML                                                                */
/*                                                                      */
/*  1. <a> and <area> elements:                                         */
/*                                                                      */
/*     - absolute and relative URLs with fragment identifiers that      */
/*       point to the same page are converted to fragment-only URLs.    */
/*                                                                      */
/*     - other relative URLs are converted to absolute URLs.            */
/*                                                                      */
/*  2. Other elements: the contents of absolute and relative URLs       */
/*     are saved as data URIs.                                          */
/*                                                                      */
/*  3. Unsaved URLs are converted to absolute URLs.                     */
/*                                                                      */
/*  SVG                                                                 */
/*                                                                      */
/*  1. <a> elements:                                                    */
/*                                                                      */
/*     - absolute and relative URLs with fragment identifiers that      */
/*       point to the same page are converted to fragment-only URLs.    */
/*                                                                      */
/*     - other relative URLs are converted to absolute URLs.            */
/*                                                                      */
/*  2. <image> elements: the contents of absolute and relative URLs     */
/*     are saved as data URIs.                                          */
/*                                                                      */
/*  4. Other elements: the contents of absolute and relative URLs       */
/*     are saved as data URIs.                                          */
/*                                                                      */
/*  5. Unsaved URLs are converted to absolute URLs.                     */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Specific Handling of URLs in HTML and SVG Attributes                */
/*                                                                      */
/*  HTML Element    Attribute    HTML    Content        Handling        */
/*                                                                      */
/*  <a>             href          4 5    -              -               */
/*  <applet>        codebase      4      java           -               */
/*  <area>          href          4 5    -              -               */
/*  <audio>         src             5    audio          data uri   (1)  */
/*  <base>          href          4 5    -              -               */
/*  <blockquote>    cite          4 5    info           -               */
/*  <body>          background    4      image          data uri        */
/*  <button>        formaction      5    -              -               */
/*  <canvas>        -               5    graphics       data uri   (2)  */
/*  <del>           cite          4 5    info           -               */
/*  <embed>         src             5    data           data uri        */
/*  <form>          action        4 5    -              -               */
/*  <frame>         longdesc      4      info           -               */
/*  <frame>         src           4      html           data uri   (3)  */
/*  <head>          profile       4      metadata       -               */
/*  <html>          manifest        5    -              -               */
/*  <iframe>        longdesc      4      info           -               */
/*  <iframe>        src           4 5    html           html text  (4)  */
/*  <iframe>        srcdoc          5    html           html text  (4)  */
/*  <img>           longdesc      4      info           -               */
/*  <img>           src           4 5    image          data uri        */
/*  <img>           srcset          5    images         -          (5)  */
/*  <input>         formaction      5    -              -               */
/*  <input>         src           4 5    image          data uri        */
/*  <ins>           cite          4 5    info           -               */
/*  <link>          href          4 5    css            style      (6)  */
/*  <link>          href          4 5    icon           data uri        */
/*  <object>        archive       4      -              -               */
/*  <object>        classid       4      -              -               */
/*  <object>        codebase      4      -              -               */
/*  <object>        data          4 5    data           data uri        */
/*  <q>             cite          4 5    info           -               */
/*  <script>        src           4 5    javscript      data uri        */
/*  <source>        src             5    audio/video    data uri   (1)  */
/*  <source>        srcset          5    image          -          (5)  */
/*  <track>         src             5    audio/video    data uri        */
/*  <video>         poster          5    image          data uri        */
/*  <video>         src             5    video          data uri   (1)  */
/*                                                                      */
/*  SVG Element     Attribute    SVG     Content        Handling        */
/*                                                                      */
/*  <a>             href        1.1 2    -              -               */
/*  <image>         href        1.1 2    image or svg   data uri        */
/*  other           href        1.1 2    svg            data uri   (7)  */
/*                                                                      */
/*  Notes:                                                              */
/*                                                                      */
/*  (1) data uri is created only if the URL in the 'src' attribute      */
/*      is the same as the URL in element.currentSrc of the related     */
/*      <audio> or <video> element.                                     */
/*                                                                      */
/*  (2) data uri is created by calling element.toDataURL() and is       */
/*      used to define background image in the 'style' attribute.       */
/*                                                                      */
/*  (3) data uri is created by processing the frame's HTML sub-tree.    */
/*      Frame content is usually determined by URL in 'src' attribute,  */
/*      but this is not used directly. Frame content may also have      */
/*      been set programmatically.                                      */
/*                                                                      */
/*  (4) html text is created by processing the frame's HTML sub-tree.   */
/*      URL in 'src' attribute and HTML text in 'srcdoc' attribute      */
/*      determine frame content, but are not used directly; or frame    */
/*      Frame content is usually determined by URL in 'src' attribute   */
/*      and HTML text in 'srcdoc' attribute, but these are not used     */
/*      directly. Frame content may also have been set programmatically.*/
/*                                                                      */
/*  (5) if the URL in element.currentSrc is not the same as the URL     */
/*      in the 'src' attribute, it is assumed to be one of the URLs     */
/*      in the 'srcset' attributes, and the 'src' attribute is set to   */
/*      this URL and the 'srcset' attributes are set to empty strings.  */
/*                                                                      */
/*  (6) replace <link> element with <style> element containing the      */
/*      style sheet referred to by the URL in the 'href' attribute.     */
/*                                                                      */
/*  (7) applies to URLs in 'href' or 'xlink:href' attributes.           */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Handling of Binary Data and Characters                              */
/*                                                                      */
/*  1. Files downloaded by XMLHttpRequest GET request are received      */
/*     as a Uint8Array (8-bit unsigned integers) representing:          */
/*     - either binary data (image, font, audio or video)               */
/*     - or encoded characters (style sheets or scripts)                */
/*                                                                      */
/*  2. The Uint8Array is then converted to a Javascript string          */
/*     (16-bit unsigned integers) containing 8-bit unsigned values      */
/*     (a binary string) which is sent to the content script.           */
/*                                                                      */
/*  3. A binary string containing binary data is copied directly        */
/*     into the resourceContent array.                                  */
/*                                                                      */
/*  4. A binary string containing UTF-8 characters is converted to      */
/*     a normal Javascript string (containing UTF-16 characters)        */
/*     before being copied into the resourceContent array.              */
/*                                                                      */
/*  5. A binary string containing non-UTF-8 (ASCII, ANSI, ISO-8859-1)   */
/*     characters is copied directly into the resourceContent array.    */
/*                                                                      */
/*  6. When creating a Base64 data uri, the binary string from the      */
/*     resourceContent array is converted to a Base64 ASCII string      */
/*     using btoa().                                                    */
/*                                                                      */
/*  7. When creating a UTF-8 data uri, the UTF-16 string from the       */
/*     resourceContent array is converted to a UTF-8 %-escaped          */
/*     string using encodeURIComponent(). The following characters      */
/*     are not %-escaped: alphabetic, digits, - _ . ! ~ * ' ( )         */
/*                                                                      */
/*  8. Character encodings are determined as follows:                   */
/*     - UTF-8 Byte Order Mark (BOM) at the start of a text file        */
/*     - charset parameter in the HTTP Content-Type header field        */
/*     - @charset rule at the start of a style sheet                    */
/*     - charset attribute on an element referencing a text file        */
/*     - charset encoding of the parent document or style sheet         */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  IFrames and Frames - Firefox and Chrome Test Results                */
/*                                                                      */
/*                                        Firefox           Chrome      */
/*                                    Loads  cD   dE    Loads  cD   dE  */
/*  <iframe>                                                            */
/*                                                                      */
/*  src="data:..."                     yes   no   no     yes*  no   no  */
/*  src="blob:..."                     yes  yes  yes     yes*  no   no  */
/*                                                                      */
/*  srcdoc="html"                      yes  yes   no     yes  yes  yes  */
/*  srcdoc="html" sandbox=""           yes   no   no     yes   no   no  */
/*  srcdoc="html" sandbox="aso"        yes  yes   no     yes  yes  yes  */
/*                                                                      */
/*  <frame>                                                             */
/*                                                                      */
/*  src="data:..."                     yes   no   no     yes   no   no  */
/*  src="blob:..."                     yes  yes  yes     yes   no   no  */
/*                                                                      */
/*  aso = allow-same-origin                                             */
/*  cD = frame.contentDocument accessible                               */
/*  dE = frame.contentDocument.documentElement accessible               */
/*  yes* = loads but there are issues with <audio> elements             */
/*                                                                      */
/************************************************************************/

/************************************************************************/
/*                                                                      */
/*  Maximum Total Size of Resources - Windows 10 Test Results           */
/*                                                                      */
/*  Browser                Maximum      Limit                           */
/*                                                                      */
/*  Chrome 56 (32-bit)      ~691MB      500MB                           */
/*  Chrome 56 (64-bit)      ~338MB      250MB                           */
/*                                                                      */
/*  Chrome 67 (32-bit)      ~691MB      500MB                           */
/*  Chrome 67 (64-bit)      ~338MB      250MB                           */
/*                                                                      */
/*  Firefox 52 (32-bit)     ~184MB      150MB                           */
/*  Firefox 52 (64-bit)     ~185MB      150MB                           */
/*                                                                      */
/*  Firefox 55 (32-bit)     ~537MB      400MB                           */
/*  Firefox 55 (64-bit)    >1536MB     1000MB                           */
/*                                                                      */
/*  Firefox 62 (32-bit)     ~522MB      400MB                           */
/*  Firefox 62 (64-bit)    >1536MB     1000MB                           */
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
/*                                                                      */
/************************************************************************/

"use strict";

/************************************************************************/

/* Global variables */

// Scrapyard //////////////////////////////////////////////////////////////////
import {Archive} from "../storage_entities.js";
import {ARCHIVE_TYPE_FILES} from "../storage.js";
var mimeTypes;
////////////////////////////////////////////////////////////////// Scrapyard //

var isFirefox;
var ffVersion;
var gcVersion;

var platformOS;
var platformArch;

// Scrapyard //////////////////////////////////////////////////////////////////
// <deleted>
////////////////////////////////////////////////////////////////// Scrapyard //

var maxResourceSize;
var maxResourceTime;
var allowPassive;
var refererHeader;

// Scrapyard //////////////////////////////////////////////////////////////////
// <deleted>
////////////////////////////////////////////////////////////////// Scrapyard //

/************************************************************************/

/* Initialize on browser startup */

chrome.runtime.getPlatformInfo(
function(PlatformInfo)
{
    platformOS = PlatformInfo.os;

    // Scrapyard //////////////////////////////////////////////////////////////////
    chrome.storage.local.get("savepage-settings",
       async function(object) {
            object = object["savepage-settings"] || {};

            object["environment-platformos"] = platformOS;

            platformArch = PlatformInfo.arch;

            object["environment-platformarch"] = platformArch;

            isFirefox = (navigator.userAgent.indexOf("Firefox") >= 0);

            object["environment-isfirefox"] = isFirefox;

            if (isFirefox) {
                const info = await browser.runtime.getBrowserInfo();
                ffVersion = info.version.substr(0, info.version.indexOf("."));
                object["environment-ffversion"] = ffVersion;
            }
            else
                gcVersion = navigator.userAgent.match(/Chrom(?:e|ium)\/([0-9]+)/)[1];

           chrome.storage.local.set({"savepage-settings": object}, initialize);
        });
    ////////////////////////////////////////////////////////////////// Scrapyard //
});

// Scrapyard //////////////////////////////////////////////////////////////////
function initialize(optionsOnly)
////////////////////////////////////////////////////////////////// Scrapyard //
{
    // Scrapyard //////////////////////////////////////////////////////////////////
    chrome.storage.local.get("savepage-settings",
    ////////////////////////////////////////////////////////////////// Scrapyard //
    function(object)
    {
        // Scrapyard //////////////////////////////////////////////////////////////////
        object = object["savepage-settings"] || {};
        ////////////////////////////////////////////////////////////////// Scrapyard //

        // Scrapyard //////////////////////////////////////////////////////////////////
        // <deleted>
        ////////////////////////////////////////////////////////////////// Scrapyard //

        /* Initialize or migrate options */

        /* General options */

        if (!("options-buttonactiontype" in object)) object["options-buttonactiontype"] = 0;

        if (!("options-buttonaction" in object)) object["options-buttonaction"] =
            ("options-savebuttonaction" in object) ? object["options-savebuttonaction"] : 2;  /* Version 2.0-2.1 */

        // Scrapyard //////////////////////////////////////////////////////////////////
        //if (!("options-newbuttonaction" in object)) object["options-newbuttonaction"] =
        //    ("options-buttonaction" in object) ? mapActions[object["options-buttonaction"]] : 1;  /* Version 3.0-12.8 */
        ////////////////////////////////////////////////////////////////// Scrapyard //

        if (!("options-buttonactionitems" in object)) object["options-buttonactionitems"] =
            ("options-newbuttonaction" in object) ? object["options-newbuttonaction"] : 1;  /* Version 13.0-17.3 */

        if (!("options-showsubmenu" in object)) object["options-showsubmenu"] =
            ("options-showmenuitem" in object) ? object["options-showmenuitem"] : true;  /* Version 3.0-5.0 */

        if (!("options-showwarning" in object)) object["options-showwarning"] = true;

        if (!("options-showresources" in object)) object["options-showresources"] =
            ("options-showurllist" in object) ? object["options-showurllist"] : false;  /* Version 7.5-17.3 */

        if (!("options-promptcomments" in object)) object["options-promptcomments"] = false;

        if (!("options-skipwarningscomments" in object)) object["options-skipwarningscomments"] = true;

        if (!("options-usenewsavemethod" in object)) object["options-usenewsavemethod"] = false;

        if (!("options-showsaveasdialog" in object)) object["options-showsaveasdialog"] = false;

        if (!("options-closetabafter" in object)) object["options-closetabafter"] = false;

        if (!("options-loadlazycontent" in object)) object["options-loadlazycontent"] =
            ("options-forcelazyloads" in object) ? object["options-forcelazyloads"] : false;  /* Version 13.0-24.2 */

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (!("options-lazyloadtype" in object)) object["options-lazyloadtype"] =
            ("options-lazyloadstype" in object) ? +object["options-lazyloadstype"]+1 + "" : "0";  /* Version 24.0-24.2 */

        object["options-loadlazycontent"] = object["options-lazyloadtype"] != "0";  /* Version 25.0 */
        ////////////////////////////////////////////////////////////////// Scrapyard //

        if (!("options-loadlazyimages" in object)) object["options-loadlazyimages"] = true;

        if (!("options-retaincrossframes" in object)) object["options-retaincrossframes"] = true;

        if (!("options-mergecssimages" in object)) object["options-mergecssimages"] = true;

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (!("options-executescripts" in object)) object["options-executescripts"] = true;
        ////////////////////////////////////////////////////////////////// Scrapyard //

        if (!("options-removeunsavedurls" in object)) object["options-removeunsavedurls"] = true;

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (!("options-removeelements" in object)) object["options-removeelements"] =
            ("options-purgeelements" in object) ? object["options-purgeelements"] : true;  /* Version 13.2-20.1 */

        if (!("options-rehideelements" in object)) object["options-rehideelements"] = object["options-removeelements"];
        ////////////////////////////////////////////////////////////////// Scrapyard //

        if (!("options-includeinfobar" in object)) object["options-includeinfobar"] =
            ("options-includenotification" in object) ? object["options-includenotification"] : false;  /* Version 7.4 */

        if (!("options-includesummary" in object)) object["options-includesummary"] = false;

        if (!("options-formathtml" in object)) object["options-formathtml"] = false;

        /* Saved Items options */

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (!("options-savehtmlimagesall" in object)) object["options-savehtmlimagesall"] =
            ("options-saveallhtmlimages" in object) ? object["options-saveallhtmlimages"] : true;  /* Version 2.0-3.0 */

        if (!("options-savehtmlaudiovideo" in object)) object["options-savehtmlaudiovideo"] = true;

        if (!("options-savehtmlobjectembed" in object)) object["options-savehtmlobjectembed"] = true;

        if (!("options-savecssimagesall" in object)) object["options-savecssimagesall"] =
            ("options-saveallcssimages" in object) ? object["options-saveallcssimages"] : true;  /* Version 2.0-3.0 */

        if (!("options-savecssfontswoff" in object)) object["options-savecssfontswoff"] =
            ("options-saveallcustomfonts" in object) ? object["options-saveallcustomfonts"] : true;  /* Version 2.0-3.0 */

        if (!("options-savecssfontsall" in object)) object["options-savecssfontsall"] = true;

        if (!("options-savescripts" in object)) object["options-savescripts"] = false;  /* Version 2.0-3.0 */
        ////////////////////////////////////////////////////////////////// Scrapyard //

        /* File Info options */

        if (!("options-urllisturls" in object)) object["options-urllisturls"] = new Array();

        if (!("options-urllistname" in object)) object["options-urllistname"] = "";

        if (!("options-savedfilename" in object)) object["options-savedfilename"] = "%TITLE%";

        if (!("options-replacespaces" in object)) object["options-replacespaces"] = false;

        if (!("options-replacechar" in object)) object["options-replacechar"] = "-";

        if (!("options-maxfilenamelength" in object)) object["options-maxfilenamelength"] = 150;

        /* Advanced options */

        if (!("options-urllisttime" in object)) object["options-urllisttime"] = 10;

        if (!("options-savedelaytime" in object)) object["options-savedelaytime"] = 0;

        if (!("options-lazyloadscrolltime" in object)) object["options-lazyloadscrolltime"] =
            ("options-lazyloadsscrolltime" in object) ? object["options-lazyloadsscrolltime"] : 0.2;  /* Version 24.0-24.2 */

        if (!("options-lazyloadshrinktime" in object)) object["options-lazyloadshrinktime"] =
            ("options-lazyloadsshrinktime" in object) ? object["options-lazyloadsshrinktime"] : 0.5;  /* Version 24.0-24.2 */

        if (!("options-maxframedepth" in object)) object["options-maxframedepth"] =
            ("options-saveframedepth" in object) ? object["options-saveframedepth"] : 5;  /* Version 2.0-2.1 */

        if (!("options-maxresourcesize" in object)) object["options-maxresourcesize"] = 50;

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (!("options-maxresourcetime" in object)) object["options-maxresourcetime"] =
            ("options-resourcetimeout" in object) ? object["options-resourcetimeout"] : 30;  /* Version 9.0-9.1 */
        ////////////////////////////////////////////////////////////////// Scrapyard //

        if (!("options-allowpassive" in object)) object["options-allowpassive"] = false;

        if (!("options-crossorigin" in object)) object["options-crossorigin"] = 0;

        if (!("options-useautomation" in object)) object["options-useautomation"] = false;

        if (!("options-maxframedepth-9.0" in object))
        {
            object["options-maxframedepth"] = 5;
            object["options-maxframedepth-9.0"] = true;
        }

        /* Update stored options */

        // Scrapyard //////////////////////////////////////////////////////////////////
        chrome.storage.local.set({"savepage-settings": object});
        ////////////////////////////////////////////////////////////////// Scrapyard //

        /* Initialize local options */

        // Scrapyard //////////////////////////////////////////////////////////////////
        // <deleted>
        ////////////////////////////////////////////////////////////////// Scrapyard //

        maxResourceSize = object["options-maxresourcesize"];

        maxResourceTime = object["options-maxresourcetime"];

        allowPassive = object["options-allowpassive"];

        refererHeader = object["options-crossorigin"];

        // Scrapyard //////////////////////////////////////////////////////////////////
        // <deleted>
        ////////////////////////////////////////////////////////////////// Scrapyard //

        // Scrapyard //////////////////////////////////////////////////////////////////
        if (optionsOnly)
            return;
        ////////////////////////////////////////////////////////////////// Scrapyard //

        /* Add listeners */

        addListeners();
    });
}

/************************************************************************/

/* Add listeners */

function addListeners()
{
    var extraInfo;

    // Scrapyard //////////////////////////////////////////////////////////////////
    // <deleted>
    ////////////////////////////////////////////////////////////////// Scrapyard //

    /* Web request listeners */

    extraInfo = (isFirefox || gcVersion < 72) ? ["blocking","requestHeaders"] : ["blocking","requestHeaders","extraHeaders"];

    // Scrapyard //////////////////////////////////////////////////////////////////
    if (chrome.webRequest)
    ////////////////////////////////////////////////////////////////// Scrapyard //
        chrome.webRequest.onBeforeSendHeaders.addListener(
        function(details)
        {
            var i,j;

            for (i = 0; i < details.requestHeaders.length; i++)
            {
                if (details.requestHeaders[i].name == "savepage-referer") details.requestHeaders[i].name = "Referer";

                if (details.requestHeaders[i].name == "savepage-origin") details.requestHeaders[i].name = "Origin";
            }

            return { requestHeaders: details.requestHeaders };
        },
        { urls: ["<all_urls>"], types: ["xmlhttprequest"] },extraInfo);

    /* Message received listener */

    chrome.runtime.onMessage.addListener(
    function(message,sender,sendResponse)
    {
        var safeContent,mixedContent,refererURL,refererValue,htmlBlob,objectURL,receiverId;
        var xhr = new Object();

        // Scrapyard //////////////////////////////////////////////////////////////////
        var saveUnpacked = message.bookmark?.contains === ARCHIVE_TYPE_FILES;
        var messageResolve = _BACKGROUND_PAGE? () => undefined: sendResponse;
        var messagePromise = saveUnpacked
            ? (_BACKGROUND_PAGE
                ? new Promise(resolve => messageResolve = resolve)
                : true)
            : undefined;
        ////////////////////////////////////////////////////////////////// Scrapyard //

        switch (message.type)
        {
            /* Messages from content script */

            // Scrapyard //////////////////////////////////////////////////////////////////
            case "savepageSettingsChanged":
                initialize(true);
                break;
            ////////////////////////////////////////////////////////////////// Scrapyard //

            // Scrapyard //////////////////////////////////////////////////////////////////
            // <deleted>
            ////////////////////////////////////////////////////////////////// Scrapyard //

            case "requestFrames":

                // Scrapyard //////////////////////////////////////////////////////////////////
                chrome.tabs.sendMessage(sender.tab.id,message,checkError);
                ////////////////////////////////////////////////////////////////// Scrapyard //

                break;

            case "replyFrame":

                // Scrapyard //////////////////////////////////////////////////////////////////
                chrome.tabs.sendMessage(sender.tab.id,message,checkError);
                ////////////////////////////////////////////////////////////////// Scrapyard //

                break;

            case "loadResource":

                /* XMLHttpRequest must not be sent if http: resource in https: page or https: referer */
                /* unless passive mixed content allowed by user option */

                safeContent = (message.location.substr(0,6) == "https:" ||
                               (message.location.substr(0,5) == "http:" && message.referer?.substr(0,5) == "http:" && message.pagescheme == "http:"));

                mixedContent = (message.location.substr(0,5) == "http:" && (message.referer?.substr(0,6) == "https:" || message.pagescheme == "https:"));

                if (safeContent || (mixedContent && message.passive && allowPassive))
                {
                    /* Load same-origin resource - or cross-origin with or without CORS - and add Referer Header */

                    try
                    {
                        xhr = new XMLHttpRequest();

                        xhr.open("GET",message.location,true);

                        /* Referer Header must not be set if http: resource in https: page or https: referer */
                        /* Referer Header must not be set if file: or data: resource */
                        /* Referer Header only set if allowed by user option */
                        /* Referer Header has restricted referer URL */

                        if (safeContent && message.referer?.substr(0,5) != "file:" && message.referer?.substr(0,5) != "data:")
                        {
                            refererURL = new URL(message.referer);

                            if (refererHeader > 0)
                            {
                                if (refererHeader == 1) refererValue = refererURL.origin;  /* referer URL restricted to origin */
                                else if (refererHeader == 2)
                                {
                                    if (sender.tab.incognito) refererValue = refererURL.origin;  /* referer URL restricted to origin */
                                    else refererValue = refererURL.origin + refererURL.pathname;  /* referer URL restricted to origin and path */
                                }

                                xhr.setRequestHeader("savepage-referer",refererValue);
                            }
                        }

                        /* Origin Header must be set for CORS to operate */

                        if (message.usecors)
                        {
                            xhr.setRequestHeader("savepage-origin",refererURL.origin);
                        }

                        xhr.responseType = "arraybuffer";
                        xhr.timeout = maxResourceTime*1000;
                        xhr.onload = onloadResource;
                        xhr.onerror = onerrorResource;
                        xhr.ontimeout = ontimeoutResource;
                        xhr.onprogress = onprogressResource;

                        xhr._tabId = sender.tab.id;
                        xhr._index = message.index;

                        xhr.send();  /* throws exception if url is invalid */
                    }
                    catch (e)
                    {
                        chrome.tabs.sendMessage(sender.tab.id,{ type: "loadFailure", index: message.index, reason: "send" },checkError);
                    }
                }
                else chrome.tabs.sendMessage(sender.tab.id,{ type: "loadFailure", index: message.index, reason: "mixed" },checkError);

                // Scrapyard //////////////////////////////////////////////////////////////////
                async function onloadResource()
                ////////////////////////////////////////////////////////////////// Scrapyard //
                {
                    var i,binaryString,contentType,allowOrigin;
                    var byteArray = new Uint8Array(this.response);

                    if (this.status == 200)
                    {
                        // Scrapyard //////////////////////////////////////////////////////////////////
                        if (!_BACKGROUND_PAGE && byteArray.byteLength > maxResourceSize*1024*1024) {
                            chrome.tabs.sendMessage(this._tabId,{ type: "loadFailure", index: this._index, reason: "maxsize" },checkError);
                            return;
                        }
                        ////////////////////////////////////////////////////////////////// Scrapyard //

                        binaryString = "";
                        for (i = 0; i < byteArray.byteLength; i++) binaryString += String.fromCharCode(byteArray[i]);

                        contentType = this.getResponseHeader("Content-Type");
                        if (contentType == null) contentType = "";

                        allowOrigin = this.getResponseHeader("Access-Control-Allow-Origin");
                        if (allowOrigin == null) allowOrigin = "";

                        // Scrapyard //////////////////////////////////////////////////////////////////
                        const [mimeType, charset] = parseContentType(contentType);
                        const fileName = await getResourceFileName(message.index, message.location, mimeType);

                        if (saveUnpacked && !(mimeType.toLowerCase() === "text/css" || fileName.endsWith(".css"))) {
                            await saveResource(message.bookmark, this.response, fileName, charset);
                            chrome.tabs.sendMessage(this._tabId,{ type: "loadSuccess", index: this._index,
                                content: "", filename: fileName, contenttype: contentType, alloworigin: allowOrigin },checkError);
                        }
                        else
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                            chrome.tabs.sendMessage(this._tabId,{ type: "loadSuccess", index: this._index,
                                content: binaryString, contenttype: contentType, alloworigin: allowOrigin },checkError);
                    }
                    else chrome.tabs.sendMessage(this._tabId,{ type: "loadFailure", index: this._index, reason: "load:" + this.status },checkError);
            // Scrapyard //////////////////////////////////////////////////////////////////
                    messageResolve();
                }

                async function getResourceFileName(index, url, mimeType) {
                    if (!mimeTypes)
                        mimeTypes = await (await fetch("/mime_types.json")).json();

                    let extension = mimeTypes[mimeType]?.extensions?.[0];

                    if (!extension) {
                        const path = new URL(url).pathname;
                        extension = path.match(/\.([\d,a-z]{1,8}$)/i)?.[1] || "bin";
                    }

                    return `resource_${index}.${extension}`;
                }

                function parseContentType(contentType) {
                    let matches = contentType.match(/([^;]+)/i);
                    let mimeType, charset;

                    if (matches)
                        mimeType = matches[1].toLowerCase();
                    else mimeType = "";

                    matches = contentType.match(/;\s*charset=([^;]+)/i);
                    if (matches)
                        charset = matches[1].toLowerCase();
                    else charset = "";

                    return [mimeType, charset];
                }

                async function saveResource(bookmark, content, fileName, charset) {
                    try {
                        if (charset && charset.toLowerCase() !== "utf-8") {
                            const textDecoder = new TextDecoder(charset);
                            content = textDecoder.decode(content);
                        }

                        return Archive.saveFile(bookmark, fileName, content);
                    } catch (e) {
                        console.error(e);
                    }
                }
            ////////////////////////////////////////////////////////////////// Scrapyard //

                function onerrorResource()
                {
                    chrome.tabs.sendMessage(this._tabId,{ type: "loadFailure", index: this._index, reason: "network" },checkError);
                    // Scrapyard //////////////////////////////////////////////////////////////////
                    messageResolve();
                    ////////////////////////////////////////////////////////////////// Scrapyard //
                }

                function ontimeoutResource()
                {
                    chrome.tabs.sendMessage(this._tabId,{ type: "loadFailure", index: this._index, reason: "maxtime" },checkError);
                    // Scrapyard //////////////////////////////////////////////////////////////////
                    messageResolve();
                    ////////////////////////////////////////////////////////////////// Scrapyard //
                }

                function onprogressResource(event)
                {
                    if (event.lengthComputable && event.total > maxResourceSize*1024*1024)
                    {
                        this.abort();

                        chrome.tabs.sendMessage(this._tabId,{ type: "loadFailure", index: this._index, reason: "maxsize" },checkError);
                        // Scrapyard //////////////////////////////////////////////////////////////////
                        messageResolve();
                        ////////////////////////////////////////////////////////////////// Scrapyard //
                    }
                }

                // Scrapyard //////////////////////////////////////////////////////////////////
                return messagePromise;
                ////////////////////////////////////////////////////////////////// Scrapyard //

            // Scrapyard //////////////////////////////////////////////////////////////////
            // <deleted>
            ////////////////////////////////////////////////////////////////// Scrapyard //

        }
    });

    // Scrapyard //////////////////////////////////////////////////////////////////
    // <deleted>
    ////////////////////////////////////////////////////////////////// Scrapyard //
}

// Scrapyard //////////////////////////////////////////////////////////////////
// <deleted>
////////////////////////////////////////////////////////////////// Scrapyard //

/* Check for sendMessage errors */

function checkError()
{
    if (chrome.runtime.lastError == null) ;
    else if (chrome.runtime.lastError.message == "Could not establish connection. Receiving end does not exist.") ;  /* Chrome & Firefox - ignore */
    else if (chrome.runtime.lastError.message == "The message port closed before a response was received.") ;  /* Chrome - ignore */
    else if (chrome.runtime.lastError.message == "Message manager disconnected") ;  /* Firefox - ignore */
    else {
        console.log("Save Page WE - " + chrome.runtime.lastError.message);
    }
}

// Scrapyard //////////////////////////////////////////////////////////////////
// <deleted>
////////////////////////////////////////////////////////////////// Scrapyard //
