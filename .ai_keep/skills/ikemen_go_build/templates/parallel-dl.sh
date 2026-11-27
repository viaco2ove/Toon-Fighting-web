#!/usr/bin/env bash
# 限速网络下的分段并行下载器：单连接 ~45KB/s 时，N 段并行可到 ~150KB/s
# 用法：parallel-dl.sh <url> <总字节数> <输出文件> [段数=16]
# 总字节数先用 curl -sI <url> | grep -i content-length 拿。
set -euo pipefail
URL="$1"; TOTAL="$2"; OUT="$3"; N="${4:-16}"
CHUNK=$(( (TOTAL + N - 1) / N ))
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
for i in $(seq 0 $((N-1))); do
  s=$((i * CHUNK)); e=$((s + CHUNK - 1))
  [ "$e" -ge "$TOTAL" ] && e=$((TOTAL - 1))
  printf '%02d %d %d\n' "$i" "$s" "$e"
done > "$DIR/ranges.txt"
while read -r i s e; do
  echo "chunk $i: $s-$e"
  curl -sSL --fail --retry 5 --retry-delay 2 -r "$s-$e" -o "$DIR/part$i" "$URL" &
done < "$DIR/ranges.txt"
wait
# 段可能因网络抖动缺字节：校验每段大小，短了单独补
ok=1
while read -r i s e; do
  want=$((e - s + 1)); have=$(stat -c%s "$DIR/part$i" 2>/dev/null || echo 0)
  if [ "$have" != "$want" ]; then
    echo "chunk $i incomplete ($have/$want), redownloading..."
    curl -sSL --fail --retry 5 -r "$s-$e" -o "$DIR/part$i" "$URL"
  fi
done < "$DIR/ranges.txt"
cat $(for i in $(seq 0 $((N-1))); do printf '%s/part%02d ' "$DIR" "$i"; done) > "$OUT"
got=$(stat -c%s "$OUT")
echo "downloaded: $got / $TOTAL"
[ "$got" = "$TOTAL" ] || { echo "SIZE MISMATCH"; exit 1; }
