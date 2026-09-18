# uses git shell
set windows-shell := ["sh", "-c"]

test:
    just firefox-mv2
    cd addon && cmd //c start web-ext run -p "${FIREFOX_PROFILES}/debug.scrapyard" --keep-profile-changes

test-nightly:
    cd addon && cmd //c start web-ext run -p "${FIREFOX_PROFILES}/debug.scrapyard.nightly" --firefox=nightly --keep-profile-changes

# leaves the Chrome manifest in place, use `just firefox-mv2` to restore the Firefox one
# Chrome writes indexed declarativeNetRequest rulesets to addon/_metadata on each load,
# watching it makes web-ext reload the extension endlessly
test-chrome:
    just chrome-mv3
    mkdir -p "${FIREFOX_PROFILES}/debug.scrapyard.chrome"
    cd addon && cmd //c start web-ext run -t chromium --chromium-profile "${FIREFOX_PROFILES}/debug.scrapyard.chrome" --keep-profile-changes -i "_metadata" "_metadata/**/*"

set-version version:
    echo {{version}} > ./addon/version.txt

get-version:
    @cat ./addon/version.txt

build:
    cd addon && python ../scripts/mkmanifest.py manifest.json.mv2 manifest.json `cat version.txt` --public
    cd addon && web-ext build -a ../build -i web-ext-artifacts .web-extension-id _metadata version.txt
    just firefox-mv2

build-chrome:
    just chrome-mv3
    rm -f build/scrapyard-chrome-*.zip
    7za a build/scrapyard-chrome-`cat ./addon/version.txt`.zip ./addon/* -xr!web-ext-artifacts -xr!.web-extension-id -xr!_metadata -xr!*.mv2* -xr!*.mv3*

sign:
    just firefox-mv2
    cd addon && web-ext sign --channel unlisted -a ../build -i web-ext-artifacts .web-extension-id _metadata version.txt `cat $HOME/.amo/creds`

firefox-mv2:
    cd addon && python ../scripts/mkmanifest.py manifest.json.mv2 manifest.json `cat version.txt`

firefox-mv3:
    cd addon && python ../scripts/mkmanifest.py manifest.json.mv3 manifest.json `cat version.txt`

chrome-mv3:
    cd addon && python ../scripts/mkmanifest.py manifest.json.mv3.chrome manifest.json `cat version.txt`

backend-clean:
    cd backend && rm -r -f python-dist

# to create .local/python-dist
# 1. download embeddable Python zip
# 2. add pip with get-pip.py
# 3. uncomment "import site" in the pythonXYZ._pth file so pip-installed packages
#    (and the scrapyard package installed by `backend-win` below) are importable
# keep pip in place - `backend-win` uses it on every build to (re)install scrapyard
# 4. Update pip: python.exe -m pip install --upgrade pip
# 5. Get "incude" and "libs" dirs from a regular python dist of the same version:
#       winget install Microsoft.NuGet
#       nuget install python -Version 3.XX.XX -OutputDirectory .
# 6. Install setuptools.

backend-win:
    just backend-clean
    cd backend && rm -f *.exe
    echo "DEBUG = False" > ./backend/scrapyard/server_debug.py
    cp -r ./.local/python-dist ./backend/
    cd backend && ./python-dist/python.exe -m pip install --force-reinstall .
    cd backend && makensis setup.nsi
    just backend-clean
    echo "DEBUG = True" > ./backend/scrapyard/server_debug.py

backend-cli:
    cd backend && cp -r ./scrapyard ./cli-installer/scrapyard_backend/
    echo "DEBUG = False" > ./backend/cli-installer/scrapyard_backend/scrapyard/server_debug.py
    cd backend && cp -r ./manifests ./cli-installer/scrapyard_backend/
    cd backend && rm -r -f ./cli-installer/scrapyard_backend/manifests/debug_manifest*
    cd backend && cp -r ./pyproject.toml ./cli-installer/scrapyard_backend/
    cd backend && cp -r ./server ./cli-installer/scrapyard_backend/
    cd backend && rm -f scrapyard-backend.tgz
    cd backend && 7za.exe a -ttar -so -an ./cli-installer/* -xr!__pycache__ | 7za.exe a -si scrapyard-backend.tgz
    cd backend && rm ./cli-installer/scrapyard_backend/pyproject.toml
    cd backend && rm -r -f ./cli-installer/scrapyard_backend/scrapyard
    cd backend && rm -r -f ./cli-installer/scrapyard_backend/manifests
    cd backend && rm -r -f ./cli-installer/scrapyard_backend/server
