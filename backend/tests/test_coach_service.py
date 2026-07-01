from app.core.config import get_settings
from app.modules.coach import service


def test_no_api_key_returns_honest_fallback(monkeypatch):
    monkeypatch.delenv("ATLAS_ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    result = service.answer_question("what did I do this week?")
    assert result["method"] == "no_key"
    assert result["grounded"] is False
    assert result["answer"]  # non-empty graceful message


def test_llm_error_returns_honest_fallback(monkeypatch):
    monkeypatch.setenv("ATLAS_ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr(service, "build_context", lambda text: {"signals": {}})
    monkeypatch.setattr(service, "_llm_answer", lambda *a, **k: None)
    result = service.answer_question("how is oscp?")
    assert result["method"] == "error"
    assert result["grounded"] is False


def test_grounded_answer_uses_llm(monkeypatch):
    monkeypatch.setenv("ATLAS_ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr(service, "build_context", lambda text: {"signals": {"week_activity_count": 3}})
    monkeypatch.setattr(service, "_llm_answer", lambda *a, **k: "You logged 3 activities this week.")
    result = service.answer_question("what did I do this week?")
    assert result["method"] == "llm"
    assert result["grounded"] is True
    assert "3" in result["answer"]


def test_coach_settings_have_defaults():
    from app.core.config import Settings

    settings = Settings()
    assert settings.coach_enabled is True
    assert settings.coach_model == "claude-haiku-4-5"
