"""Shared pytest fixtures.

Every route module in this backend stores its data behind a module-level
`SOMETHING_FILE = Path(...)` constant read/written by that module's own
functions — see e.g. `app/routes/pending_alerts.py`'s `PENDING_ALERTS_FILE`.
That makes tests easy to isolate: `monkeypatch.setattr(module, "SOMETHING_FILE",
tmp_path / "x.json")` redirects a module's storage to a throwaway file for
the duration of one test, so tests never read or write this project's real
`app/data/*.json` files.

`no_real_network` is autouse — it forces every SMS/voice send in every test
to the "simulated" path by default, so the suite runs fully offline and
never makes a real (even sandbox) Africa's Talking API call. A test that
specifically wants to check the "sent" branch overrides `is_configured`
locally instead.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Every route module below imports `is_configured`/`send_sms`/etc. by
    name (`from app.models.sms_gateway import is_configured as
    is_sms_configured`), which binds a fresh reference in *that* module's
    own namespace — patching `app.models.sms_gateway.is_configured` alone
    would not affect those already-bound names. So this patches each
    consuming module's own imported name instead (the standard "patch
    where it's used, not where it's defined" rule)."""
    import app.routes.admin_reports as admin_reports
    import app.routes.alerts as alerts
    import app.routes.hazard_reports as hazard_reports
    import app.routes.pending_alerts as pending_alerts
    import app.routes.subscribers as subscribers

    for module in (admin_reports, alerts, hazard_reports, pending_alerts, subscribers):
        monkeypatch.setattr(module, "is_sms_configured", lambda: False)
    for module in (admin_reports, alerts):
        monkeypatch.setattr(module, "is_voice_configured", lambda: False)
    monkeypatch.setattr(alerts, "is_push_configured", lambda: False)
