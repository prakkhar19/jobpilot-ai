"""OpenAI-compatible chat completions client (OpenAI, NVIDIA NIM / Nemotron, Ollama, vLLM, LM Studio...)."""

from __future__ import annotations

import json
import time

import httpx

from app.adapters.llm.base import LLMError, LLMResult
from app.security.ssrf import SafeHttpClient, UnsafeURLError

DEFAULT_BASE_URL = "https://api.openai.com/v1"


class OpenAICompatibleClient:
    provider = "openai_compatible"

    def __init__(
        self,
        *,
        model: str,
        api_key: str = "",
        base_url: str = "",
        temperature: float = 0.2,
        max_tokens: int = 2000,
        timeout: float = 60,
        embedding_model: str = "",
        transport: httpx.BaseTransport | None = None,
        max_retries: int = 2,
        allow_private: bool = False,
    ) -> None:
        self.allow_private = allow_private
        self.model = model
        self.api_key = api_key
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.embedding_model = embedding_model
        self.max_retries = max_retries
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _post(self, path: str, payload: dict) -> dict:
        allow_private = self.allow_private
        last: LLMError | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with SafeHttpClient(
                    allow_private=allow_private, timeout=self.timeout, min_interval=0, transport=self._transport
                ) as client:
                    resp = client.post(f"{self.base_url}{path}", headers=self._headers(), content=json.dumps(payload))
            except UnsafeURLError as exc:
                raise LLMError(f"Endpoint not allowed: {exc}") from exc
            except httpx.TimeoutException:
                last = LLMError("The AI provider timed out.", retryable=True)
            except httpx.HTTPError as exc:
                last = LLMError(f"Could not reach the AI provider ({type(exc).__name__}).", retryable=True)
            else:
                if resp.status_code == 200:
                    try:
                        return resp.json()
                    except ValueError as exc:
                        raise LLMError("The AI provider returned invalid JSON.") from exc
                msg = _error_message(resp.text)
                if resp.status_code in (401, 403):
                    raise LLMError(f"Authentication with the AI provider failed: {msg}", status=resp.status_code)
                if resp.status_code == 404:
                    raise LLMError(f"Model or endpoint not found: {msg}", status=404)
                if resp.status_code == 410:
                    raise LLMError(f"The model '{self.model}' has been retired by the provider. Choose a current "
                                   f"model from the provider's model list and save again. ({msg})", status=410)
                retryable = resp.status_code in (408, 409, 429) or resp.status_code >= 500
                last = LLMError(f"AI provider error {resp.status_code}: {msg}", retryable=retryable, status=resp.status_code)
                if not retryable:
                    raise last
            if attempt < self.max_retries:
                time.sleep(min(2 ** attempt, 8))
        assert last is not None
        raise last

    def complete(self, system: str, user: str, *, max_tokens: int | None = None, json_output: bool = False) -> LLMResult:
        payload: dict = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": self.temperature,
            "max_tokens": max_tokens or self.max_tokens,
        }
        if json_output:
            payload["response_format"] = {"type": "json_object"}
        try:
            data = self._post("/chat/completions", payload)
        except LLMError as exc:
            # Not every compatible server supports response_format — retry once without it.
            if json_output and exc.status == 400:
                payload.pop("response_format", None)
                data = self._post("/chat/completions", payload)
            else:
                raise
        try:
            choice = data["choices"][0]
            text = choice["message"].get("content") or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("Unexpected response format from the AI provider.") from exc
        usage = data.get("usage") or {}
        return LLMResult(
            text=text,
            provider=self.provider,
            model=data.get("model") or self.model,
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            stop_reason=str(choice.get("finish_reason") or ""),
        )

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        if not self.embedding_model or not texts:
            return None
        data = self._post("/embeddings", {"model": self.embedding_model, "input": [t[:8000] for t in texts]})
        try:
            return [item["embedding"] for item in sorted(data["data"], key=lambda d: d.get("index", 0))]
        except (KeyError, TypeError) as exc:
            raise LLMError("Unexpected embeddings response.") from exc


def _error_message(body: str) -> str:
    try:
        data = json.loads(body)
        err = data.get("error", data)
        if isinstance(err, dict):
            return str(err.get("message") or err)[:300]
        return str(err)[:300]
    except (ValueError, AttributeError):
        return body[:300]
