import {send} from "./proxy.js";
import {settings} from "./settings.js";
import DropboxAuth from "./lib/dropbox/auth.js";
import Dropbox from "./lib/dropbox/dropbox.js"
import {readBlob} from "./utils_io.js";
import {CloudClientBase, CloudItemNotFoundError} from "./cloud_client_base.js";

const APP_KEY = "0y7co3j1k4oc7up";

export class DropboxClient extends CloudClientBase {
    constructor() {
        super()
        this.ID = "dropbox";
        this.dbxAuth = new DropboxAuth({clientId: APP_KEY});
        this.dbx = new Dropbox({auth: this.dbxAuth});
    }

    initialize() {
        let refreshToken = settings.dropbox_refresh_token();
        if (refreshToken) {
            this.dbxAuth.setRefreshToken(refreshToken);
        }
        else {
            browser.runtime.onMessage.addListener((request) => {
                if (request.type === "dropboxAuthenticated") {
                    this.dbxAuth.setRefreshToken(request.refreshToken);
                }
            });
        }
    }

    isAuthenticated() {
        return !!settings.dropbox_refresh_token();
    }

    signOut() {
        settings.dropbox_refresh_token(null);
    }

    _getAuthorizationUrl() {
        return this.dbxAuth.getAuthenticationUrl(CloudClientBase.REDIRECT_URL, undefined,
            'code', 'offline', undefined, undefined, true);
    }

    async _obtainRefreshToken(url) {
        const code = url.match(/.*code=(.*)$/i)[1];
        let response = await this.dbxAuth.getAccessTokenFromCode(CloudClientBase.REDIRECT_URL, code);
        const refreshToken = response.result.refresh_token;
        this.dbxAuth.setRefreshToken(refreshToken);

        await settings.dropbox_refresh_token(refreshToken);
        send.dropboxAuthenticated({refreshToken});

        if (settings.dropbox___dbat())
            settings.dropbox___dbat(null);
    }

    async uploadFile(path, data) {
        await this.dbx.filesUpload({
            path,
            contents: data,
            mode: "overwrite",
            mute: true
        });
    }

    async downloadFile(path, binary) {
        let result = null;

        try {
            const {result: {fileBlob}} = await this.dbx.filesDownload({path});
            result = readBlob(fileBlob, binary? "binary": null);
        }
        catch (e) {
            if (e.status === 409) { // no index.js file
                if (e.error.error_summary.startsWith("path/not_found"))
                    throw new CloudItemNotFoundError();
            }
            else
                console.error(e);
        }

        return result;
    }

    async deleteFile(path) {
        await this.dbx.filesDeleteV2({path});
    }

    async share(path, filename, content) {
        await this.authenticate();
        return this.dbx.filesUpload({
            path: path + this._replaceSpecialChars(filename),
            mode: "add",
            autorename: true,
            mute: false,
            strict_conflict: false,
            contents: content
        });
    };

    async reset() {
        try {
            const {result: {entries}} = await this.dbx.filesListFolder({path: CloudClientBase.CLOUD_SHELF_PATH});

            if (entries && entries.length) {
                const files = {entries: entries.map(f => ({path: f.path_display}))};
                await this.dbx.filesDeleteBatch(files);
            }
        }
        catch (e) {
            console.error(e);
        }
    }

    async getLastModified() {
        try {
            const {result: meta} = await this.dbx.filesGetMetadata({
                path: `${CloudClientBase.CLOUD_SHELF_PATH}/${CloudClientBase.CLOUD_SHELF_INDEX}`
            });

            if (meta && meta.server_modified)
                return new Date(meta.server_modified);
        }
        catch (e) {
            console.error(e);
        }

        return null;
    }
}

export let dropboxClient = new DropboxClient();
