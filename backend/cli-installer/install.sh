#!/bin/sh
if [ `id -u` -eq 0 ]
  then echo "Please run in a non-elevated shell."
  exit
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

python3 "${SCRIPT_DIR}/scrapyard_backend/installer.py"
