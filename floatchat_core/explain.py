"""Turn server-verified facts into a short explanation, under tight control.

The division of labour is deliberate and absolute:

* **The backend computes every value.** No number in an explanation comes from
  a model. The model chooses which approved sentence to use and which fact
  belongs in each slot; the value is substituted here, server-side, from the
  evidence built by :mod:`floatchat_core.evidence`.
* **The model selects, it does not assert.** It returns template ids and fact
  ids. Anything else - free prose, an unknown fact id, an unknown template, a
  fact that does not fit the slot it was offered for - is rejected, and the
  answer falls back to the deterministic summary rather than being passed on.

Claims this module will not make, whatever a model returns, because the data
cannot support them:

* an ocean-wide condition inferred from a handful of profiles,
* a marine heatwave inferred from a difference against climatology,
* a detected thermocline inferred from the steepest cooling interval,
* "conditions were normal" inferred from missing observations.

If the evidence supports no approved sentence, that is reported as
``insufficient_evidence`` with what was rejected, never smoothed over.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from .evidence import VARIABLE_WORDS
from .nl_provider import (
    JsonCompletionProvider,
    ProviderError,
    ProviderNotConfigured,
    ProviderTimeout,
    scrub_secrets,
)
from .woa import json_safe

EXPLAIN_SCHEMA_VERSION = "1.0"

#: A short explanation is the point; this is a ceiling, not a target.
MAX_SENTENCES = 6


class ExplainOutcome(str, Enum):
    """Distinct answers an explanation attempt can produce."""

    #: Sentences were selected and every referenced fact resolved.
    EXPLAINED = "explained"
    #: The evidence cannot support any approved sentence.
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    #: No provider, a timeout, or a response this module will not accept.
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    #: The caller's result came from different data than this server holds.
    DATASET_MISMATCH = "dataset_mismatch"


class Template:
    """One approved sentence and the facts it needs.

    ``text`` uses ``{0}``, ``{1}`` ... for the facts supplied, in slot order,
    and may use ``{subject}`` for the variable name, which is derived from the
    facts rather than supplied.

    ``requires`` gives one pattern per slot. A pattern is matched as a prefix,
    or with ``*`` standing for exactly one id segment - so
    ``variable.*.value_min`` accepts ``variable.temp.value_min`` but not
    ``variable.temp.depth_min_m``. A quantity therefore cannot land in a slot
    meant for a different one.
    """

    def __init__(self, id_: str, text: str, requires: list[str],
                 caveat: Optional[str] = None):
        self.id = id_
        self.text = text
        self.requires = requires
        self.caveat = caveat

    @property
    def needs_subject(self) -> bool:
        return "{subject}" in self.text

    def describe(self) -> dict:
        return {"id": self.id, "text": self.text, "requires": list(self.requires),
                "caveat": self.caveat}


#: The complete vocabulary. A sentence that is not here cannot be produced.
TEMPLATES: dict[str, Template] = {
    t.id: t for t in [
        Template(
            "scope.profiles",
            "This result covers {0} profiles from {1} floats, measured between "
            "{2} and {3}.",
            ["profiles.count", "profiles.float_count", "time.observed_start",
             "time.observed_end"],
            caveat="These are individual float positions, not a survey of the "
                   "water between them.",
        ),
        Template(
            "scope.locations",
            "The measurements come from {0} distinct positions.",
            ["region.sampled_location_count"],
            caveat="Nothing is known about places where no float sampled.",
        ),
        Template(
            "variable.range",
            "{subject} ranges from {0} to {1} across the returned levels.",
            ["variable.*.value_min", "variable.*.value_max"],
        ),
        Template(
            "variable.depth_span",
            "{subject} was measured between {0} and {1} depth.",
            ["variable.*.depth_min_m", "variable.*.depth_max_m"],
        ),
        Template(
            "variable.missing",
            "{subject} is reported for {1} profiles only: {0} levels have no "
            "value that passed quality control.",
            ["variable.*.excluded_observations", "variable.*.profiles_with_values"],
            caveat="Missing measurements say nothing about conditions there; "
                   "they are simply absent.",
        ),
        Template(
            "gradient.cooling",
            "The steepest fall in temperature with depth is {0}, between {1} "
            "and {2}.",
            ["gradient.temp.strongest_cooling.value",
             "gradient.temp.strongest_cooling.upper_depth_m",
             "gradient.temp.strongest_cooling.lower_depth_m"],
            caveat="This is the steepest interval in this result, not a "
                   "detected thermocline or mixed-layer depth.",
        ),
        Template(
            "gradient.count",
            "{subject} was compared across {0} adjacent level pairs.",
            ["gradient.*.interval_count"],
        ),
        Template(
            "derived.at_depth",
            "{0} values were computed at exactly {1}, between surrounding "
            "measured levels.",
            ["derived.count", "derived.target_depth_m"],
            caveat="Computed values are not measurements.",
        ),
        Template(
            "woa.difference",
            "Against the {2} monthly mean, one profile differs by {0} at {1}.",
            ["woa.difference", "woa.comparison_depth_m", "woa.baseline_period"],
            caveat="A difference from a long-term average is not an anomaly "
                   "test and not evidence of a marine heatwave.",
        ),
        Template(
            "sampling.spacing",
            "Levels are typically {0} apart, with the largest gap {1}.",
            ["depth.median_level_spacing_m", "depth.max_level_gap_m"],
        ),
    ]
}

#: Phrases refused wherever they appear in text a provider returns alongside
#: its selections. The templates already carry the honest wording, so a
#: provider has no legitimate reason to send any of these.
FORBIDDEN_CLAIMS = (
    "marine heatwave",
    "heat wave",
    "thermocline",
    "mixed-layer depth",
    "mixed layer depth",
    "ocean-wide",
    "across the ocean",
    "globally",
    "normal conditions",
    "conditions were normal",
    "conditions are normal",
    "proves",
    "confirms",
    "anomaly",
)


def _match_slot(fact_id: str, pattern: str) -> bool:
    """Does ``fact_id`` fit this slot?

    ``*`` stands for exactly one dotted segment; otherwise the pattern is a
    prefix (so ``profiles.count`` matches itself).
    """
    if "*" not in pattern:
        return fact_id == pattern or fact_id.startswith(pattern)
    pattern_parts = pattern.split(".")
    fact_parts = fact_id.split(".")
    if len(fact_parts) != len(pattern_parts):
        return False
    return all(p == "*" or p == f for p, f in zip(pattern_parts, fact_parts))


def _variable_of(fact_id: str) -> Optional[str]:
    """The variable a fact belongs to, for ``{subject}`` and slot agreement."""
    parts = fact_id.split(".")
    if len(parts) >= 2 and parts[0] in ("variable", "gradient"):
        return parts[1]
    return None


def _format_value(fact: dict) -> str:
    """Render one fact's value with its unit, at a readable precision."""
    value = fact.get("value")
    units = fact.get("units")
    if isinstance(value, bool):
        text = "yes" if value else "no"
    elif isinstance(value, float):
        magnitude = abs(value)
        if magnitude >= 100:
            text = f"{value:.1f}"
        elif magnitude >= 1:
            text = f"{value:.2f}"
        else:
            # Gradients are small; two decimals would round them away.
            text = f"{value:.3f}"
        if "." in text:
            text = text.rstrip("0").rstrip(".")
    else:
        text = str(value)
        if isinstance(value, str) and "T" in value and len(value) >= 10:
            if value[4] == "-" and value[7] == "-":
                text = value[:10]
    if not units:
        return text
    if units == "UTC":
        return f"{text} UTC"
    return f"{text} {units}"


def _envelope(outcome: ExplainOutcome, **extra) -> dict:
    payload: dict[str, Any] = {
        "schema_version": EXPLAIN_SCHEMA_VERSION,
        "outcome": outcome.value,
        "sentences": [],
        "caveats": [],
        "limitations": [],
        "used_fact_ids": [],
        "rejected": [],
        "provider_message": None,
        "dataset_version": None,
        "plan_fingerprint": None,
        "source": None,
    }
    payload.update(extra)
    return json_safe(payload)


def render(evidence: dict, selections: Any, max_sentences: int = MAX_SENTENCES) -> tuple[list, list, list, list]:
    """Fill approved templates from the evidence.

    Returns ``(sentences, caveats, used_fact_ids, rejected)``. A selection is
    rejected whole - never partially rendered - when its template is unknown,
    its fact count is wrong, a fact id is absent from the evidence, a fact does
    not fit its slot, or the slots disagree about which variable they describe.
    """
    by_id = {fact["id"]: fact for fact in evidence.get("facts", [])}
    sentences: list[dict] = []
    caveats: list[str] = []
    used: list[str] = []
    rejected: list[dict] = []
    seen: set[tuple] = set()

    if not isinstance(selections, list):
        return sentences, caveats, used, [
            {"reason": "malformed_selections", "detail": type(selections).__name__}]

    for selection in selections:
        if len(sentences) >= max_sentences:
            rejected.append({"reason": "too_many_sentences", "detail": None})
            break
        if not isinstance(selection, dict):
            rejected.append({"reason": "malformed_selection", "detail": None})
            continue

        template_id = selection.get("template")
        fact_ids = selection.get("facts")
        template = TEMPLATES.get(template_id) if isinstance(template_id, str) else None
        if template is None:
            rejected.append({"reason": "unknown_template", "detail": str(template_id)})
            continue
        if not isinstance(fact_ids, list) or len(fact_ids) != len(template.requires):
            rejected.append({"reason": "wrong_fact_count", "detail": template.id})
            continue

        resolved: list[dict] = []
        problem: Optional[dict] = None
        subject: Optional[str] = None
        for fact_id, pattern in zip(fact_ids, template.requires):
            fact = by_id.get(fact_id) if isinstance(fact_id, str) else None
            if fact is None:
                problem = {"reason": "unknown_fact", "detail": str(fact_id)}
                break
            if not _match_slot(fact["id"], pattern):
                problem = {"reason": "fact_does_not_fit_slot",
                           "detail": f"{fact_id} offered for {pattern}"}
                break
            variable = _variable_of(fact["id"])
            if variable is not None:
                if subject is None:
                    subject = variable
                elif subject != variable:
                    # One sentence describing two variables would misattribute
                    # a value; there is no honest way to render it.
                    problem = {"reason": "mixed_variables",
                               "detail": f"{subject} and {variable}"}
                    break
            resolved.append(fact)
        if problem is not None:
            rejected.append(problem)
            continue
        if template.needs_subject and subject is None:
            rejected.append({"reason": "no_subject", "detail": template.id})
            continue

        # The same sentence about the same variable twice is noise, but the
        # same template about temperature and salinity is two real sentences.
        key = (template.id, subject)
        if key in seen:
            rejected.append({"reason": "duplicate_sentence", "detail": template.id})
            continue

        word = VARIABLE_WORDS.get(subject, subject) if subject else ""
        sentences.append({
            "template": template.id,
            "variable": subject,
            # Values are substituted here, from the evidence, never by a model.
            "text": template.text.format(
                *[_format_value(f) for f in resolved],
                subject=word[:1].upper() + word[1:] if word else ""),
            "fact_ids": [f["id"] for f in resolved],
        })
        seen.add(key)
        used.extend(f["id"] for f in resolved)
        if template.caveat and template.caveat not in caveats:
            caveats.append(template.caveat)

    return sentences, caveats, list(dict.fromkeys(used)), rejected


#: The deterministic summary's running order, widest scope first. Each entry is
#: used only when every fact it names is present in the evidence.
_SUMMARY_ORDER: list[tuple[str, list[str]]] = [
    ("scope.profiles", ["profiles.count", "profiles.float_count",
                        "time.observed_start", "time.observed_end"]),
    ("scope.locations", ["region.sampled_location_count"]),
    ("variable.range", ["variable.temp.value_min", "variable.temp.value_max"]),
    ("variable.depth_span", ["variable.temp.depth_min_m",
                             "variable.temp.depth_max_m"]),
    ("variable.missing", ["variable.psal.excluded_observations",
                          "variable.psal.profiles_with_values"]),
    ("gradient.cooling", ["gradient.temp.strongest_cooling.value",
                          "gradient.temp.strongest_cooling.upper_depth_m",
                          "gradient.temp.strongest_cooling.lower_depth_m"]),
]


def data_summary(evidence: dict, mode: str = "student") -> dict:
    """A short explanation built with no model at all.

    Used when no provider is configured or the provider fails. The caller
    labels it a data summary, so it is never shown as an AI answer.
    """
    available = {fact["id"] for fact in evidence.get("facts", [])}
    
    order = []
    if mode == "student":
        vars_present = set()
        for fact_id in available:
            if fact_id.startswith("variable."):
                parts = fact_id.split(".")
                if len(parts) >= 2:
                    vars_present.add(parts[1])
        for v in sorted(vars_present):
            order.append(("variable.range", [f"variable.{v}.value_min", f"variable.{v}.value_max"]))
        order.append(("scope.profiles", ["profiles.count", "profiles.float_count", "time.observed_start", "time.observed_end"]))
        for item in _SUMMARY_ORDER:
            if item not in order:
                order.append(item)
    else:
        order = _SUMMARY_ORDER
        
    selections = [{"template": template_id, "facts": fact_ids}
                  for template_id, fact_ids in order
                  if all(fact_id in available for fact_id in fact_ids)]
                  
    max_sentences = 3 if mode == "student" else MAX_SENTENCES
    sentences, caveats, used, rejected = render(evidence, selections, max_sentences)
    return {"sentences": sentences, "caveats": caveats, "used_fact_ids": used,
            "rejected": rejected}


SYSTEM_PROMPT = (
    "You help a reader understand ocean measurements that have already been "
    "computed. You never state a number yourself and you never write prose.\n\n"
    "You are given FACTS, each with an id, and TEMPLATES, each with an id and "
    "numbered slots. Reply with JSON only:\n"
    '{"selections": [{"template": "<template id>", "facts": ["<fact id>", ...]}]}\n\n'
    "Rules:\n"
    "- Use only the template ids and fact ids given. Anything else is rejected.\n"
    "- Give exactly as many fact ids as the template requires, in slot order, "
    "and matching the slot patterns shown.\n"
    "- All slots in one sentence must describe the same variable.\n"
    "- Choose at most six sentences, scope first, then measurements, then "
    "anything missing or derived.\n"
    "- Do not claim an ocean-wide condition from a few profiles, a marine "
    "heatwave from a climatology difference, a detected thermocline from the "
    "steepest cooling interval, or normal conditions from missing data.\n"
    '- If the facts support no sentence, reply {"selections": []}.'
)


def build_user_prompt(evidence: dict) -> str:
    """The facts and templates as compact text - no observation arrays."""
    lines = ["FACTS:"]
    for fact in evidence.get("facts", []):
        units = f" in {fact['units']}" if fact.get("units") else ""
        lines.append(f"- {fact['id']}: {fact['label']}{units} [{fact['kind']}]")
    lines.append("")
    lines.append("TEMPLATES:")
    for template in TEMPLATES.values():
        lines.append(f"- {template.id}: \"{template.text}\" "
                     f"slots: {', '.join(template.requires)}")
    limitations = evidence.get("limitations") or []
    if limitations:
        lines.append("")
        lines.append("KNOWN LIMITATIONS (already shown to the reader):")
        for item in limitations[:6]:
            lines.append(f"- {item.get('code')}")
    return "\n".join(lines)


def explain_result(evidence: dict,
                   provider: Optional[JsonCompletionProvider],
                   mode: str = "student") -> dict:
    """Produce an explanation for one set of evidence.

    Expected failures never raise: a missing provider, a timeout or an
    unusable response all return ``provider_unavailable`` carrying the
    deterministic data summary, which the caller presents as such.
    """
    common = {
        "dataset_version": evidence.get("dataset_version"),
        "plan_fingerprint": evidence.get("plan_fingerprint"),
        "limitations": evidence.get("limitations") or [],
    }

    if not evidence.get("facts"):
        return _envelope(
            ExplainOutcome.INSUFFICIENT_EVIDENCE,
            provider_message="This result carries no measurements to explain.",
            **common)

    fallback = data_summary(evidence, mode)

    def as_summary(message: str) -> dict:
        return _envelope(
            ExplainOutcome.PROVIDER_UNAVAILABLE,
            # Scrubbed again on the way out: this string is shown to the user,
            # and a provider message is not guaranteed to have been cleaned.
            provider_message=scrub_secrets(message),
            source="data_summary",
            sentences=fallback["sentences"],
            caveats=fallback["caveats"],
            used_fact_ids=fallback["used_fact_ids"],
            **common)

    if provider is None:
        return as_summary(
            "No explanation service is configured, so this is a data summary "
            "built directly from the result.")

    prompt = SYSTEM_PROMPT
    if mode == "student":
        prompt = prompt.replace(
            "- Choose at most six sentences, scope first, then measurements, then anything missing or derived.\n",
            "- Give a direct, useful summary.\n"
            "- Choose at most three short findings.\n"
            "- Address temperature and salinity when both were requested.\n"
        )

    try:
        raw = provider.complete_json(prompt, build_user_prompt(evidence))
    except ProviderNotConfigured as exc:
        return as_summary(str(exc))
    except ProviderTimeout as exc:
        return as_summary(str(exc))
    except ProviderError as exc:
        return as_summary(str(exc))

    if not isinstance(raw, dict):
        return as_summary(
            "The explanation service returned a response this build does not "
            "accept, so this is a data summary instead.")

    # Any prose returned alongside the selections is inspected but never
    # displayed; a forbidden claim discards the whole answer.
    returned_text = " ".join(
        str(value) for key, value in raw.items()
        if key != "selections" and isinstance(value, str)).lower()
    if any(claim in returned_text for claim in FORBIDDEN_CLAIMS):
        return as_summary(
            "The explanation service made a claim this build does not allow, "
            "so this is a data summary instead.")

    sentences, caveats, used, rejected = render(evidence, raw.get("selections"), max_sentences=3 if mode == "student" else MAX_SENTENCES)

    if not sentences:
        return _envelope(
            ExplainOutcome.INSUFFICIENT_EVIDENCE,
            provider_message="No approved sentence could be supported by this "
                             "result.",
            rejected=rejected,
            source="model",
            **common)

    return _envelope(
        ExplainOutcome.EXPLAINED,
        sentences=sentences,
        caveats=caveats,
        used_fact_ids=used,
        rejected=rejected,
        source="model",
        **common)
