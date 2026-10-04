#!/usr/bin/env bash

# The fetch-verify-extract-verify core shared by fetch-web-media.sh and fetch-test-media.sh. Sourced,
# not run directly.
#
# Materializes the assets a manifest describes from a prebuilt bundle over plain HTTPS, replacing the
# checkout's Git LFS pointer files. Fetching a bundle keeps CI and deploys off the Git LFS bandwidth
# budget, which this repo has exhausted: LFS downloads return 403, and `git lfs pull` reports success
# while materializing nothing.
#
# Every asset is checked before and after the fetch. An earlier version trusted a single sentinel file,
# so a checkout where only *some* media was real skipped the fetch and the build silently shipped
# pointer files in place of videos. Content is checked too, not just "is not a pointer": a truncated or
# stale bundle extracts cleanly and would otherwise surface as an opaque FFmpeg decode error.

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/ci/media-bundle.sh
source "$script_dir/media-bundle.sh"

# $1 = bundle asset name, $2 = manifest default (repo-relative), $3.. = optional members to extract.
media_fetch_bundle() {
  local asset=$1 default_manifest=$2
  shift 2

  local repo_root manifest label
  repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
  manifest="${CI_MEDIA_MANIFEST:-$repo_root/$default_manifest}"
  label=${asset%.tar.gz}

  fail() {
    printf 'error: %s\n' "$1" >&2
    exit 1
  }

  [ -f "$manifest" ] || fail "media manifest not found: $manifest"

  local total
  total=$(media_manifest_paths "$manifest" | grep -c '' || true)
  [ "$total" -gt 0 ] || fail "media manifest has no entries: $manifest"

  # Partial extraction (the Rust job needs one fixture) narrows what counts as present and as verified.
  # macOS runners are on bash 3.2, where "${wanted[@]}" on an empty array trips `set -u` — hence the
  # ${wanted[@]+…} guard at every expansion below.
  local -a wanted=("$@")
  local scope_desc="$total assets"
  if [ "${#wanted[@]}" -gt 0 ]; then
    scope_desc="${#wanted[@]} of $total assets"
  fi

  # Two views of the same check. `absent` covers the whole manifest and is what tells a pointer apart
  # from a local edit below; `missing` is narrowed to the requested members and decides the fetch.
  local absent missing
  absent=$(media_unmaterialized "$manifest" "$repo_root")
  missing=$absent
  if [ "${#wanted[@]}" -gt 0 ] && [ -n "$missing" ]; then
    missing=$(printf '%s\n' "$missing" | grep -Fx -f <(printf '%s\n' "${wanted[@]}") || true)
  fi

  # A tree that is already whole still has to match the manifest by content, or a stale checkout
  # silently skips the fetch it needs.
  if [ -z "$missing" ] && media_verify_digests "$manifest" "$repo_root" ${wanted[@]+"${wanted[@]}"} 2>/dev/null; then
    echo "$label already materialized ($scope_desc verified) — skipping bundle fetch"
    return 0
  fi

  # Anything present, real, and simply the wrong bytes is a local edit, not a pointer to fill in — and
  # the extract below would overwrite it. Fresh CI clones are all pointers, but cached Pages builds
  # can hold older real bytes (fetch-web-media opts those disposable builds into replacement). A
  # developer previewing a new cut through `pnpm --filter @leclap/web build` does. Losing their file
  # silently is not acceptable, so stop and make it their call.
  local modified='' candidates
  # Only members that will actually be extracted can be clobbered, so scope this the same way.
  candidates=$(media_manifest_paths "$manifest")
  if [ "${#wanted[@]}" -gt 0 ]; then
    candidates=$(printf '%s\n' "$candidates" | grep -Fx -f <(printf '%s\n' "${wanted[@]}") || true)
  fi

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    # Absent or still a pointer: nothing of the developer's to lose. Fill it in silently, or every
    # fresh clone and every CI run would demand an override.
    printf '%s\n' "$absent" | grep -Fqx -- "$path" && continue
    media_verify_digests "$manifest" "$repo_root" "$path" > /dev/null 2>&1 && continue
    modified+="    $path"$'\n'
  done < <(printf '%s\n' "$candidates")

  if [ -n "$modified" ] && [ "${MEDIA_ALLOW_OVERWRITE:-}" != '1' ]; then
    fail "these files differ from the manifest and would be overwritten by the bundle:
${modified%$'\n'}
  They exist and hold real media, so this is a local change rather than an LFS pointer to fill in.
  Pick one:
    - keep them:    bash scripts/ci/update-media-manifest.sh   (then republish the bundles)
    - discard them: re-run with MEDIA_ALLOW_OVERWRITE=1"
  fi

  local url
  url=$(media_bundle_url "$manifest" "$asset")
  echo "fetching ${url} (${scope_desc})"

  # Deliberately not `local`: the EXIT trap fires after this function has returned, so a local would
  # be out of scope and `set -u` would turn any failure into a confusing "unbound variable".
  media_fetch_tmp=$(mktemp -d "${TMPDIR:-/tmp}/${label}.XXXXXX")
  trap 'rm -rf "$media_fetch_tmp"' EXIT

  local tmp=$media_fetch_tmp

  # --speed-limit/--speed-time abort a stalled transfer without capping a legitimately slow one; a
  # bare --max-time would have to be generous enough for 289 MB and so would not catch a hang.
  if ! curl -fsSL --retry 3 --retry-delay 2 \
    --connect-timeout 20 --speed-limit 1024 --speed-time 120 -o "$tmp/$asset" "$url"; then
    # Git LFS returns 403 for this repo, so there is no fallback to suggest. Name both plausible
    # causes: a republish cannot help a rate-limited host, and rate limiting is a predicted failure
    # mode of the r2.dev development URL this currently resolves to.
    fail "could not download ${asset} from ${url}
  Either the object is missing, or the host refused/stalled the request.
    - rate-limited or unreachable host: retry; if it persists, this is the r2.dev development URL
      hitting its limits — move the bucket to a custom domain (see MEDIA_R2_ORIGIN), or set
      CI_MEDIA_BASE_URL to the ci-assets-v1 GitHub Release to roll back.
    - genuinely missing object: rebuild and republish from a checkout with the media materialized:
          bash scripts/ci/build-media-bundles.sh
          bash scripts/ci/publish-media-bundles.sh
  Do not delete this object: every CI run and web deploy depends on it."
  fi

  # A bundle truncated in transit or by a partial upload dies here rather than at the digest check
  # below, so it needs the same guidance — otherwise CI just prints "truncated gzip input".
  tar -xzf "$tmp/$asset" -C "$repo_root" ${wanted[@]+"${wanted[@]}"} || fail "could not extract ${asset} from ${url}
  The bundle is corrupt or truncated. Rebuild and republish it from a checkout with the media present:
      bash scripts/ci/build-media-bundles.sh
      bash scripts/ci/publish-media-bundles.sh"

  local still_missing
  still_missing=$(media_unmaterialized "$manifest" "$repo_root")
  if [ "${#wanted[@]}" -gt 0 ] && [ -n "$still_missing" ]; then
    still_missing=$(printf '%s\n' "$still_missing" | grep -Fx -f <(printf '%s\n' "${wanted[@]}") || true)
  fi

  if [ -n "$still_missing" ]; then
    fail "bundle ${asset} did not satisfy the manifest — still unmaterialized:
$(printf '%s\n' "$still_missing" | sed 's/^/    /')
  Rebuild it from a checkout with the media present: bash scripts/ci/build-media-bundles.sh"
  fi

  media_verify_digests "$manifest" "$repo_root" ${wanted[@]+"${wanted[@]}"} || fail "bundle ${asset} is stale or truncated.
  It extracted cleanly but its contents do not match the manifest it is addressed by. Rebuild and
  republish from a checkout with the media present:
      bash scripts/ci/build-media-bundles.sh
      bash scripts/ci/publish-media-bundles.sh"

  echo "extracted $label into ${repo_root} ($scope_desc verified)"
}
