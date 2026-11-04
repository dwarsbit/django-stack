from django_stack.signing import sign_preview_token, sign_webhook, verify_preview_token, verify_webhook


def test_preview_token_round_trip():
    token = sign_preview_token("secret", 60, now=1000)
    assert token.startswith("1060.")
    assert verify_preview_token("secret", token, now=1000)
    assert not verify_preview_token("other", token, now=1000)
    assert not verify_preview_token("secret", token, now=2000)
    assert not verify_preview_token("secret", "1060.bad", now=1000)
    assert not verify_preview_token("secret", None)


def test_known_vectors():
    # The same vectors are tested in @django-stack/utils, so both sides agree.
    assert sign_preview_token("secret", 0, now=1700000000) == (
        "1700000000.a9da2691080116efe39fd80391b4560625e3a5ffd93a574bd44247ba15687488"
    )
    assert sign_webhook("secret", b'{"a":1}', timestamp=1700000000) == (
        "t=1700000000,v1=49f24e537407743fa4a0242bb63b94b9a47ee99cbbe071ccd8a22550ae411686"
    )


def test_webhook_round_trip():
    header = sign_webhook("secret", b'{"a":1}', timestamp=1000)
    assert verify_webhook("secret", header, b'{"a":1}', now=1000)
    assert not verify_webhook("secret", header, b'{"a":2}', now=1000)
    assert not verify_webhook("secret", header, b'{"a":1}', now=5000)
    assert not verify_webhook("secret", "garbage", b"", now=1000)
