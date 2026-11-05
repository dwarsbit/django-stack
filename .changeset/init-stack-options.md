---
"@django-stack/cli": minor
---

`init` asks for every stack option, each with a flag: `--frontend`, `--postgres`, `--analytics`, `--tasks`, `--cache`, `--notifications`, `--captcha`, `--storage` and `--package-manager`. `--preset <code>` sets them all at once, `init` prints the preset of the project it created, and `django-stack preset` makes or reads a code. There are named presets: `blog`, `api` and `minimal`. Values this release does not generate yet are listed but refused. `--local-s3` is now `--storage s3`; the old flag still works.
