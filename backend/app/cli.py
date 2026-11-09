"""Operator CLI (run inside the backend container).

  python -m app.cli reset-password user@example.com   # prints a one-hour reset link to this terminal
  python -m app.cli list-users
  python -m app.cli set-role user@example.com admin
  python -m app.cli seed-demo demo@example.com 'A-Strong-Password-1'   # DEMO_MODE only: fictional candidate
"""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models import User
from app.services.accounts import request_password_reset


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd, *args = argv
    with SessionLocal() as db:
        if cmd == "reset-password" and args:
            token = request_password_reset(db, args[0])
            if token is None:
                print("No active account with that email.")
                return 1
            base = get_settings().public_base_url.rstrip("/")
            print(f"Reset link (valid 1 hour): {base}/reset-password?token={token}")
            return 0
        if cmd == "list-users":
            for u in db.scalars(select(User).order_by(User.created_at)):
                print(f"{u.email}\t{u.role}\t{'active' if u.is_active else 'inactive'}")
            return 0
        if cmd == "set-role" and len(args) == 2 and args[1] in ("admin", "user"):
            u = db.scalar(select(User).where(User.email == args[0].lower()))
            if u is None:
                print("No such user.")
                return 1
            u.role = args[1]
            db.commit()
            print(f"{u.email} is now {u.role}")
            return 0
        if cmd == "seed-demo" and len(args) == 2:
            return seed_demo(db, args[0], args[1])
    print(__doc__)
    return 1


def seed_demo(db, email: str, password: str) -> int:  # noqa: ANN001
    """Create a fictional candidate with an approved profile, the sandbox source and one agent run."""
    from app.agents.runner import enqueue_run, get_config
    from app.core.database import bind_tenant
    from app.core.errors import DomainError
    from app.data.demo_candidate import DEMO_FACTS, demo_resume_docx
    from app.models import JobSource
    from app.services import accounts, profiles

    if not get_settings().demo_mode:
        print("seed-demo requires DEMO_MODE=true")
        return 1
    try:
        user = accounts.register(db, email, password, "Avery Demo")
    except DomainError as exc:
        print(f"Could not create user: {exc.message}")
        return 1
    bind_tenant(db, user.id)
    _, profile = profiles.create_from_upload(db, user, "avery-demo-resume.docx", demo_resume_docx(), use_llm=False)
    data = profiles.profile_to_dict(profile)
    data["application_facts"] = DEMO_FACTS
    profiles.update_profile(db, user, profile, data)
    profiles.approve(db, user, profile)
    cfg = get_config(db, user.id)
    cfg.target_roles = ["Machine Learning Engineer", "Data Engineer", "Backend Python Developer"]
    cfg.min_match_score = 50
    db.add(JobSource(user_id=user.id, kind="demo", identifier="sandbox", display_name="Demo sandbox (fictional jobs)"))
    user.onboarding_completed = True
    db.commit()
    task = enqueue_run(db, user, trigger="manual")
    print(f"Demo user {email} created; discovery task {task.id} queued.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
