// Runtime embedded into saved pages: rebuilds shadow roots from <template data-scrapyard-shadowroot> elements
// (also the old data-savepage-shadowroot markers), including nested frames up to the depth limit.

function scrapyard_ShadowLoader(maxFrameDepth)
{
    createShadowDOMs(0, document.documentElement);

    function isShadowTemplate(element)
    {
        return element.localName == "template" &&
            (element.hasAttribute("data-scrapyard-shadowroot") || element.hasAttribute("data-savepage-shadowroot"));
    }

    function createShadowDOMs(depth, element)
    {
        var i;

        if (element.localName == "iframe" || element.localName == "frame")
        {
            if (depth < maxFrameDepth)
            {
                try
                {
                    if (element.contentDocument.documentElement != null)
                        createShadowDOMs(depth + 1, element.contentDocument.documentElement);
                }
                catch (e) {}
            }
        }
        else
        {
            if (element.children.length >= 1 && isShadowTemplate(element.children[0]))
            {
                var shadowRoot = element.shadowRoot || element.attachShadow({mode: "open"});
                shadowRoot.appendChild(element.children[0].content);
                element.removeChild(element.children[0]);

                for (i = 0; i < element.shadowRoot.children.length; i++)
                    if (element.shadowRoot.children[i] != null)
                        createShadowDOMs(depth, element.shadowRoot.children[i]);
            }

            for (i = 0; i < element.children.length; i++)
                if (element.children[i] != null)
                    createShadowDOMs(depth, element.children[i]);
        }
    }
}
