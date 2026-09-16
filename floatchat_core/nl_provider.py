"""Provider boundary for the natural-language planner.

FloatChat does not ship a bundled model vendor. This module defines a narrow
protocol and one vendor-neutral adapter that speaks the widely implemented
OpenAI-compatible ``/chat/completions`` JSON shape, which self-hosted runtimes
(Ollama, vLLM, llama.cpp, LM Studio) and several hosted services all accept.
Nothing is enabled by default: with no environment configuration the planner
reports "not configured" and manual exploration is entirely unaffected.

Rules this boundary enforces:

* No credentials ever reach browser code. The key is read from the server
  environment and never echoed back in a response.
* Requests are bounded: connect/read timeout, output token cap, and a cap on
  how much text may be sent.
* The provider returns **text only**. It never executes code, SQL, URLs or
  tool calls, and the caller validates every field it returns.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Optional, Protocol

#: Environment variables that configure the planner. All are optional; with
#: ``FLOATCHAT_NL_PROVIDER`` unset the feature is simply off.
ENV_PROVIDER = "FLOATCHAT_NL_PROVIDER"
ENV_BASE_URL = "FLOATCHAT_NL_BASE_URL"
ENV_MODEL = "FLOATCHAT_NL_MODEL"
ENV_API_KEY = "FLOATCHAT_NL_API_KEY"
ENV_TIMEOUT = "FLOATCHAT_NL_TIMEOUT_S"
ENV_MAX_OUTPUT_TOKENS = "FLOATCHAT_NL_MAX_OUTPUT_TOKENS"
ENV_MAX_QUESTION_CHARS = "FLOATCHAT_NL_MAX_QUESTION_CHARS"
ENV_RESPONSE_FORMAT = "FLOATCHAT_NL_RESPONSE_FORMAT"

#: The only provider kind implemented. Kept as a named value so adding another
#: adapter later is an explicit, reviewable change rather than a default shift.
PROVIDER_OPENAI_COMPATIBLE = "openai_compatible"
SUPPORTED_PROVIDERS = (PROVIDER_OPENAI_COMPATIBLE,)

DEFAULT_TIMEOUT_S = 20.0
DEFAULT_MAX_OUTPUT_TOKENS = 1200
DEFAULT_MAX_QUESTION_CHARS = 600
#: ``json_object`` is the most widely supported structured-output mode across
#: OpenAI-compatible servers. ``json_schema`` is stricter where available.
DEFAULT_RESPONSE_FORMAT = "json_object"
RESPONSE_FORMATS = ("json_schema", "json_object", "none")


#: Longest provider error detail passed back to the caller.
MAX_ERROR_DETAIL_CHARS = 240


def scrub_secrets(text: str, secret: Optional[str] = None) -> str:
    """Remove credentials from text that will reach a user or a log.

    Applied at every boundary that renders provider text, not only where the
    text is first raised. A message that has travelled through an exception is
    exactly the kind that gets forgotten, so callers scrub again on the way
    out; scrubbing twice costs nothing and missing once is a disclosure.
    """
    if not text:
        return ""
    if secret:
        text = text.replace(secret, "[redacted]")
    text = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", text)
    text = re.sub(r"AIza[0-9A-Za-z_\-]{10,}", "[redacted]", text)
    text = re.sub(r"sk-[A-Za-z0-9_\-]{8,}", "[redacted]", text)
    text = " ".join(text.split())
    return text[:MAX_ERROR_DETAIL_CHARS]


def _provider_error_detail(response: Any, secret: Optional[str]) -> Optional[str]:
    """A short, credential-scrubbed summary of a provider's error body.

    A bare "HTTP 400" cannot distinguish an invalid key from an unknown model
    or a rejected parameter. Providers put that distinction in the body - an
    OpenAI-style ``{"error": {"type", "message"}}`` or a Google-style list of
    ``{"error": {"status", "message"}}`` - so the status and message are kept,
    with the configured key, bearer tokens and Google key shapes removed.
    """
    try:
        body = response.json()
    except Exception:  # noqa: BLE001 - a non-JSON error body has no detail
        return None
    if isinstance(body, list) and body:
        body = body[0]
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, str):
        parts = [error]
    elif isinstance(error, dict):
        status = error.get("status") or error.get("type") or error.get("code")
        parts = [str(part) for part in (status, error.get("message")) if part]
    else:
        return None
    if not parts:
        return None
    return scrub_secrets(" - ".join(parts), secret)


class ProviderNotConfigured(RuntimeError):
    """No natural-language provider is configured for this deployment."""


class ProviderTimeout(RuntimeError):
    """The provider did not answer within the configured bound."""


class ProviderError(RuntimeError):
    """The provider refused, errored, or returned something unusable."""


@dataclass(frozen=True)
class ProviderSettings:
    kind: str
    base_url: str
    model: str
    api_key: Optional[str]
    timeout_s: float
    max_output_tokens: int
    max_question_chars: int
    response_format: str

    def describe(self) -> dict:
        """Non-secret description, safe to return to a browser."""
        return {
            "configured": True,
            "kind": self.kind,
            "model": self.model,
            "base_url": self.base_url,
            "timeout_s": self.timeout_s,
            "max_output_tokens": self.max_output_tokens,
            "max_question_chars": self.max_question_chars,
            "response_format": self.response_format,
            "credential_configured": bool(self.api_key),
        }


class JsonCompletionProvider(Protocol):
    """Returns one JSON object for a system+user prompt pair."""

    settings: ProviderSettings

    def complete_json(self, system: str, user: str,
                      schema: Optional[dict] = None) -> dict:
        ...


def _float_env(source: dict, name: str, default: float) -> float:
    raw = source.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ProviderError(f"{name} must be a number, got {raw!r}") from exc


def _int_env(source: dict, name: str, default: int) -> int:
    return int(_float_env(source, name, float(default)))


def settings_from_env(env: Optional[dict] = None) -> Optional[ProviderSettings]:
    """Read provider settings, or ``None`` when the feature is not configured.

    Raises :class:`ProviderError` when a provider *is* named but its required
    settings are missing, so a half-configured deployment fails loudly instead
    of silently behaving as if the feature were switched off.
    """
    source = os.environ if env is None else env
    kind = (source.get(ENV_PROVIDER) or "").strip()
    if not kind:
        return None
    if kind not in SUPPORTED_PROVIDERS:
        raise ProviderError(
            f"{ENV_PROVIDER}={kind!r} is not supported. Supported values: "
            f"{', '.join(SUPPORTED_PROVIDERS)}."
        )

    base_url = (source.get(ENV_BASE_URL) or "").strip()
    model = (source.get(ENV_MODEL) or "").strip()
    missing = [name for name, value in
               ((ENV_BASE_URL, base_url), (ENV_MODEL, model)) if not value]
    if missing:
        raise ProviderError(
            f"{ENV_PROVIDER} is set to {kind!r} but {', '.join(missing)} "
            "is not set. Configure it or unset "
            f"{ENV_PROVIDER} to disable natural-language drafting."
        )
    response_format = (source.get(ENV_RESPONSE_FORMAT)
                       or DEFAULT_RESPONSE_FORMAT).strip()
    if response_format not in RESPONSE_FORMATS:
        raise ProviderError(
            f"{ENV_RESPONSE_FORMAT} must be one of "
            f"{', '.join(RESPONSE_FORMATS)}; got {response_format!r}."
        )
    return ProviderSettings(
        kind=kind,
        base_url=base_url.rstrip("/"),
        model=model,
        api_key=(source.get(ENV_API_KEY) or "").strip() or None,
        timeout_s=_float_env(source, ENV_TIMEOUT, DEFAULT_TIMEOUT_S),
        max_output_tokens=_int_env(source, ENV_MAX_OUTPUT_TOKENS,
                                   DEFAULT_MAX_OUTPUT_TOKENS),
        max_question_chars=_int_env(source, ENV_MAX_QUESTION_CHARS,
                                    DEFAULT_MAX_QUESTION_CHARS),
        response_format=response_format,
    )


def _extract_json(text: str) -> dict:
    """Parse a JSON object out of a completion, tolerating code fences."""
    candidate = (text or "").strip()
    if not candidate:
        raise ProviderError("The provider returned an empty response.")
    if candidate.startswith("```"):
        candidate = candidate.split("```")[1] if "```" in candidate[3:] else candidate
        candidate = candidate.strip()
        if candidate.lower().startswith("json"):
            candidate = candidate[4:].strip()
    if not candidate.startswith("{"):
        start, end = candidate.find("{"), candidate.rfind("}")
        if start == -1 or end <= start:
            raise ProviderError(
                "The provider did not return a JSON object."
            )
        candidate = candidate[start:end + 1]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ProviderError(f"The provider returned malformed JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ProviderError("The provider returned JSON that is not an object.")
    return parsed


class OpenAICompatibleProvider:
    """Adapter for any server exposing ``POST {base_url}/chat/completions``.

    Deliberately vendor-neutral: the base URL, model name and key all come from
    the environment, so pointing this at a local runtime or a hosted service is
    a configuration choice, never a code change.
    """

    def __init__(self, settings: ProviderSettings, session: Any = None):
        self.settings = settings
        self._session = session

    def _post(self, payload: dict) -> dict:
        import requests  # imported lazily so offline tests never need it

        session = self._session or requests
        headers = {"Content-Type": "application/json"}
        if self.settings.api_key:
            headers["Authorization"] = f"Bearer {self.settings.api_key}"
        url = f"{self.settings.base_url}/chat/completions"
        try:
            response = session.post(url, json=payload, headers=headers,
                                    timeout=self.settings.timeout_s)
        except Exception as exc:  # noqa: BLE001 - normalised below
            name = type(exc).__name__
            if "Timeout" in name:
                raise ProviderTimeout(
                    f"The natural-language service did not respond within "
                    f"{self.settings.timeout_s:.0f}s."
                ) from exc
            raise ProviderError(f"{name}: {exc}") from exc

        status = getattr(response, "status_code", 0)
        if status == 408 or status == 504:
            raise ProviderTimeout(
                f"The natural-language service timed out (HTTP {status})."
            )
        if status >= 400:
            detail = _provider_error_detail(response, self.settings.api_key)
            raise ProviderError(
                f"The natural-language service returned HTTP {status}"
                + (f": {detail}" if detail else ".")
            )
        try:
            return response.json()
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(
                "The natural-language service returned a non-JSON body."
            ) from exc

    def complete_json(self, system: str, user: str,
                      schema: Optional[dict] = None) -> dict:
        payload: dict[str, Any] = {
            "model": self.settings.model,
            "max_tokens": self.settings.max_output_tokens,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if self.settings.response_format == "json_object":
            payload["response_format"] = {"type": "json_object"}
        elif self.settings.response_format == "json_schema" and schema:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "floatchat_plan_patch",
                                "strict": True, "schema": schema},
            }

        body = self._post(payload)
        try:
            choices = body["choices"]
            content = choices[0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(
                "The natural-language service returned an unexpected response "
                "shape."
            ) from exc
        if isinstance(content, list):  # some servers return content parts
            content = "".join(part.get("text", "") for part in content
                              if isinstance(part, dict))
        return _extract_json(content if isinstance(content, str) else "")


def build_provider(settings: Optional[ProviderSettings] = None,
                   session: Any = None) -> JsonCompletionProvider:
    """Construct the configured provider, or raise if there is none."""
    resolved = settings if settings is not None else settings_from_env()
    if resolved is None:
        raise ProviderNotConfigured(
            "Natural-language drafting is not configured. Set "
            f"{ENV_PROVIDER}, {ENV_BASE_URL} and {ENV_MODEL} to enable it. "
            "Manual query building works without it."
        )
    if resolved.kind == PROVIDER_OPENAI_COMPATIBLE:
        return OpenAICompatibleProvider(resolved, session=session)
    raise ProviderError(f"No adapter for provider kind {resolved.kind!r}.")


def provider_status(env: Optional[dict] = None) -> dict:
    """Non-secret configuration status for the UI."""
    try:
        settings = settings_from_env(env)
    except ProviderError as exc:
        return {"configured": False, "error": str(exc),
                "env_vars": list(_ENV_DOC)}
    if settings is None:
        return {
            "configured": False,
            "error": None,
            "message": "Natural-language service not configured.",
            "env_vars": list(_ENV_DOC),
        }
    return settings.describe()


_ENV_DOC = {
    ENV_PROVIDER: f"Provider kind. Only {PROVIDER_OPENAI_COMPATIBLE!r}. Unset disables the feature.",
    ENV_BASE_URL: "Base URL exposing POST {base}/chat/completions.",
    ENV_MODEL: "Model name passed through to that service.",
    ENV_API_KEY: "Optional bearer token. Server-side only; never sent to the browser.",
    ENV_TIMEOUT: f"Request timeout in seconds (default {DEFAULT_TIMEOUT_S:.0f}).",
    ENV_MAX_OUTPUT_TOKENS: f"Output cap (default {DEFAULT_MAX_OUTPUT_TOKENS}).",
    ENV_MAX_QUESTION_CHARS: f"Maximum question length (default {DEFAULT_MAX_QUESTION_CHARS}).",
    ENV_RESPONSE_FORMAT: f"One of {', '.join(RESPONSE_FORMATS)} (default {DEFAULT_RESPONSE_FORMAT}).",
}
