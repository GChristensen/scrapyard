1. Make sure that you have Python 3.7+ installed. You can check this by
   opening terminal and issuing the following command: python3 --version
   on Linux/MacOS or python --version on Windows.
2. On Linux/MacOS make sure that you have venv and pip Python modules
   by executing the following commands:
      python3 -m pip --version
      python3 -m venv --help
   You may need to install additional operating system packages if they are
   missing.
3. Place the contents of this folder into a directory where you want
   the Scrapyard backend application to be installed, for example:
   ~/bin/scrapyard_backend
4. In your terminal, change to this directory using the cd command.
   For example: cd ~/bin/scrapyard_backend
5. Execute ./install.sh to install the Scrapyard backend application on Linux
   or MacOS as a regular user.
6. Execute install.cmd in an elevated (admin) shell to install the Scrapyard
   backend application on Windows.

The application will be permanently installed in the directory where the
install.sh script resides. Only Firefox and Chrome (Chromium) browsers are
supported out of the box. You may need to place the native messaging manifest
to the correct location if you are using another browser.
