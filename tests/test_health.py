import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import in_ci


def test_health_llega_a_la_base():
    with TestClient(app) as client:
        r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@pytest.mark.skipif(not in_ci(), reason="la versión exacta se exige en GitHub Actions")
def test_postgres_es_18_o_mas(conn):
    version = int(conn.execute("SHOW server_version_num").fetchone()[0])
    assert version >= 180000
