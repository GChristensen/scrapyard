// Users who prefer reduced motion get the iShell demo frozen on the frame 2s into its
// 8.8s loop (prompt open, "b" typed, suggestions listed, step 2 highlighted)
// instead of the endless SMIL animation.
//
// The demo is a standalone SVG loaded through <object>, so its document is reached
// via contentDocument. Browsers only allow that when the page is served over http(s),
// not from file://; in that case the animation simply keeps playing.

(function () {
  // ---- iframe-aware link handling ----
  // When embedded in an iframe, links open in a new tab; standalone, they
  // navigate normally in the same tab.
  function isEmbedded() {
    try {
      return window.self !== window.top;
    } catch (e) {
      // cross-origin parent access throws, which itself implies embedding
      return true;
    }
  }

  if (isEmbedded()) {
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      links[i].target = "_blank";
      links[i].rel = "noopener noreferrer";
    }
  }

  var demo = document.getElementById('ishell-demo');
  if (!demo || !window.matchMedia || !matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function freeze() {
    try {
      var svg = demo.contentDocument && demo.contentDocument.documentElement;
      if (svg && svg.setCurrentTime) {
        svg.setCurrentTime(2);
        svg.pauseAnimations();
      }
    } catch (e) { /* cross-origin (file://): leave the animation running */ }
  }

  demo.addEventListener('load', freeze);
  freeze(); // in case the SVG finished loading before this script ran
})();
