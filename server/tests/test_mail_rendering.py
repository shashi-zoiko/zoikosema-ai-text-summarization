"""Isolated-algorithm test battery for the Phase 3 slice 4 mail rendering
pipeline's two security-critical pure functions: `_sanitize_mail_html`
(server-side nh3 allowlist) and `_validate_proxy_target` (SSRF guard for the
image proxy). Same convention as test_availability_merge.py / test_recurrence.py:
standalone, no pytest, no DB, no network — these two functions are exactly
the kind of pure logic that should never need a live server to verify.

Run standalone:

    server/venv/bin/python tests/test_mail_rendering.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.connect.mail_service.service import _sanitize_mail_html, _validate_proxy_target  # noqa: E402
from app.connect.shared.errors import Invalid  # noqa: E402


# ── _sanitize_mail_html ──────────────────────────────────────────────────

def test_script_tag_is_stripped():
    out = _sanitize_mail_html("<p>hi</p><script>alert(1)</script>")
    assert "<script" not in out and "alert" not in out, out
    assert "<p>hi</p>" in out
    print("  [OK] <script> tag and its content removed")


def test_inline_event_handler_is_stripped():
    out = _sanitize_mail_html('<a href="https://example.com" onclick="alert(1)">link</a>')
    assert "onclick" not in out, out
    assert 'href="https://example.com"' in out
    print("  [OK] onclick attribute stripped, href preserved")


def test_javascript_uri_is_stripped():
    out = _sanitize_mail_html('<a href="javascript:alert(1)">click</a>')
    assert "javascript:" not in out, out
    print("  [OK] javascript: URI scheme not allowed through")


def test_tracking_pixel_img_tag_survives_for_proxying():
    # nh3's job is to strip *scripts*, not images — the image proxy (tested
    # separately) is what neutralizes tracking, not the sanitizer removing
    # the tag outright.
    out = _sanitize_mail_html('<img src="https://tracker.example.com/pixel.gif" width="1" height="1">')
    assert "<img" in out and 'src="https://tracker.example.com/pixel.gif"' in out, out
    print("  [OK] <img> tag (tracking pixel) preserved for the image proxy to neutralize")


def test_allowed_formatting_tags_and_styles_survive():
    out = _sanitize_mail_html(
        '<table><tr><td style="color: red; font-weight: bold">cell</td></tr></table>'
    )
    assert "<table>" in out and "<td" in out
    assert "color:red" in out.replace(" ", "") or "color: red" in out
    print("  [OK] table/style formatting allowlist passes through")


def test_disallowed_style_property_is_stripped():
    out = _sanitize_mail_html('<p style="color: red; position: fixed">x</p>')
    assert "position" not in out, out
    print("  [OK] non-allowlisted style property (position) stripped")


def test_data_uri_scheme_is_stripped():
    out = _sanitize_mail_html('<img src="data:text/html;base64,PHNjcmlwdD4=">')
    assert "data:" not in out, out
    print("  [OK] data: URI scheme not allowed through")


# ── _validate_proxy_target ────────────────────────────────────────────────

def test_rejects_non_http_scheme():
    try:
        _validate_proxy_target("file:///etc/passwd")
        assert False, "should have raised"
    except Invalid:
        print("  [OK] non-http(s) scheme rejected")


def test_rejects_loopback_address():
    try:
        _validate_proxy_target("http://127.0.0.1/admin")
        assert False, "should have raised"
    except Invalid:
        print("  [OK] loopback address rejected")


def test_rejects_localhost_hostname():
    try:
        _validate_proxy_target("http://localhost/secrets")
        assert False, "should have raised"
    except Invalid:
        print("  [OK] localhost hostname rejected (resolves to loopback)")


def test_rejects_link_local_metadata_address():
    # Cloud metadata endpoint (GCP/AWS) — the canonical SSRF target this
    # guard exists to block.
    try:
        _validate_proxy_target("http://169.254.169.254/latest/meta-data/")
        assert False, "should have raised"
    except Invalid:
        print("  [OK] link-local metadata address (169.254.169.254) rejected")


def test_rejects_private_rfc1918_address():
    try:
        _validate_proxy_target("http://10.0.0.5/internal")
        assert False, "should have raised"
    except Invalid:
        print("  [OK] private RFC1918 address rejected")


def test_accepts_public_https_url():
    # A well-known public address (not expected to be reachable/asserted on
    # here — this only exercises the validation logic, not a live fetch).
    _validate_proxy_target("https://93.184.216.34/image.png")
    print("  [OK] public IP-literal https URL passes validation")


def main():
    tests = [
        test_script_tag_is_stripped,
        test_inline_event_handler_is_stripped,
        test_javascript_uri_is_stripped,
        test_tracking_pixel_img_tag_survives_for_proxying,
        test_allowed_formatting_tags_and_styles_survive,
        test_disallowed_style_property_is_stripped,
        test_data_uri_scheme_is_stripped,
        test_rejects_non_http_scheme,
        test_rejects_loopback_address,
        test_rejects_localhost_hostname,
        test_rejects_link_local_metadata_address,
        test_rejects_private_rfc1918_address,
        test_accepts_public_https_url,
    ]
    failures = 0
    for t in tests:
        try:
            t()
        except Exception as e:  # noqa: BLE001
            failures += 1
            import traceback
            print(f"  [FAIL] {t.__name__}: {e!r}")
            traceback.print_exc()
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
