#!/usr/bin/env bash
# Mirror the modern sing-box RU rule-sets at /rulesets/ru/*.srs.
# Run on each Arrow update mirror host (or sync the generated files to them).
set -Eeuo pipefail
DEST="${1:-/srv/arrow-updates/rulesets/ru}"
SRC_GEOSITE='https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ru.srs'
SRC_GEOIP='https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 60 "$SRC_GEOSITE" -o "$TMP/geosite-category-ru.srs"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 60 "$SRC_GEOIP" -o "$TMP/geoip-ru.srs"
python3 - "$TMP" <<'PY'
import pathlib,sys,zlib
p=pathlib.Path(sys.argv[1])
for name in ('geosite-category-ru.srs','geoip-ru.srs'):
    data=(p/name).read_bytes()
    assert 12 <= len(data) <= 4*1024*1024 and data[:3] == b'SRS' and 1 <= data[3] <= 10, f'Invalid header: {name}'
    assert zlib.decompress(data[4:]), f'Invalid compressed rule-set: {name}'
    print('Validated',name,len(data),'bytes')
PY
# Existing working files remain intact if a download/validation fails.
for NAME in geosite-category-ru.srs geoip-ru.srs; do
  install -m 644 "$TMP/$NAME" "$DEST/.$NAME.new"
  mv -f "$DEST/.$NAME.new" "$DEST/$NAME"
done
( cd "$DEST" && sha256sum geosite-category-ru.srs geoip-ru.srs > SHA256SUMS )
echo "Published rule-sets to $DEST"
