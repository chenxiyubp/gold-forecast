"""Align uncompressed APK entries without the native Windows ZIP writer.

The result is independently checked by the Android SDK zipalign tool before signing.
No native libraries are packaged by this application.
"""
import struct
import sys
import zipfile
from pathlib import Path

source, destination = map(Path, sys.argv[1:3])
if source.resolve() == destination.resolve():
    raise SystemExit('Input and output must differ')
with zipfile.ZipFile(source) as src, zipfile.ZipFile(destination, 'w') as dst:
    for original in src.infolist():
        info = zipfile.ZipInfo(original.filename, original.date_time)
        info.compress_type = original.compress_type
        info.external_attr = original.external_attr
        info.extra = original.extra
        info.comment = original.comment
        if info.compress_type == zipfile.ZIP_STORED:
            offset = dst.fp.tell() + 30 + len(info.filename.encode('utf-8')) + len(info.extra)
            if offset % 4:
                padding = (-offset - 4) % 4
                info.extra += struct.pack('<HH', 0xFFFF, padding) + b'\0' * padding
        dst.writestr(info, src.read(original.filename))
with zipfile.ZipFile(destination) as check:
    if check.testzip() is not None:
        raise SystemExit('APK archive integrity verification failed')
print('APK entries aligned; archive integrity verified')
