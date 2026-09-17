// derived from: https://github.com/bpedroza/js-pkce and https://github.com/aaronpk/pkce-vanilla-js

/**
 * Initialize the instance with configuration
 * @param {IConfig} config
 */
export function PKCE(config) {
    this.state = '';
    this.codeVerifier = '';
    this.config = config;
}
/**
 * Generate the authorize url
 * @param  {object} additionalParams include additional parameters in the query
 * @return Promise<string>
 */
PKCE.prototype.getAuthorizationUrl = async function (additionalParams) {
    if (additionalParams === void 0) { additionalParams = {}; }
    // a new state and code verifier are generated for each authorization attempt,
    // reusing them across attempts leads to state mismatch errors
    this.state = additionalParams.state || generateRandomString();
    this.codeVerifier = generateRandomString();
    var codeChallenge = await this.pkceChallengeFromVerifier();
    var queryString = new URLSearchParams(Object.assign({
        response_type: 'code',
        response_mode: 'query',
        client_id: this.config.client_id,
        state: this.state,
        scope: this.config.requested_scopes,
        redirect_uri: this.config.redirect_uri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    }, additionalParams)).toString();
    return this.config.authorization_endpoint + "?" + queryString;
};
/**
 * Given the return url, get a token from the oauth server
 * @param  url current urlwith params from server
 * @param  {object} additionalParams include additional parameters in the request body
 * @return {Promise<ITokenResponse>}
 */
PKCE.prototype.exchangeForAccessToken = function (url, additionalParams) {
    var _this = this;
    if (additionalParams === void 0) { additionalParams = {}; }
    return this.parseAuthResponseUrl(url).then(function (q) {
        return fetch(_this.config.token_endpoint, {
            method: 'POST',
            body: new URLSearchParams(Object.assign({
                grant_type: 'authorization_code',
                code: q.code,
                client_id: _this.config.client_id,
                redirect_uri: _this.config.redirect_uri,
                code_verifier: _this.getCodeVerifier(),
            }, additionalParams)),
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
        }).then(function (response) { return response.json(); });
    });
};

PKCE.prototype.refreshAccessToken = function (refreshToken, additionalParams) {
    var _this = this;
    if (additionalParams === void 0) { additionalParams = {}; }
    return fetch(_this.config.token_endpoint, {
        method: 'POST',
        body: new URLSearchParams(Object.assign({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: _this.config.client_id,
            redirect_uri: _this.config.redirect_uri,
            scope: this.config.requested_scopes
        }, additionalParams)),
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
    }).then(function (response) { return response.json(); });
};

/**
 * Get the code verifier of the current authorization attempt
 * @return {string}
 */
PKCE.prototype.getCodeVerifier = function () {
    return this.codeVerifier;
};
/**
 * Get the state of the current authorization attempt
 * @return {string}
 */
PKCE.prototype.getState = function () {
    return this.state;
};
/**
 * Get the query params as json from a auth response url
 * @param  {string} url a url expected to have AuthResponse params
 * @return {Promise<IAuthResponse>}
 */
PKCE.prototype.parseAuthResponseUrl = function (url) {
    var params = new URL(url).searchParams;
    return this.validateAuthResponse({
        error: params.get('error'),
        query: params.get('query'),
        state: params.get('state'),
        code: params.get('code'),
    });
};
/**
 * Generate a code challenge
 * @return {Promise<string>}
 */
PKCE.prototype.pkceChallengeFromVerifier = async function () {
    var hashed = await sha256(this.getCodeVerifier());
    return base64urlencode(hashed);
};
/**
 * Validates params from auth response
 * @param  {AuthResponse} queryParams
 * @return {Promise<IAuthResponse>}
 */
PKCE.prototype.validateAuthResponse = function (queryParams) {
    var _this = this;
    return new Promise(function (resolve, reject) {
        if (queryParams.error) {
            return reject({ error: queryParams.error });
        }
        if (!_this.state || queryParams.state !== _this.getState()) {
            return reject({ error: 'Invalid State' });
        }
        return resolve(queryParams);
    });
};

// Generate a secure random string using the browser crypto functions
function generateRandomString() {
    var array = new Uint32Array(28);
    crypto.getRandomValues(array);
    return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
}

// Calculate the SHA256 hash of the input text.
// Returns a promise that resolves to an ArrayBuffer
function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
}

// Base64-urlencodes the input string
function base64urlencode(str) {
    // Convert the ArrayBuffer to string using Uint8 array to conver to what btoa accepts.
    // btoa accepts chars only within ascii 0-255 and base64 encodes them.
    // Then convert the base64 encoded to base64url encoded
    //   (replace + with -, replace / with _, trim trailing =)
    return btoa(String.fromCharCode.apply(null, new Uint8Array(str)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
