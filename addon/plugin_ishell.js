import {receive, send} from "./proxy.js";
import {settings} from "./settings.js";

class IShellPlugin {
    initialize() {
        this.ISHELL_ID = this._getIShellID();
        this.enableInvalidation(settings.ishell_presents());

        browser.runtime.onMessage.addListener((request) => {
            if (request.type === "ishellEnableInvalidation") {
                this.enableInvalidation(request.enable)
            }
        });
    }

    _getIShellID() {
        if (settings.platform.firefox)
            return `ishell${this._isExtensionPrivate()? "": "-we"}@gchristensen.github.io`;
        else if (settings.platform.chrome) {
            return this._isExtensionPrivate()? "hpadlaipeifcpbpfnkkediojdlcgfiin": "hdjdmgedflhjhbflaijohpnognlhacoc";
        }
    }

    _isExtensionPrivate() {
        let id = browser.runtime.id;

        if (id) {
            if (settings.platform.firefox)
                return !id.includes("-we");
            else
                return id === "eljecjmpgeldgcjnefcedhhcobnghplj";
        }

        return false;
    }

    isIShell(id) {
        if (!id)
            return false;

        if (settings.platform.firefox)
            return /^ishell(:?-we)?@gchristensen.github.io$/.test(id);
        else if (settings.platform.chrome)
            return id === this.ISHELL_ID;
    }

    listenIShell() {
        if (!this._initialized) {
            this._initialized = true;
            this.enableInvalidation(true);
            this._notifyOtherInstances(true);
            this._installManagementListeners();
        }
    }

    _installManagementListeners() {
        if (!this._managementListenersInstalled) {
            this._managementListenersInstalled = true;

            browser.management.onInstalled.addListener((info) => {
                if (info.id === this.ISHELL_ID) {
                    this.enableInvalidation(true);
                    this._notifyOtherInstances(true);
                }
            });

            browser.management.onUninstalled.addListener((info) => {
                if (info.id === this.ISHELL_ID) {
                    this.enableInvalidation(false);
                    this._notifyOtherInstances(false);
                }
            });
        }
    }

    _notifyOtherInstances(enable) {
        settings.load().then(() => settings.ishell_presents(enable));
        // notify instances of the class in the other pages that extension is installed
        send.ishellEnableInvalidation({enable: enable});
    }

    enableInvalidation(enable) {
        globalThis.__iShellInvalidationEnabled = enable;
    }

    isInvalidationEnabled() {
        return globalThis.__iShellInvalidationEnabled;
    }

    invalidateCompletion() {
        if (this.isInvalidationEnabled()) {
            try {
                browser.runtime.sendMessage(this.ISHELL_ID, {type: "SCRAPYARD_INVALIDATE_COMPLETION"});
            }
            catch (e) {
                console.error(e);
            }
        }
    }
}

export const ishellConnector = new IShellPlugin();

receive.scrapyardIdRequested = message => {
    if (message.senderId === ishellConnector.ISHELL_ID)
        ishellConnector.listenIShell();
}
