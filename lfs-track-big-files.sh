#!/usr/bin/env sh
#
# Moves big files to LFS, so they take no space in the Git repo

find http https -size +1M -exec git lfs track {} \;
