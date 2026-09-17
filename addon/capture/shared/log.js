// The only logging path of the engine. Silent unless debugging is on or the level is "error".

const TAG = "[scrapyard capture]";

let debug = false;

/** @param {boolean} value */
export function setDebug(value) {
    debug = !!value;
}

/** @returns {boolean} */
export function isDebug() {
    return debug;
}

/**
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param  {...any} args
 */
export function log(level, ...args) {
    if (level === "error")
        console.error(TAG, ...args);
    else if (debug) {
        if (level === "warn")
            console.warn(TAG, ...args);
        else
            console.log(TAG, ...args);
    }
}
