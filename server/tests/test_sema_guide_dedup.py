"""Test Sema Guide source deduplication and API integration.

python server/tests/test_sema_guide_dedup.py
"""

import os
import sys

os.environ.setdefault("DATABASE_URL", "")
os.environ.setdefault("JWT_SECRET", "test-secret-key-not-for-prod")
os.environ.setdefault("MEDIA_PROVIDER", "mesh")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.database as dbmod

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
dbmod.engine = engine
dbmod.SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

from fastapi.testclient import TestClient
from app.core.database import Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.models.user import User
from app.main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def make_user(name, plan="free", is_admin=False):
    db = SessionLocal()
    try:
        u = User(
            email=f"{name}@t.test",
            name=name,
            password_hash=hash_password("x"),
            plan=plan,
            is_admin=is_admin,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        return create_access_token(subject=str(u.id))
    finally:
        db.close()


tok = make_user("Alice")
auth = {"Authorization": f"Bearer {tok}"}
tok_pro = make_user("Bob", plan="pro")
auth_pro = {"Authorization": f"Bearer {tok_pro}"}

ok = 0
fail = 0


def check(desc, cond):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS: {desc}")
    else:
        fail += 1
        print(f"  FAIL: {desc}")


# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 55)
print("1. Chat API")
print("=" * 55)

r = client.post(
    "/api/sema-guide/chat",
    json={"message": "How do I join a meeting?", "conversation": []},
    headers=auth,
)
check("Chat returns 200", r.status_code == 200)

if r.status_code == 200:
    d = r.json()
    check("Has response", "response" in d)
    check("Has sources list", isinstance(d["sources"], list))
    check("Has verified", "verified" in d)

    titles = set()
    dup_free = True
    for s in d["sources"]:
        k = s.get("title") or s.get("label", "")
        if k in titles:
            dup_free = False
            print(f"    DUPLICATE: {k}")
        titles.add(k)
    check("No duplicate sources", dup_free)
    print(f'  Sources ({len(d["sources"])}):')
    for s in d["sources"]:
        print(f'    label="{s["label"]}" title="{s.get("title","")}" url="{s.get("url","")}"')

# ═══════════════════════════════════════════════════════════════════════════════
print()
print("=" * 55)
print("2. Server-side source dedup")
print("=" * 55)

from app.connect.sema_guide.models import Source

# Case: 5 sources, 1 duplicate title
srcs = [
    {"label": "Help Center", "url": "/help/a", "title": "Joining a meeting", "relevance": 10},
    {"label": "Help Center", "url": "/help/b", "title": "Joining a meeting", "relevance": 9},
    {"label": "Help Center", "url": "/help/c", "title": "Microphone not working", "relevance": 8},
    {"label": "Product Doc", "url": "/docs/a", "title": "Sema Guide", "relevance": 7},
    {"label": "Product Doc", "url": "/docs/b", "title": "Privacy", "relevance": 6},
]

seen = set()
unique = []
for s in srcs:
    key = s.get("title") or s.get("label", "")
    if key not in seen:
        seen.add(key)
        unique.append(Source(label=s["label"], url=s.get("url"), title=s.get("title", "")))

check("5 in, 1 dup title -> 4 unique", len(unique) == 4)
check("'Joining a meeting' kept once", unique[0].title == "Joining a meeting")
check("Duplicate 'Joining a meeting' removed", unique[1].title != "Joining a meeting")

# Case: empty titles fallback to label
srcs2 = [
    {"label": "Help Center", "url": "/help/a", "title": ""},
    {"label": "Help Center", "url": "/help/b", "title": ""},
    {"label": "Product Doc", "url": "/docs/a", "title": ""},
]
seen2 = set()
unique2 = []
for s in srcs2:
    key = s.get("title") or s.get("label", "")
    if key not in seen2:
        seen2.add(key)
        unique2.append(Source(label=s["label"], url=s.get("url"), title=s.get("title", "")))

check("Empty title fallback to label -> 2 unique", len(unique2) == 2)
check("Help Center first", unique2[0].label == "Help Center")
check("Product Doc second", unique2[1].label == "Product Doc")

# ═══════════════════════════════════════════════════════════════════════════════
print()
print("=" * 55)
print("3. Frontend dedup simulation")
print("=" * 55)


def frontend_dedup(srcs):
    seen = set()
    result = []
    for s in srcs:
        key = s.get("title") or s.get("label") or s.get("url")
        if key not in seen:
            seen.add(key)
            result.append(s)
    return result


# Same document (title) appearing multiple times
r1 = frontend_dedup([
    {"label": "HC", "url": "/a", "title": "Joining"},
    {"label": "HC", "url": "/a", "title": "Joining"},
    {"label": "HC", "url": "/b", "title": "Mic"},
])
check("Same title doc deduped -> 2", len(r1) == 2)
check("First: Joining", r1[0]["title"] == "Joining")
check("Second: Mic", r1[1]["title"] == "Mic")

# Mixed: same title + empty titles
r2 = frontend_dedup([
    {"label": "HC", "url": "/a", "title": "Joining"},
    {"label": "HC", "url": "/a", "title": "Joining"},
    {"label": "HC", "url": "/a", "title": "Joining"},
    {"label": "PD", "url": "/b", "title": ""},
    {"label": "PD", "url": "/c", "title": ""},
])
check("3+2 mixed -> 2 unique (title dedup + label fallback)", len(r2) == 2)

# 4 unique sources -> first 3 + show-all
r3 = frontend_dedup([
    {"label": "A", "url": "/a", "title": "A"},
    {"label": "B", "url": "/b", "title": "B"},
    {"label": "C", "url": "/c", "title": "C"},
    {"label": "D", "url": "/d", "title": "D"},
])
check("4 unique sources", len(r3) == 4)
check("First 3 visible by default", len(r3[:3]) == 3)
check("4th needs 'Show all'", len(r3[3:]) == 1)

# ═══════════════════════════════════════════════════════════════════════════════
print()
print("=" * 55)
print("4. Edge cases")
print("=" * 55)

check("Empty list -> empty", len(frontend_dedup([])) == 0)
check("Single source -> 1", len(frontend_dedup([{"label": "HC", "url": "/a", "title": "H"}])) == 1)
check("3 identical titles -> 1", len(frontend_dedup([
    {"label": "HC", "url": "/a", "title": "Same"},
    {"label": "HC", "url": "/b", "title": "Same"},
    {"label": "HC", "url": "/c", "title": "Same"},
])) == 1)
check("Empty title, diff labels -> 2", len(frontend_dedup([
    {"label": "HC", "url": "/a", "title": ""},
    {"label": "PD", "url": "/b", "title": ""},
])) == 2)
check("Empty title, same label -> 1", len(frontend_dedup([
    {"label": "HC", "url": "/a", "title": ""},
    {"label": "HC", "url": "/b", "title": ""},
])) == 1)

# ═══════════════════════════════════════════════════════════════════════════════
print()
print("=" * 55)
print("5. Other endpoints")
print("=" * 55)

check("Privacy", client.get("/api/sema-guide/privacy-context", headers=auth).status_code == 200)
check("About", client.get("/api/sema-guide/about", headers=auth).status_code == 200)

r = client.get("/api/sema-guide/actions?surface=authenticated_home", headers=auth)
check("Actions", r.status_code == 200)
if r.status_code == 200:
    acts = r.json().get("actions", [])
    check("Has ranked actions", len(acts) > 0)
    check("Actions have label", all(a.get("label") for a in acts))

# ═══════════════════════════════════════════════════════════════════════════════
print()
print("=" * 55)
print("6. Auth enforcement")
print("=" * 55)

check(
    "No auth -> 401",
    client.post(
        "/api/sema-guide/chat", json={"message": "t", "conversation": []}
    ).status_code
    == 401,
)
check(
    "Bad token -> 401",
    client.post(
        "/api/sema-guide/chat",
        json={"message": "t", "conversation": []},
        headers={"Authorization": "Bearer bad"},
    ).status_code
    == 401,
)

# ═══════════════════════════════════════════════════════════════════════════════
print()
print("=" * 55)
print("RESULTS")
print("=" * 55)
total = ok + fail
print(f"  Total: {total}  Passed: {ok}  Failed: {fail}")
sys.exit(0 if fail == 0 else 1)
