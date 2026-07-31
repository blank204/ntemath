"""Import the repo root's modules without mutating ``sys.path``.

The repo root (this checkout: "Pyra NTE", not the README's "ntemath") is a
Python package -- it has its own ``__init__.py`` -- and several of its
modules use relative imports (``place.py`` does ``from .geo import ...``,
``plan.py`` does ``from . import forest, hazard``). Those relative imports
only resolve if the module is loaded *as a submodule of that package*.

We used to get that package context by pushing the repo root's parent onto
``sys.path`` and importing through the checkout's on-disk directory name.
That mutates ``sys.path`` for the whole process just from importing this
module, and puts a filesystem root at the *front* of the search path ahead of
the stdlib and site-packages -- a shadowing hazard for anything else that
runs afterwards, even though nothing collides today. It also silently breaks
if the checkout is ever renamed to something that isn't a valid identifier
(this one, "Pyra NTE", already has a space in it).

Instead, register the repo root as a package under a private, fixed name
directly in ``sys.modules`` via ``importlib.util.spec_from_file_location``,
with ``submodule_search_locations`` pointing at the repo root. That gives any
repo-root module a real package context to resolve its relative imports
against, without touching ``sys.path`` or any repo-root file at all, and is
deterministic regardless of what the checkout directory is named or where it
lives.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
_REPO_PKG_NAME = "_ntemath_repo"


def repo_modules(*names: str):
    """Import repo-root modules (e.g. ``"geo"``, ``"place"``, ``"forest"``)
    as submodules of a synthetic package aliasing the repo root, and return
    them as a tuple in the order requested.

    Safe to call repeatedly and with different ``names`` across a process --
    the synthetic package is only registered once, and each submodule is
    cached by ``importlib`` the normal way.
    """
    if _REPO_PKG_NAME not in sys.modules:
        init_path = os.path.join(REPO_ROOT, "__init__.py")
        spec = importlib.util.spec_from_file_location(
            _REPO_PKG_NAME, init_path, submodule_search_locations=[REPO_ROOT]
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[_REPO_PKG_NAME] = module
        spec.loader.exec_module(module)
    return tuple(
        importlib.import_module(f"{_REPO_PKG_NAME}.{name}") for name in names
    )
