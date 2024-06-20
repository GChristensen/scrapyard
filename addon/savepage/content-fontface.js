/************************************************************************/
/*                                                                      */
/*      Save Page WE - Generic WebExtension - Content Pages             */
/*                                                                      */
/*      Javascript for Dynamically Loaded Fonts (all frames)            */
/*                                                                      */
/*      Last Edit - 31 Jul 2020                                         */
/*                                                                      */
/*      Copyright (C) 2020 DW-dev                                       */
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
/*                                                                      */
/************************************************************************/

/* Loaded into all iframes and frames of all content pages */

/* Shares global variable/function namespace with other content scripts */

/* Use wrapper function to separate namespace from main content script */

"use strict";

fontfaceScript();

function fontfaceScript()
{

/************************************************************************/

/* Global variables */

var script;

/************************************************************************/

/* Append <script> that executes interceptFontFace() in context of page */

script = document.createElement("script");
script.setAttribute("data-savepage-fontface","");
script.textContent = "(" + interceptFontFace.toString() + ")();";
document.documentElement.appendChild(script);
script.remove();

/* Intercept calls to FontFace constructor and append @font-face rule */

function interceptFontFace()
{
    var OrigFontFace;
    
    if (window.FontFace)
    {
        OrigFontFace = window.FontFace;
        
        window.FontFace = 
        function ()
        {
            var i,fontfacerule,style;
            
            /* Generate equivalent @font-face rule */
            
            fontfacerule = "@font-face { ";
            fontfacerule += "font-family: " + arguments[0] + "; ";
            fontfacerule += "src: " + arguments[1] + "; ";
            
            if (arguments[2])
            {
                if (arguments[2].weight) fontfacerule += "font-weight: " + arguments[2].weight + "; ";
                if (arguments[2].style) fontfacerule += "font-style: " + arguments[2].style + "; ";
                if (arguments[2].stretch) fontfacerule += "font-stretch: " + arguments[2].stretch + "; ";
            }
            
            fontfacerule += " }";
            
            // console.log("FontFace Rule: " + fontfacerule);
            
            /* Append <style> element with @font-face rule to <head> */
            
            style = document.createElement("style");
            style.setAttribute("data-savepage-fontface","");
            style.textContent = fontfacerule;
            document.head.appendChild(style);
            
            return new OrigFontFace(...arguments);
        };
    }
}

/************************************************************************/

}
