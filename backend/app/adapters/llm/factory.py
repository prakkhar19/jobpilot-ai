from __future__ import annotations

from app.adapters.llm.anthropic_client import AnthropicClient
from app.adapters.llm.base import LLMClient, LLMError
from app.adapters.llm.openai_compat import OpenAICompatibleClient

PROVIDERS = {
    "openai_compatible": {
        "label": "OpenAI-compatible (OpenAI, NVIDIA NIM/Nemotron, Ollama, vLLM, LM Studio, OpenRouter...)",
        "requires_key": False,
        "default_base_url": "https://api.openai.com/v1",
        "examples": [
            {"name": "Groq (free key, no card)", "base_url": "https://api.groq.com/openai/v1",
             "model": "openai/gpt-oss-120b"},
            {"name": "Google Gemini (free key, no card)",
             "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash"},
            {"name": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
            {"name": "NVIDIA NIM (Nemotron)", "base_url": "https://integrate.api.nvidia.com/v1",
             "model": "nvidia/llama-3.3-nemotron-super-49b-v1"},
            {"name": "Ollama (on the Docker host)", "base_url": "http://host.docker.internal:11434/v1",
             "model": "llama3.1"},
        ],
    },
    "anthropic": {
        "label": "Anthropic (Claude)",
        "requires_key": True,
        "default_base_url": "https://api.anthropic.com",
        "examples": [{"name": "Claude Opus 5.5", "base_url": "", "model": "claude-opus-5-5"}],
    },
}


def build_client(provider: str, **kwargs) -> LLMClient:  # noqa: ANN003
    if provider == "openai_compatible":
        return OpenAICompatibleClient(**kwargs)
    if provider == "anthropic":
        kwargs.pop("temperature", None)
        kwargs.pop("embedding_model", None)
        return AnthropicClient(**kwargs)
    raise LLMError(f"Unknown provider '{provider}'")
