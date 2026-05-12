"""Tests for shared route helpers."""

from fastapi.responses import JSONResponse

from app.utils.route_helpers import build_openai_error_response


class TestBuildOpenAIErrorResponse:
    def test_default_status(self):
        resp = build_openai_error_response(500, "test error", "server_error", "test_code")
        assert isinstance(resp, JSONResponse)
        assert resp.status_code == 500
        body = resp.body.decode()
        assert "test error" in body
        assert "test_code" in body

    def test_custom_status(self):
        resp = build_openai_error_response(404, "not found", "server_error", "not_found")
        assert resp.status_code == 404

    def test_structure(self):
        resp = build_openai_error_response(400, "msg", "server_error", "code")
        import json
        body = json.loads(resp.body.decode())
        assert body["error"]["message"] == "msg"
        assert body["error"]["code"] == "code"
        assert body["error"]["type"] == "server_error"
