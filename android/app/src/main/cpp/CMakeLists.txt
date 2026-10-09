cmake_minimum_required(VERSION 3.22.1)
project(vantara_torrent_bytes C)
add_library(vantara_torrent_bytes SHARED torrent_bytes.c)
# Both ELF LOAD alignment and APK packaging are validated separately for 16KB devices.
target_link_options(vantara_torrent_bytes PRIVATE "-Wl,-z,max-page-size=16384")
