"""
instabiz/overrides/llm.py — Claude API wrapper for AI agents.

complete(system, prompt) → text or None on any failure.
Agents must always handle None and fall back to deterministic output.
"""
import frappe
import logging

logger = logging.getLogger("ib_llm")

DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def complete(system: str, prompt: str, model: str = DEFAULT_MODEL, max_tokens: int = 512) -> str | None:
	"""Single-shot Claude completion. Returns text string or None on failure."""
	try:
		import anthropic
		api_key = frappe.conf.get("anthropic_api_key")
		if not api_key:
			return None
		client = anthropic.Anthropic(api_key=api_key)
		message = client.messages.create(
			model=model,
			max_tokens=max_tokens,
			system=system,
			messages=[{"role": "user", "content": prompt}],
		)
		text = (message.content[0].text or "").strip()
		return text or None
	except Exception as e:
		logger.warning("Claude API error: %s", e)
		try:
			frappe.log_error("IB LLM", str(e))
		except Exception:
			pass
		return None


def is_enabled() -> bool:
	"""True if anthropic_api_key is set in site config."""
	return bool(frappe.conf.get("anthropic_api_key"))
