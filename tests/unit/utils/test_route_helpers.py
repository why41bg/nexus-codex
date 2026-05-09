"""Tests for shared route helpers."""

import pytest
from fastapi.responses import JSONResponse

from app.utils.route_helpers import error_response


class TestErrorResponse:
    def test_default_status(self):
        resp = error_response("test error", "test_code")
        assert isinstance(resp, JSONResponse)
        assert resp.status_code == 500
        body = resp.body.decode()
        assert "test error" in body
        assert "test_code" in body

    def test_custom_status(self):
        resp = error_response("not found", "not_found", 404)
        assert resp.status_code == 404

    def test_structure(self):
        resp = error_response("msg", "code", 400)
        import json
        body = json.loads(resp.body.decode())
        assert body["error"]["message"] == "msg"
        assert body["error"]["code"] == "code"
        assert body["error"]["type"] == "server_error"
