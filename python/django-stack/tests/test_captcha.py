from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework import serializers

from django_stack.contrib.captcha import verify_captcha
from django_stack.contrib.captcha.fields import CaptchaField
from django_stack.contrib.captcha.models import Challenge, Token
from django_stack.contrib.captcha.pow import check, prng, solve
from tests.testapp.models import Message

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def easy(settings):
    """Few, easy puzzles, so a test solves a challenge in milliseconds."""
    cache.clear()
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "CAPTCHA_CHALLENGES": 3, "CAPTCHA_DIFFICULTY": 2}


def redeem(client):
    challenge = client.post("/api/cap/challenge").json()
    c, s, d = challenge["challenge"]["c"], challenge["challenge"]["s"], challenge["challenge"]["d"]
    solutions = solve(challenge["token"], c, s, d)
    return client.post(
        "/api/cap/redeem", {"token": challenge["token"], "solutions": solutions}, format="json"
    )


def test_prng_matches_cap():
    # Values of prng() in @cap.js/server 4.0.5.
    assert prng("abc1", 32) == "a240feb00f42af1b0e9dab2bc4ea4c37"
    assert prng("x50d", 32) == "d5d68b06927f62fdba3f404d14efe396"
    assert prng("ffffd", 4) == "0d57"


def test_challenge_format(client):
    response = client.post("/api/cap/challenge")
    assert response.status_code == 200
    data = response.json()
    assert data["challenge"] == {"c": 3, "s": 32, "d": 2}
    assert len(data["token"]) == 50
    assert data["expires"] > timezone.now().timestamp() * 1000
    assert Challenge.objects.filter(pk=data["token"]).exists()


def test_redeem_gives_a_token_once(client):
    response = redeem(client)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    token_id, secret = data["token"].split(":")
    assert len(token_id) == 16 and len(secret) == 30
    assert Challenge.objects.count() == 0

    assert verify_captcha(data["token"]) is True
    assert verify_captcha(data["token"]) is False


def test_wrong_solution_is_refused(client):
    challenge = client.post("/api/cap/challenge").json()
    c, s, d = challenge["challenge"]["c"], challenge["challenge"]["s"], challenge["challenge"]["d"]
    solutions = solve(challenge["token"], c, s, d)
    wrong = [solutions[0] + 1, *solutions[1:]]
    if check(challenge["token"], c, s, d, wrong):  # pragma: no cover - an unlikely second solution
        pytest.skip("the changed number solves the puzzle too")
    response = client.post(
        "/api/cap/redeem", {"token": challenge["token"], "solutions": wrong}, format="json"
    )
    assert response.status_code == 400
    assert response.json() == {"success": False, "error": "Invalid solution"}
    # The challenge is gone: the right solutions no longer help.
    response = client.post(
        "/api/cap/redeem", {"token": challenge["token"], "solutions": solutions}, format="json"
    )
    assert response.json()["error"] == "Challenge invalid or expired"


@pytest.mark.parametrize(
    "body",
    [{}, {"token": "x"}, {"token": "x", "solutions": "1,2"}, {"token": 1, "solutions": []}],
)
def test_invalid_body(client, body):
    response = client.post("/api/cap/redeem", body, format="json")
    assert response.status_code == 400
    assert response.json()["success"] is False


def test_check_refuses_other_types():
    assert check("t", 2, 32, 1, [1]) is False
    assert check("t", 1, 32, 1, [True]) is False
    assert check("t", 1, 32, 1, [1.5]) is False
    assert check("t", 1, 32, 1, ["1"]) is False


def test_expired_challenge_and_token(client):
    challenge = client.post("/api/cap/challenge").json()
    Challenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    response = client.post(
        "/api/cap/redeem", {"token": challenge["token"], "solutions": [0, 0, 0]}, format="json"
    )
    assert response.json()["error"] == "Challenge invalid or expired"

    token = redeem(client).json()["token"]
    Token.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert verify_captcha(token) is False


def test_expired_rows_are_deleted(client):
    client.post("/api/cap/challenge")
    redeem(client)
    Challenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    Token.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    client.post("/api/cap/challenge")
    assert Challenge.objects.count() == 1
    assert Token.objects.count() == 0


@pytest.mark.parametrize("token", [None, 1, "", "abc", ":abc", "abc:", "a:b", "x" * 200])
def test_bad_tokens(token):
    assert verify_captcha(token) is False


def test_throttle(client):
    codes = [client.post("/api/cap/challenge").status_code for _ in range(31)]
    assert codes.count(200) == 30
    assert codes[-1] == 429
    assert client.post("/api/cap/challenge").json()["success"] is False


def test_solver(client):
    response = client.get("/api/cap/solver.wasm")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/wasm"
    assert b"".join(response.streaming_content).startswith(b"\0asm")


def test_public_create_needs_a_captcha(client):
    body = {"email": "a@example.com", "text": "Hello"}
    response = client.post("/api/testapp.message", body, format="json")
    assert response.status_code == 400
    assert response.json() == {"captcha": ["Verify that you are human."]}
    assert Message.objects.count() == 0

    response = client.post("/api/testapp.message", {**body, "captcha": "a:b"}, format="json")
    assert response.status_code == 400

    token = redeem(client).json()["token"]
    response = client.post("/api/testapp.message", {**body, "captcha": token}, format="json")
    assert response.status_code == 201, response.json()
    assert "captcha" not in response.json()
    assert Message.objects.count() == 1

    # The token was used up.
    response = client.post("/api/testapp.message", {**body, "captcha": token}, format="json")
    assert response.status_code == 400


def test_keys_and_staff_need_no_captcha(write_client, client):
    body = {"email": "a@example.com", "text": "Hello"}
    assert write_client.post("/api/testapp.message", body, format="json").status_code == 201
    user = get_user_model().objects.create_user("editor", password="x", is_staff=True)
    client.force_authenticate(user)
    assert client.post("/api/testapp.message", body, format="json").status_code == 201


def test_captcha_off(client, no_captcha):
    body = {"email": "a@example.com", "text": "Hello"}
    assert client.post("/api/testapp.message", body, format="json").status_code == 201
    assert verify_captcha("anything") is True


def test_captcha_field(client):
    class Signup(serializers.Serializer):
        email = serializers.EmailField()
        captcha = CaptchaField()

    token = redeem(client).json()["token"]
    serializer = Signup(data={"email": "a@example.com", "captcha": token})
    assert serializer.is_valid(), serializer.errors
    assert "captcha" not in Signup(serializer.validated_data).data

    serializer = Signup(data={"email": "a@example.com", "captcha": token})
    assert not serializer.is_valid()
    assert "captcha" in serializer.errors

    serializer = Signup(data={"email": "a@example.com"})
    assert not serializer.is_valid()
    assert serializer.errors["captcha"] == ["Verify that you are human."]


def test_testing_token(client):
    from django_stack.contrib.captcha.testing import captcha_token

    body = {"email": "a@example.com", "text": "Hello", "captcha": captcha_token()}
    assert client.post("/api/testapp.message", body, format="json").status_code == 201
