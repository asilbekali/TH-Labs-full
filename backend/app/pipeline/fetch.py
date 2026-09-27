"""Fetch a dubbing source from a URL the user pasted.

The Studio's second way in. Uploading a file is the first; this is "paste a
YouTube link and dub it", which is what people actually have on hand when the
video is already published somewhere.

Two backends, in order:

1. **yt-dlp** when it is installed — the only realistic way to resolve a
   YouTube/Vimeo/TikTok watch page to a media stream, and it also handles a
   plain ``https://…/clip.mp4`` through its generic extractor. Optional
   dependency (see requirements.txt): without it link jobs are refused with a
   message that says so, rather than the feature silently half-working.
2. A direct HTTP download, used only when yt-dlp is absent. It can fetch a
   direct media file and nothing else, so a watch-page URL gets an honest
   error instead of a saved HTML page that the pipeline would later fail to
   decode.

### Why this module is defensive

The server fetches a URL chosen by the caller, which is server-side request
forgery by construction. Every request is therefore checked before it is made:

* scheme must be http/https — no ``file://``, ``gopher://``, ``data:``;
* the resolved address must be public — loopback, private, link-local
  (169.254.169.254, the cloud metadata endpoint) and reserved ranges are all
  refused, on every address the name resolves to;
* redirects are followed manually so each hop is re-checked — a public host
  that 302s to 127.0.0.1 is the standard bypass;
* the download is capped by size and the media by duration, so a link cannot
  be used to fill the disk or to book hours of GPU time in one request.

None of this is optional hardening. `POST /api/jobs` is reachable by any
signed-in account.
"""
from __future__ import annotations

import ipaddress
import logging
import re
import shutil
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

# A dub is billed per minute of audio and runs on a GPU, so a link has to be
# bounded on both axes. These are deliberately generous for a real clip and
# still small enough that one paste cannot monopolise the box.
MAX_BYTES = 2 * 1024 * 1024 * 1024        # 2 GiB on disk
MAX_DURATION_SECONDS = 2 * 60 * 60        # 2 hours of media
# Tallest video track worth fetching. The dub is re-encoded regardless, so
# anything above this costs download time, disk and GPU for no visible gain.
MAX_HEIGHT = 1080
_CHUNK = 1024 * 1024                      # 1 MiB
_MAX_REDIRECTS = 5
_TIMEOUT = 30                             # seconds per connection

# Containers the pipeline can actually open. yt-dlp is told to prefer mp4; the
# direct path checks the served content-type against this.
_MEDIA_CONTENT_TYPES = ("video/", "audio/", "application/octet-stream")


class SourceFetchError(Exception):
    """A link could not be turned into a media file.

    The message is written for the person who pasted the link and is passed
    straight through to the API response, so it must say what to do next and
    must never contain an internal path or a resolved address.
    """


def yt_dlp_available() -> bool:
    """Whether the rich extractor is installed. Cheap — import only."""
    try:
        import yt_dlp  # noqa: F401
    except Exception:
        return False
    return True


# ── URL vetting ───────────────────────────────────────────────────────────

def _assert_public_host(host: str) -> None:
    """Refuse a host that resolves anywhere but the public internet.

    Checks EVERY address the name resolves to, not just the first: a name with
    one public and one loopback record would otherwise pass here and connect to
    whichever the socket layer picked.
    """
    if not host:
        raise SourceFetchError("That link has no host in it.")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise SourceFetchError(
            f"Could not find the host “{host}”. Check the link and try again.")

    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise SourceFetchError(f"Could not find the host “{host}”.")

    for raw in addresses:
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            raise SourceFetchError("That link resolves to an address we can't read.")
        # is_global is false for loopback, private, link-local, multicast and
        # every reserved block, which is exactly the set to refuse. Checking it
        # rather than enumerating ranges means new reserved blocks are covered.
        if not ip.is_global:
            log.warning("Refused non-public link host %s → %s", host, raw)
            raise SourceFetchError(
                "That link points inside a private network, so we can't fetch it. "
                "Paste a public video link, or upload the file instead.")


def _vet(url: str) -> urllib.parse.ParseResult:
    """Parse, check the scheme, and check where the host resolves to."""
    url = (url or "").strip()
    if not url:
        raise SourceFetchError("Paste a video link first.")
    if len(url) > 2048:
        raise SourceFetchError("That link is too long to be a video link.")

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SourceFetchError(
            "Only http and https links can be fetched. Paste a normal video "
            "link, or upload the file instead.")
    _assert_public_host(parsed.hostname or "")
    return parsed


def _safe_name(value: str, fallback: str) -> str:
    """A filename from a title: no separators, no dotfiles, bounded length."""
    cleaned = re.sub(r"[^\w\s.\-]", "", value, flags=re.UNICODE).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).lstrip(".")
    return cleaned[:120] or fallback


# ── The two backends ──────────────────────────────────────────────────────

def _format_selector() -> str:
    """What to ask yt-dlp for, given whether ffmpeg is on the box.

    YouTube no longer publishes a *progressive* stream (one file carrying both
    video and audio) for the overwhelming majority of videos — a probe of a
    normal public video returns 53 formats and zero progressive ones. A
    selector built only out of `best`/`b` terms therefore matches nothing and
    every YouTube link dies with "Requested format is not available", which is
    exactly what "paste a link and dub it" was failing on.

    So ask for separate video+audio and let yt-dlp mux them (`bv*+ba`). That
    needs ffmpeg, which the dubbing pipeline requires anyway. Without ffmpeg
    fall back to progressive-only: it still serves a direct .mp4 and the older
    sites that publish one, and a site that does not gets an honest error
    rather than a half-downloaded pair of streams that cannot be joined.

    `b` stays last in both chains so a single-file source is preferred when one
    exists and there is nothing to mux.
    """
    # Cap the video track. `bv*` alone means "the best there is", which on a
    # 4K source is a multi-GB download the dub gains nothing from: the output
    # is re-encoded anyway, and lip-sync and separation both run far longer at
    # 2160p. 1080p is the deliverable, so fetch that and no more. The
    # unrestricted terms stay at the end of each chain so a source that only
    # publishes above the cap still downloads rather than failing.
    cap = f"[height<={MAX_HEIGHT}]"
    if shutil.which("ffmpeg"):
        return (
            # H.264 first, not merely "an mp4". YouTube serves AV1 in an mp4
            # container for most videos now, and AV1 is the one codec the rest
            # of this pipeline cannot be relied on to decode — Wav2Lip reads
            # frames through OpenCV, whose bundled decoder often has no AV1 at
            # all. avc1 plays everywhere.
            f"bv*{cap}[vcodec^=avc1]+ba[ext=m4a]/"
            f"bv*{cap}[ext=mp4]+ba[ext=m4a]/"  # mp4 pair — no re-encode on merge
            f"bv*{cap}+ba/"                    # any container, still capped
            f"b{cap}[ext=mp4]/b{cap}/"         # already-progressive source
            "bv*+ba/b"                         # nothing under the cap exists
        )
    return (
        f"b{cap}[ext=mp4][acodec!=none][vcodec!=none]/"
        f"b{cap}[acodec!=none]/b{cap}/b"
    )


def _download_with_yt_dlp(url: str, dest_dir: Path, stem: str) -> tuple[Path, str]:
    import yt_dlp

    # Probed first, downloaded second. Checking duration up front is the whole
    # point: it refuses a three-hour stream before a byte is transferred, where
    # a post-hoc check would already have paid for the download.
    probe_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": _TIMEOUT,
    }
    try:
        with yt_dlp.YoutubeDL(probe_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:  # yt-dlp raises a family of its own errors
        raise SourceFetchError(_explain_yt_dlp(exc)) from exc

    if info is None:
        raise SourceFetchError("No video was found at that link.")
    # A playlist URL resolves to entries rather than one media item; take the
    # first so "the link I had open" behaves as expected.
    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise SourceFetchError("That link is an empty playlist.")
        info = entries[0]

    if info.get("is_live"):
        raise SourceFetchError(
            "That's a live stream. Dub it once the recording is published.")

    duration = info.get("duration")
    if isinstance(duration, (int, float)) and duration > MAX_DURATION_SECONDS:
        raise SourceFetchError(
            f"That video is {round(duration / 60)} minutes long — the limit for a "
            f"link is {MAX_DURATION_SECONDS // 60} minutes. Upload a trimmed clip "
            f"instead.")

    title = str(info.get("title") or "").strip()
    outtmpl = str(dest_dir / f"{stem}.%(ext)s")
    download_opts = {
        **probe_opts,
        "format": _format_selector(),
        # Merging DASH video+audio produces a .mkv unless told otherwise, and
        # the pipeline is happiest with mp4.
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
        "noprogress": True,
        "max_filesize": MAX_BYTES,
        # One file, never a directory of subtitles/thumbnails to clean up.
        "writesubtitles": False,
        "writethumbnail": False,
        "overwrites": True,
    }
    try:
        with yt_dlp.YoutubeDL(download_opts) as ydl:
            result = ydl.extract_info(url, download=True)
    except Exception as exc:
        raise SourceFetchError(_explain_yt_dlp(exc)) from exc

    path = _locate(dest_dir, stem)
    if path is None:
        # max_filesize makes yt-dlp skip the download and still "succeed", so a
        # missing file here is usually the cap, not a crash.
        raise SourceFetchError(
            f"That video is larger than the {MAX_BYTES // (1024 ** 3)} GB limit for "
            f"a link. Upload a trimmed clip instead.")

    if not title and isinstance(result, dict):
        title = str(result.get("title") or "").strip()
    return path, _safe_name(title or path.stem, path.name)


def _explain_yt_dlp(exc: Exception) -> str:
    """Turn an extractor failure into something the sender can act on."""
    raw = str(exc)
    low = raw.lower()
    if "private" in low or "members-only" in low or "login" in low or "sign in" in low:
        return ("That video is private or needs a sign-in, so we can't fetch it. "
                "Download it yourself and upload the file.")
    if "unavailable" in low or "removed" in low or "404" in low:
        return "That video is unavailable at the link you pasted."
    if "unsupported url" in low or "no video formats" in low:
        return ("We couldn't find a video at that link. Paste a link to the video "
                "page itself, or upload the file.")
    if "requested format is not available" in low:
        # Almost always ffmpeg missing on the server: the site publishes video
        # and audio as separate streams (YouTube no longer ships a combined
        # one), and without ffmpeg there is nothing to join them with.
        if not shutil.which("ffmpeg"):
            return ("This server can't combine that video's separate audio and "
                    "video streams — ffmpeg is not installed. Upload the file "
                    "instead, or ask an admin to install ffmpeg.")
        return ("We couldn't fetch a usable version of that video. Try a "
                "different link, or upload the file instead.")
    if "geo" in low and "restrict" in low:
        return "That video is blocked in the region this server runs in."
    log.warning("yt-dlp failed: %s", raw)
    return ("We couldn't download that video. Try a different link, or upload the "
            "file instead.")


def _download_direct(url: str, dest_dir: Path, stem: str) -> tuple[Path, str]:
    """Fetch a direct media URL, re-vetting every redirect hop.

    Used only when yt-dlp is not installed. Redirects are followed by hand
    precisely so each new location goes back through `_vet`: urllib's default
    handler would follow a 302 into 127.0.0.1 without a word.
    """
    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        parsed = _vet(current)
        request = urllib.request.Request(
            current,
            method="GET",
            # Some CDNs serve a 403 to an unrecognised agent.
            headers={"User-Agent": "TH-Labs-Dubbing/1.0", "Accept": "*/*"},
        )

        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_args, **_kwargs):
                return None

        opener = urllib.request.build_opener(_NoRedirect)
        try:
            response = opener.open(request, timeout=_TIMEOUT)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                location = exc.headers.get("Location")
                if not location:
                    raise SourceFetchError("That link redirects nowhere.") from exc
                current = urllib.parse.urljoin(current, location)
                continue
            raise SourceFetchError(
                f"The link answered {exc.code}. Check it is public and try again."
            ) from exc
        except urllib.error.URLError as exc:
            raise SourceFetchError(
                "We couldn't reach that link. Check it and try again.") from exc

        with response:
            content_type = (response.headers.get("Content-Type") or "").lower()
            if not content_type.startswith(_MEDIA_CONTENT_TYPES):
                raise SourceFetchError(
                    "That link isn't a video file. Install yt-dlp on the server to "
                    "support YouTube-style links, or upload the file instead.")

            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > MAX_BYTES:
                raise SourceFetchError(
                    f"That file is larger than the {MAX_BYTES // (1024 ** 3)} GB "
                    f"limit for a link.")

            suffix = Path(urllib.parse.unquote(parsed.path)).suffix
            if len(suffix) > 6 or not re.fullmatch(r"\.\w+", suffix or ""):
                suffix = ".mp4"
            path = dest_dir / f"{stem}{suffix}"

            written = 0
            with path.open("wb") as out:
                while chunk := response.read(_CHUNK):
                    written += len(chunk)
                    # Enforced against the bytes actually arriving, not just the
                    # declared length — Content-Length is a hint, and a chunked
                    # response has none at all.
                    if written > MAX_BYTES:
                        out.close()
                        path.unlink(missing_ok=True)
                        raise SourceFetchError(
                            f"That file is larger than the "
                            f"{MAX_BYTES // (1024 ** 3)} GB limit for a link.")
                    out.write(chunk)

            if written == 0:
                path.unlink(missing_ok=True)
                raise SourceFetchError("That link returned an empty file.")

            name = _safe_name(Path(urllib.parse.unquote(parsed.path)).name, path.name)
            return path, name

    raise SourceFetchError("That link redirects too many times.")


# Per-format parts yt-dlp writes while muxing: "link_ab12.f399.mp4" alongside
# "link_ab12.f140.m4a". They are deleted once the merge succeeds.
_FRAGMENT = re.compile(r"\.f\d+$")


def _locate(dest_dir: Path, stem: str) -> Path | None:
    """The finished file yt-dlp wrote, whatever extension it settled on.

    Merged downloads leave per-format parts on disk until the mux completes, so
    a plain `sorted(glob)[0]` can hand back `…f140.m4a` — an audio-only track —
    when the merge failed. The pipeline would then "dub" a file with no video.
    Prefer the merged output and treat parts as a last resort.
    """
    matches = sorted(dest_dir.glob(f"{stem}.*"))
    if not matches:
        return None
    merged = [m for m in matches if not _FRAGMENT.search(m.stem)]
    return merged[0] if merged else matches[0]


# ── Entry point ───────────────────────────────────────────────────────────

def download_source(url: str, dest_dir: Path, stem: str) -> tuple[Path, str]:
    """Fetch `url` into `dest_dir` as `stem.<ext>`.

    Returns ``(path, display_name)`` — the name is the video's title where the
    extractor knew one, so the job reads "Ada's keynote" rather than
    "link_9f2c1a.mp4".

    Raises `SourceFetchError` with a message meant for the sender.
    """
    _vet(url)
    dest_dir.mkdir(parents=True, exist_ok=True)

    if yt_dlp_available():
        return _download_with_yt_dlp(url, dest_dir, stem)
    return _download_direct(url, dest_dir, stem)
