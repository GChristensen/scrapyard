@echo off
set PYTHONPATH=%~dp0
set PATH=D:\software\dev\python;%PATH%
python -u -c "import scrapyard.backend; scrapyard.backend.main()"
