// Classic, self-contained script injected into all frames: appends (then removes) a page-world <script> that
// wraps window.FontFace so every dynamically constructed font also appends an equivalent @font-face rule,
// making JS-loaded fonts visible to the CSS scan. Wrapping happens once per page even if injected again.

(function () {
    "use strict";

    function interceptFontFace() {
        if (!window.FontFace || window.FontFace.__scrapyardWrapped)
            return;

        var OriginalFontFace = window.FontFace;

        window.FontFace = function () {
            var rule = "@font-face { ";
            rule += "font-family: " + arguments[0] + "; ";
            rule += "src: " + arguments[1] + "; ";

            if (arguments[2]) {
                if (arguments[2].weight) rule += "font-weight: " + arguments[2].weight + "; ";
                if (arguments[2].style) rule += "font-style: " + arguments[2].style + "; ";
                if (arguments[2].stretch) rule += "font-stretch: " + arguments[2].stretch + "; ";
            }

            rule += " }";

            var style = document.createElement("style");
            style.setAttribute("data-scrapyard-fontface", "");
            style.textContent = rule;
            document.head.appendChild(style);

            return new OriginalFontFace(...arguments);
        };

        window.FontFace.__scrapyardWrapped = true;
    }

    try {
        var script = document.createElement("script");
        script.setAttribute("data-scrapyard-fontface", "");
        script.textContent = "(" + interceptFontFace.toString() + ")();";
        document.documentElement.appendChild(script);
        script.remove();
    }
    catch (e) {
        /* a strict page CSP may block the inline script */
    }
})();
