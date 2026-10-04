#!/usr/bin/env bash
set -euo pipefail

# Covers the guards that failed us in practice:
#   - the fetcher used to decide "already materialized" from a single sentinel file, so a checkout
#     where only *some* media was real passed straight through and the build shipped LFS pointers;
#   - a bundle was trusted once it extracted, so a stale or truncated one became an FFmpeg decode
#     error at render time instead of a build failure here.
# These tests drive both fetchers against fake bundles served from disk (CI_MEDIA_BASE_URL is a file://
# URL) so nothing here touches the network.

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fetcher="$script_dir/fetch-web-media.sh"
test_fetcher="$script_dir/fetch-test-media.sh"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# shellcheck source=scripts/ci/media-bundle.sh
source "$script_dir/media-bundle.sh"

fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }

pointer() {
  printf 'version https://git-lfs.github.com/spec/v1\noid sha256:%064d\nsize 4\n' 0
}

content() { printf 'real bytes for %s\n' "$1"; }

# The "release": a tarball holding real bytes for every manifest entry.
bundle_root="$tmp_dir/bundle-src"
mkdir -p "$bundle_root/media"
for f in a.mp4 b.mp4 c.mp3; do content "$f" > "$bundle_root/media/$f"; done
serve_dir="$tmp_dir/serve"
mkdir -p "$serve_dir"
tar -czf "$serve_dir/web-media.tar.gz" -C "$bundle_root" media
cp "$serve_dir/web-media.tar.gz" "$serve_dir/ci-test-media.tar.gz"

manifest="$tmp_dir/manifest.txt"
{
  echo '# two clips, one sound'
  for f in a.mp4 b.mp4 c.mp3; do
    printf '%s  media/%s\n' "$(media_sha256 "$bundle_root/media/$f")" "$f"
  done
} > "$manifest"

make_repo() { # $1 = dir, $2... = files that should be LFS pointers rather than real
  local dir=$1; shift
  rm -rf "$dir"; mkdir -p "$dir/media"
  for f in a.mp4 b.mp4 c.mp3; do content "$f" > "$dir/media/$f"; done
  for f in "$@"; do pointer > "$dir/media/$f"; done
}

run() { # $1 = repo root
  REPO_ROOT="$1" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$serve_dir" bash "$fetcher" 2>&1
}

# 1. Everything already real → no download, exits 0.
repo="$tmp_dir/repo-complete"
make_repo "$repo"
out=$(run "$repo") || fail 'complete checkout should succeed'
[[ $out == *'already materialized'* ]] || fail "complete checkout should skip the fetch, got: $out"

# 2. THE REGRESSION: only one file is a pointer. The old single-sentinel check skipped here.
repo="$tmp_dir/repo-partial"
make_repo "$repo" b.mp4
out=$(run "$repo") || fail "partial checkout should self-heal, got: $out"
[[ $out != *'already materialized'* ]] || fail 'partial checkout must NOT skip the fetch'
grep -q 'real bytes for b.mp4' "$repo/media/b.mp4" || fail 'partial checkout did not get real bytes'

# 3. A fully pointer-ised checkout (what GIT_LFS_SKIP_SMUDGE=1 produces) is filled in.
repo="$tmp_dir/repo-pointers"
make_repo "$repo" a.mp4 b.mp4 c.mp3
run "$repo" > /dev/null || fail 'pointer checkout should be filled from the bundle'
for f in a.mp4 b.mp4 c.mp3; do
  grep -q "real bytes for $f" "$repo/media/$f" || fail "$f was not materialized"
done

# 4. Missing bundle → non-zero exit and an error naming the rebuild path, not a silent pass.
repo="$tmp_dir/repo-nobundle"
make_repo "$repo" a.mp4
set +e
out=$(REPO_ROOT="$repo" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$tmp_dir/nowhere" bash "$fetcher" 2>&1)
status=$?
set -e
[[ $status -ne 0 ]] || fail 'missing bundle must fail the build'
[[ $out == *'build-media-bundles.sh'* ]] || fail "missing-bundle error should say how to rebuild, got: $out"

# 5. A bundle that does not satisfy the manifest fails loudly instead of leaving pointers behind.
short_serve="$tmp_dir/serve-short"
mkdir -p "$short_serve" "$tmp_dir/short-src/media"
content a.mp4 > "$tmp_dir/short-src/media/a.mp4"
tar -czf "$short_serve/web-media.tar.gz" -C "$tmp_dir/short-src" media
repo="$tmp_dir/repo-short"
make_repo "$repo" a.mp4 b.mp4
set +e
out=$(REPO_ROOT="$repo" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$short_serve" bash "$fetcher" 2>&1)
status=$?
set -e
[[ $status -ne 0 ]] || fail 'incomplete bundle must fail the build'
[[ $out == *'media/b.mp4'* ]] || fail "error should name the unsatisfied asset, got: $out"

# 6. A STALE bundle: every file present, none a pointer, but the bytes are from another revision.
#    This extracts cleanly and used to pass — it is the case digests exist to catch.
stale_serve="$tmp_dir/serve-stale"
mkdir -p "$stale_serve" "$tmp_dir/stale-src/media"
for f in a.mp4 c.mp3; do content "$f" > "$tmp_dir/stale-src/media/$f"; done
printf 'bytes from an older revision\n' > "$tmp_dir/stale-src/media/b.mp4"
tar -czf "$stale_serve/web-media.tar.gz" -C "$tmp_dir/stale-src" media
cp "$stale_serve/web-media.tar.gz" "$stale_serve/ci-test-media.tar.gz"
repo="$tmp_dir/repo-stale"
make_repo "$repo" a.mp4 b.mp4 c.mp3
set +e
out=$(REPO_ROOT="$repo" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$stale_serve" bash "$fetcher" 2>&1)
status=$?
set -e
[[ $status -ne 0 ]] || fail 'a stale bundle must fail the build'
[[ $out == *'media/b.mp4'* ]] || fail "stale-bundle error should name the asset, got: $out"

# 7. A real file whose bytes differ is a local edit, not a pointer to fill. Overwriting it during a
#    routine `pnpm build` would destroy uncommitted work, so it must stop and say so.
repo="$tmp_dir/repo-drifted"
make_repo "$repo"
printf 'locally modified\n' > "$repo/media/c.mp3"
set +e
out=$(run "$repo"); status=$?
set -e
[[ $status -ne 0 ]] || fail 'a locally modified asset must not be silently overwritten'
[[ $out == *'media/c.mp3'* ]] || fail "the guard should name the file at risk, got: $out"
[[ $out == *'update-media-manifest.sh'* ]] || fail "the guard should offer the keep-it path, got: $out"
grep -q 'locally modified' "$repo/media/c.mp3" || fail 'the local edit was clobbered despite the guard'

# ...and the escape hatch works, because sometimes you do want the published bytes back.
out=$(REPO_ROOT="$repo" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$serve_dir" \
  MEDIA_ALLOW_OVERWRITE=1 bash "$fetcher" 2>&1) || fail "explicit override should proceed, got: $out"
grep -q 'real bytes for c.mp3' "$repo/media/c.mp3" || fail 'override did not restore the published bytes'

# A pointer file is NOT a local edit — filling it in must stay silent and automatic, or every CI run
# and every fresh clone would demand an override.
repo="$tmp_dir/repo-pointer-only"
make_repo "$repo" c.mp3
out=$(run "$repo") || fail "a pointer must be filled without an override, got: $out"
grep -q 'real bytes for c.mp3' "$repo/media/c.mp3" || fail 'pointer was not materialized'

# 8. Partial extraction: the Rust job asks for one member and must verify exactly that one.
repo="$tmp_dir/repo-single"
make_repo "$repo" a.mp4 b.mp4 c.mp3
out=$(REPO_ROOT="$repo" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$serve_dir" \
  bash "$test_fetcher" media/a.mp4 2>&1) || fail "single-member fetch should succeed, got: $out"
grep -q 'real bytes for a.mp4' "$repo/media/a.mp4" || fail 'requested member was not materialized'
head -1 "$repo/media/b.mp4" | grep -q 'git-lfs' || fail 'unrequested member should be left alone'

# ...and must still fail when the member it asked for is the corrupt one.
set +e
out=$(REPO_ROOT="$repo" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$stale_serve" \
  bash "$test_fetcher" media/b.mp4 2>&1)
status=$?
set -e
[[ $status -ne 0 ]] || fail 'single-member fetch must verify the member it extracted'
[[ $out == *'media/b.mp4'* ]] || fail "single-member failure should name the asset, got: $out"

# 9. Pages may restore stale real media from build caches. Its disposable checkout should refresh
#    those bytes from the digest-verified bundle, while local builds keep the edit guard above.
repo="$tmp_dir/repo-pages-cache"
make_repo "$repo"
printf 'stale Pages cache bytes\n' > "$repo/media/c.mp3"
out=$(CF_PAGES=1 run "$repo") || fail "Pages should refresh stale cached media, got: $out"
media_verify_digests "$manifest" "$repo" || fail 'Pages refresh must still match every manifest digest'

# An explicit opt-out keeps the guard even under Pages.
printf 'protected edit\n' > "$repo/media/c.mp3"
set +e
out=$(CF_PAGES=1 MEDIA_ALLOW_OVERWRITE=0 run "$repo"); status=$?
set -e
[[ $status -ne 0 ]] || fail 'explicit Pages opt-out should protect existing media'
grep -q 'protected edit' "$repo/media/c.mp3" || fail 'explicit opt-out was ignored'

# An automatic refresh must never accept a stale downloaded bundle.
repo="$tmp_dir/repo-pages-bad-bundle"
make_repo "$repo"
printf 'stale Pages cache bytes\n' > "$repo/media/c.mp3"
set +e
out=$(REPO_ROOT="$repo" CI_MEDIA_MANIFEST="$manifest" CI_MEDIA_BASE_URL="file://$stale_serve" \
  CF_PAGES=1 bash "$fetcher" 2>&1); status=$?
set -e
[[ $status -ne 0 ]] || fail 'Pages refresh must reject a bundle with the wrong digest'
[[ $out == *'stale or truncated'* ]] || fail "Pages should report digest mismatch, got: $out"

printf 'all fetch-media tests passed\n'
