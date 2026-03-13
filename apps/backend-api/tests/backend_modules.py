from __future__ import annotations

import sys


def fresh_backend_modules() -> None:
    """Drop loaded backend modules so each test run sees current env vars."""

    for module_name in tuple(sys.modules):
        if module_name == "app" or module_name.startswith("app."):
            sys.modules.pop(module_name, None)
