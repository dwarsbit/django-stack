"""
The proof of work of the Cap protocol, as ``@cap.js/server`` checks it.

A challenge is a random token and three numbers: ``c`` puzzles, a salt of
``s`` hex characters and a target of ``d`` hex characters. The salt and
the target of puzzle ``i`` (from 1) are derived from the token, so they
are never stored. A solution is a number for each puzzle such that the
SHA-256 of the salt followed by the number starts with the target.
"""

import hashlib

_MASK = 0xFFFFFFFF


def _fnv1a(text: str) -> int:
    value = 2166136261
    for char in text:
        value ^= ord(char)
        value = (value + (value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24)) & _MASK
    return value


def prng(seed: str, length: int) -> str:
    """A deterministic hex string of ``length`` characters from ``seed``, as Cap derives it."""
    state = _fnv1a(seed)
    result = ""
    while len(result) < length:
        state ^= (state << 13) & _MASK
        state ^= state >> 17
        state ^= (state << 5) & _MASK
        result += f"{state:08x}"
    return result[:length]


def puzzles(token: str, count: int, size: int, difficulty: int) -> list[tuple[str, str]]:
    """The ``(salt, target)`` of each puzzle of a challenge."""
    return [(prng(f"{token}{i}", size), prng(f"{token}{i}d", difficulty)) for i in range(1, count + 1)]


def is_solved(salt: str, target: str, solution: int) -> bool:
    digest = hashlib.sha256(f"{salt}{solution}".encode()).hexdigest()
    return digest.startswith(target)


def check(token: str, count: int, size: int, difficulty: int, solutions) -> bool:
    """Whether ``solutions`` solve every puzzle of the challenge."""
    if not isinstance(solutions, list) or len(solutions) != count:
        return False
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in solutions):
        return False
    return all(
        is_solved(salt, target, solution)
        for (salt, target), solution in zip(puzzles(token, count, size, difficulty), solutions, strict=True)
    )


def solve(token: str, count: int, size: int, difficulty: int) -> list[int]:
    """Solves a challenge, for tests: about 16^difficulty hashes a puzzle."""
    solutions = []
    for salt, target in puzzles(token, count, size, difficulty):
        number = 0
        while not is_solved(salt, target, number):
            number += 1
        solutions.append(number)
    return solutions
