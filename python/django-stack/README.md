# django-stack

The backend glue of [DjangoStack](https://github.com/dwarsbit/django-stack).
Projects created with `npx @django-stack/cli init` depend on it.

- `django_stack.settings.configure()` sets Django's settings from environment
  variables: database, cache, task queue, mail, storage, security, and safe
  defaults for Django Headless and Django Content Studio.
- `PublishableModel`: draft and published content, with preview access.
- API defaults: a closed API with a full-access and a read-only key, and
  rate-limited public forms.
- Preview tokens and signed revalidation requests to the frontend.
- `django_stack.contrib.captcha`: the [Cap](https://capjs.js.org) captcha
  protocol, a proof of work for public forms, with `CaptchaField` and
  `verify_captcha()`. Its `solver.wasm` is from `@cap.js/wasm`
  (Apache-2.0); see its `NOTICE`.
- `/healthz` and `/readyz`, system checks, and the management commands
  `create_admin`, `seed_content`, `export_content`, `import_content` and
  `wait_for_db`.

```python
# config/settings.py
from pathlib import Path

from django_stack.settings import configure

configure(globals(), base_dir=Path(__file__).resolve().parent.parent)
```

## License

MIT; see [LICENSE](LICENSE).
