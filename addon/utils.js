import {send, sendLocal} from "./proxy.js";

export function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

export function camelCaseToSnakeCase(str) {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1_$2').toUpperCase();
}

export function snakeCaseToCamelCase(str) {
    return str.toLowerCase()
        .replace(/(_)([a-z])/g, (_match, _p1, p2) => p2.toUpperCase())
}

export function merge(to, from) {
    for (const [k, v] of Object.entries(from)) {
        if (!to.hasOwnProperty(k))
            to[k] = v;
    }
    return to;
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve,  ms));
}

export function partition(items, size) {
    const result = [];

    if (size) {
        const n = Math.round(items.length / size);

        while (items.length > 0)
            result.push(items.splice(0, n));

        if (result.length > size) {
            result[result.length - 2] = [...result[result.length - 2], ...result[result.length - 1]];
            result.splice(result.length - 1, 1);
        }
    }

    return result;
}

export function chunk(items, size) {
    const chunks = [];
    let i = 0;

    while (i < items.length)
        chunks.push(items.slice(i, i += size));

    return chunks;
}

export function makeReferenceURL(uuid) {
    let referenceURL = `ext+scrapyard://${uuid}`;

    if (!_BACKGROUND_PAGE)
        referenceURL = browser.runtime.getURL(`/reference.html#${referenceURL}`);

    return referenceURL;
}

export function pathToNameExt(fullPath) {

    let startIndex = (fullPath.indexOf('\\') >= 0 ? fullPath.lastIndexOf('\\') : fullPath.lastIndexOf('/'));
    let dotIndex = fullPath.lastIndexOf('.');
    let file_name = fullPath.substring(startIndex, dotIndex);
    let file_ext = fullPath.substring(dotIndex + 1);

    if (file_name.indexOf('\\') === 0 || file_name.indexOf('/') === 0) {
        file_name = file_name.substring(1);
    }

    return {name: file_name, ext: file_ext};
}

export async function computeSHA1(text) {
    return hexString(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
}

export function hexString(buffer) {
    const byteArray = new Uint8Array(buffer);

    const hexCodes = [...byteArray].map(value => {
        const hexCode = value.toString(16);
        return hexCode.padStart(2, '0');
    });

    return hexCodes.join('');
}

// Extracting signature:

// contentType = "";
// binaryString = "";
// let signature = [];
// for (i = 0; i < byteArray.byteLength; i++) {
//     if (i < 4)
//         signature.push(byteArray[i].toString(16));
//     binaryString += String.fromCharCode(byteArray[i]);
// }
//
// signature = signature.join("").toUpperCase();
// contentType = getMimetype(signature);

export function getMimetype (signature) {
    switch (signature) {
        case '89504E47':
            return 'image/png';
        case '47494638':
            return 'image/gif';
        case '25504446':
            return 'application/pdf';
        case 'FFD8FFDB':
        case 'FFD8FFE0':
            return 'image/jpeg';
        case '504B0304':
            return 'application/zip';
        case '3C737667':
            return 'image/svg+xml';
        default:
            return null;
    }
}

export function getMimetypeByExt(url) {
    if (!url)
        return null;

    url = url.toLowerCase();

    if (url.endsWith(".png"))
        return "image/png";
    else if (url.endsWith(".bmp"))
        return "image/bmp";
    else if (url.endsWith(".gif"))
        return "image/gif";
    else if (url.endsWith(".tif") || url.endsWith(".tiff"))
        return "image/tiff";
    else if (url.endsWith(".jpg") || url.endsWith(".jpeg"))
        return "image/jpeg";
    else if (url.endsWith(".ico"))
        return "image/x-icon";
    else if (url.endsWith(".svg"))
        return "image/svg+xml";
    else if (url.endsWith(".webp"))
        return "image/webp";
    else if (url.endsWith(".webm"))
        return "video/webm";
    else if (url.endsWith(".mp4") || url.endsWith(".m4v"))
        return "video/mp4";
    else if (url.endsWith(".mpeg"))
        return "video/mpeg";
    else if (url.endsWith(".avi"))
        return "video/x-msvideo";
    else if (url.endsWith(".pdf"))
        return "application/pdf";
    else if (url.endsWith(".html") || url.endsWith(".htm"))
        return "text/html";
    else if (url.endsWith(".txt"))
        return "text/plain";
    else
        return "application/octet-stream";
}

export const IMAGE_FORMATS = [
    "image/png",
    "image/bmp",
    "image/gif",
    "image/tiff",
    "image/jpeg",
    "image/x-icon",
    "image/webp",
    "image/svg+xml"
];

export const CONTENT_TYPE_TO_EXT = {
    "text/html": "html",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "image/png": "png",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/tiff": "tiff",
    "image/jpeg": "jpg",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "image/webp": "webp",
    "image/svg+xml": "svg"
};

// https://stackoverflow.com/a/34920444/1689848
export function stringByteLengthUTF8(s) {
    if (!s)
        return 0;

    //assuming the String is UCS-2(aka UTF-16) encoded
    var n = 0;
    for (var i = 0, l = s.length; i < l; i++) {
        var hi = s.charCodeAt(i);
        if (hi < 0x0080) { //[0x0000, 0x007F]
            n += 1;
        }
        else if (hi < 0x0800) { //[0x0080, 0x07FF]
            n += 2;
        }
        else if (hi < 0xD800) { //[0x0800, 0xD7FF]
            n += 3;
        }
        else if (hi < 0xDC00) { //[0xD800, 0xDBFF]
            var lo = s.charCodeAt(++i);
            if (i < l && lo >= 0xDC00 && lo <= 0xDFFF) { //followed by [0xDC00, 0xDFFF]
                n += 4;
            }
        }
        else { //[0xE000, 0xFFFF]
            n += 3;
        }
    }
    return n;
}

// // https://stackoverflow.com/a/18650828/1689848
// export function formatBytes(bytes, decimals = 2) {
//     if (bytes === 0) return '0 Bytes';
//
//     const k = 1024;
//     const dm = decimals < 0 ? 0 : decimals;
//     const sizes = ['Bytes', 'KB', 'MB', 'GB']; // :)
//
//     const i = Math.floor(Math.log(bytes) / Math.log(k));
//
//     return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
// }

export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    let size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm)).toString();

    let [int, dec] = size.split(".");

    if (int.length > 2)
        size = Math.round(parseFloat(size));
    else if (dec && int.length === 2)
        size = Math.round((parseFloat(size) * 10)) / 10;

    return size + ' ' + sizes[i];
}

export function toHHMMSS (msecs) {
    let sec_num = Math.floor(msecs / 1000);
    let hours   = Math.floor(sec_num / 3600);
    let minutes = Math.floor(sec_num / 60) % 60;
    let seconds = sec_num % 60;

    return [hours,minutes,seconds]
        .map(v => v < 10 ? "0" + v : v)
        .filter((v,i) => v !== "00" || i > 0)
        .join(":");
}

export function cleanObject(object, forUpdate) {
    for (let key of Object.keys(object)) {
        if (object[key] === 0)
            continue;

        if (!object[key])
            if (forUpdate)
                object[key] = undefined;
            else
                delete object[key];
    }

    return object;
}

export function isDeepEqual(object1, object2, verbose) {
    object1 = {...object1};
    object2 = {...object2};

    let objKeys1 = Object.keys(object1);
    let objKeys2 = Object.keys(object2);

    for (const key of objKeys1)
        if (object1[key] === undefined)
            delete object1[key];

    for (const key of objKeys2)
        if (object2[key] === undefined)
            delete object2[key];

    objKeys1 = Object.keys(object1);
    objKeys2 = Object.keys(object2);

    if (objKeys1.length !== objKeys2.length) {
        if (verbose) {
            console.log("Missing keys:");
            for (const key of [...objKeys1])
                if (key in object2) {
                    delete object1[key];
                    delete object2[key];
                }

            console.log([...Object.keys(object1), ...Object.keys(object2)])
        }
        return false;
    }

    for (const key of objKeys1) {
        const value1 = object1[key];
        const value2 = object2[key];

        const isObjects = isObject(value1) && isObject(value2);

        if ((isObjects && !isDeepEqual(value1, value2)) || (!isObjects && value1 !== value2)) {
            if (verbose)
                console.log("Deep unequal key: %s", key);

            return false;
        }
    }
    return true;
}

function isObject(object) {
    return object != null && typeof object === "object";
}

export class ProgressCounter {
    constructor(total, message, payload = {}, local) {
        this._total = total;
        this._last = total - 1;
        this._message = message;
        this._payload = payload;
        this._lastProgress = 0;
        this._counter = 0;
        this._sender = local? sendLocal: send;
    }

    increment() {
        this._counter += 1
    }

    notify(progress, payload={}) {
        if (!progress) {
            progress = Math.round((this._counter / this._total) * 100);
            if (progress !== this._lastProgress) {
                this._lastProgress = progress;
                this._sender[this._message](Object.assign({progress}, this._payload, payload));
            }
        }
        else if (progress) {
            this._sender[this._message](Object.assign({progress}, this._payload, payload));
        }
    }

    incrementAndNotify(payload={}) {
        this.increment();
        this.notify(null, payload);
    }

    finish() {
        this.notify(100, {finished: true});
    }

    isFinished() {
        return this._counter === this._total;
    }

    isLast() {
        return this._counter === this._last;
    }
}

export class ParallelProcessor {
    #errors;
    #cancelled;
    #progressCounter;
    #threadCount;
    #processorf;
    #resolveResult;

    constructor(processorf) {
        this.#processorf = processorf;
    }

    async process(items, maxThreads, message) {
        items = [...items];
        this.#threadCount = Math.min(maxThreads, items.length);
        this.#progressCounter = new ProgressCounter(items.length, message);

        const resultPromise = new Promise(resolve => this.#resolveResult = resolve);
        for (let i = 0; i < maxThreads; ++i)
            this.#thread(items);

        return resultPromise;
    }

    async #thread(items) {
        if (items.length && !this.#cancelled) {
            let item = items.shift();

            try {
                await this.#processorf(item);
            } catch (e) {
                console.error(e);
                this.#errors = true;
            }

            this.#progressCounter.incrementAndNotify();

            return this.#thread(items);
        }
        else {
            this.#threadCount -= 1;
            if (this.#threadCount === 0)
                return this.#onFinish();
        }
    }

    async #onFinish() {
        this.#progressCounter.finish();
        this.#resolveResult(!this.#errors);
    }
}
