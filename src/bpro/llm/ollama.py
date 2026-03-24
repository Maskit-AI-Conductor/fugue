"""Ollama API client — SLM-first model adapter."""

import json
import re

import httpx

from bpro.utils.display import print_error


class OllamaClient:
    """Thin client for Ollama /api/generate endpoint."""

    def __init__(self, endpoint: str = "http://localhost:11434", model: str = "qwen2.5:7b", timeout: int = 120):
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.timeout = timeout

    def check_health(self) -> bool:
        """Check if Ollama is running."""
        try:
            resp = httpx.get(f"{self.endpoint}/api/tags", timeout=5)
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    def list_models(self) -> list[str]:
        """List available models."""
        try:
            resp = httpx.get(f"{self.endpoint}/api/tags", timeout=5)
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]
        except Exception:
            return []

    def generate(self, prompt: str, system: str | None = None) -> str:
        """Generate text with Ollama. Synchronous, non-streaming."""
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system

        try:
            resp = httpx.post(
                f"{self.endpoint}/api/generate",
                json=payload,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json().get("response", "")
        except httpx.ConnectError:
            print_error("Ollama is not running. Start it with: ollama serve")
            raise
        except httpx.TimeoutException:
            print_error(f"Ollama timed out after {self.timeout}s. Try a smaller input or increase timeout.")
            raise

    def generate_json(self, prompt: str, system: str | None = None) -> list | dict:
        """Generate and parse JSON response. Handles common SLM quirks."""
        raw = self.generate(prompt, system)
        return parse_json_response(raw)


def parse_json_response(raw: str) -> list | dict:
    """Parse JSON from SLM response, handling common issues."""
    # Try direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Extract from markdown code block
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try to find JSON array or object
    for pattern in [r"\[.*\]", r"\{.*\}"]:
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

    # Last resort: fix trailing commas
    cleaned = re.sub(r",\s*([}\]])", r"\1", raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        raise ValueError(f"Failed to parse JSON from SLM response:\n{raw[:500]}")


def get_client_from_config(config: dict) -> OllamaClient:
    """Create OllamaClient from project config."""
    model_config = config.get("model", {})
    return OllamaClient(
        endpoint=model_config.get("endpoint", "http://localhost:11434"),
        model=model_config.get("model", "qwen2.5:7b"),
        timeout=model_config.get("timeout", 120),
    )
