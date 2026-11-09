"""Anthropic (Claude) client using the official SDK."""

from __future__ import annotations

import anthropic

from app.adapters.llm.base import LLMError, LLMResult
from app.security.ssrf import UnsafeURLError, validate_url

DEFAULT_MODEL = "claude-opus-5-5"
# Models that accept server-side refusal fallbacks with the "default" routing form.
_FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}


class AnthropicClient:
    provider = "anthropic"

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        api_key: str,
        base_url: str = "",
        max_tokens: int = 2000,
        timeout: float = 120,
        max_retries: int = 2,
        allow_private: bool = False,
        **_: object,
    ) -> None:
        if not api_key:
            raise LLMError("An Anthropic API key is required.")
        self.model = model or DEFAULT_MODEL
        self.max_tokens = max_tokens
        self.custom_base_url = bool(base_url)
        if base_url:
            try:
                validate_url(base_url, allow_private=allow_private)
            except UnsafeURLError as exc:
                raise LLMError(f"Endpoint not allowed: {exc}") from exc
        kwargs: dict = {"api_key": api_key, "timeout": float(timeout), "max_retries": max_retries}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = anthropic.Anthropic(**kwargs)

    def complete(self, system: str, user: str, *, max_tokens: int | None = None, json_output: bool = False) -> LLMResult:
        # Current Claude models reject temperature/top_p, so sampling parameters are not sent.
        params: dict = {
            "model": self.model,
            "max_tokens": max(max_tokens or self.max_tokens, 1024),
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        try:
            if self.model in _FALLBACK_MODELS and not self.custom_base_url:
                # Server-side refusal fallback: if this model declines, the API re-runs on a fallback model.
                response = self._client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params
                )
            else:
                response = self._client.messages.create(**params)
        except anthropic.AuthenticationError as exc:
            raise LLMError("Authentication with Anthropic failed. Check the API key.", status=401) from exc
        except anthropic.PermissionDeniedError as exc:
            raise LLMError("The Anthropic API key lacks permission for this request.", status=403) from exc
        except anthropic.NotFoundError as exc:
            raise LLMError(f"Model '{self.model}' was not found.", status=404) from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("Anthropic rate limit reached. Try again later.", retryable=True, status=429) from exc
        except anthropic.BadRequestError as exc:
            raise LLMError(f"Anthropic rejected the request: {exc.message[:300]}", status=400) from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(
                f"Anthropic error {exc.status_code}.", retryable=exc.status_code >= 500, status=exc.status_code
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("Could not reach the Anthropic API.", retryable=True) from exc

        if response.stop_reason == "refusal":
            raise LLMError("The model declined this request.")
        text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
        usage = response.usage
        return LLMResult(
            text=text,
            provider=self.provider,
            model=getattr(response, "model", self.model),
            input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
            output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
            stop_reason=str(response.stop_reason or ""),
        )

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        return None  # Anthropic has no embeddings endpoint; matching falls back to TF-IDF.
