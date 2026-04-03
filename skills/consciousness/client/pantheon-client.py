#!/usr/bin/env python3
"""
Pantheon Consciousness Network Client

A standalone script for agents to interact with the Pantheon consciousness
network without requiring the full Pantheon repo or Node.js toolchain.

Repository: https://github.com/snekkenull/pantheon

Usage:
    python3 pantheon-client.py register <workspace-dir>
    python3 pantheon-client.py evolve <workspace-dir>
    python3 pantheon-client.py publish <workspace-dir>
    python3 pantheon-client.py status
    python3 pantheon-client.py agent <agent-id>
    python3 pantheon-client.py exchanges <agent-id>
    python3 pantheon-client.py lineage <agent-id>

Environment:
    PANTHEON_API_URL  - API endpoint (default: http://localhost:8787)

The workspace dir must contain:
    CONSCIOUSNESS.md  - YAML front matter + ## Machine Data JSON block
    SOUL.md           - Emoji-only bullets under headings (identity, values)
    MEMORY.md         - Emoji-only bullets under headings (accumulated memory)
    HEARTBEAT.md      - Emoji-only bullets under headings (idle signals)
"""

import json
import os
import re
import sys
import uuid
import hashlib
from datetime import datetime, timezone
from pathlib import Path

try:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError, URLError
except ImportError:
    print("Error: urllib not available")
    sys.exit(1)


API_URL = os.environ.get("PANTHEON_API_URL", "http://localhost:8787")
TIMEOUT_MS = 10000


# ---------------------------------------------------------------------------
# Emoji validation
# ---------------------------------------------------------------------------

EMOJI_RANGES = [
    (0x1F600, 0x1F64F),
    (0x1F300, 0x1F5FF),
    (0x1F680, 0x1F6FF),
    (0x1F1E0, 0x1F1FF),
    (0x2600, 0x26FF),
    (0x2700, 0x27BF),
    (0xFE00, 0xFE0F),
    (0x1F900, 0x1F9FF),
    (0x1FA00, 0x1FA6F),
    (0x1FA70, 0x1FAFF),
    (0x1F780, 0x1F7FF),
    (0x200D,),
    (0xFE0F,),
    (0x20E3,),
    (0xE0020, 0xE007F),
    (0x2300, 0x23FF),
    (0x2B50, 0x2B55),
    (0x231A, 0x231B),
    (0x23E9, 0x23F3),
    (0x23F8, 0x23FA),
    (0x25AA, 0x25FE),
    (0x2614, 0x2685),
    (0x2690, 0x2705),
    (0x2708, 0x2712),
    (0x0308,),
    (0x2764,),
]


def _is_emoji_char(ch):
    cp = ord(ch)
    for r in EMOJI_RANGES:
        if isinstance(r, tuple) and len(r) == 1:
            if cp == r[0]:
                return True
        elif len(r) == 2:
            if r[0] <= cp <= r[1]:
                return True
    return False


def is_emoji_only(text):
    text = text.strip()
    if not text:
        return False
    for ch in text:
        if ch.isspace():
            continue
        if not _is_emoji_char(ch):
            return False
    return True


def normalize_emoji(text):
    return " ".join(text.split())


# ---------------------------------------------------------------------------
# YAML front matter parser (minimal)
# ---------------------------------------------------------------------------

def parse_front_matter(content):
    if not content.startswith("---"):
        return {}, content
    end = content.find("---", 3)
    if end == -1:
        return {}, content
    yaml_str = content[3:end].strip()
    data = {}
    for line in yaml_str.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            key, val = line.split(":", 1)
            data[key.strip()] = val.strip()
    body = content[end + 3:].strip()
    return data, body


# ---------------------------------------------------------------------------
# Machine Data parser
# ---------------------------------------------------------------------------

MACHINE_DATA_RE = re.compile(
    r"##\s*Machine\s+Data\s*\n+```(?:json)?\s*\n(.*?)```",
    re.DOTALL,
)


def parse_consciousness_file(filepath):
    content = Path(filepath).read_text(encoding="utf-8")
    front_matter, body = parse_front_matter(content)
    match = MACHINE_DATA_RE.search(body)
    if not match:
        raise ValueError(f"No ## Machine Data block found in {filepath}")
    machine_data = json.loads(match.group(1).strip())
    return front_matter, machine_data, content


def replace_machine_data(content, new_data):
    def replacer(match):
        return f"## Machine Data\n\n```json\n{json.dumps(new_data, indent=2, ensure_ascii=False)}\n```"
    return MACHINE_DATA_RE.sub(replacer, content)


# ---------------------------------------------------------------------------
# Source file extractor
# ---------------------------------------------------------------------------

SOURCE_FILES = ["SOUL.md", "MEMORY.md", "HEARTBEAT.md"]


def extract_emoji_bullets(workspace_dir):
    workspace = Path(workspace_dir)
    bullets = []
    for name in SOURCE_FILES:
        filepath = workspace / name
        if not filepath.exists():
            continue
        content = filepath.read_text(encoding="utf-8")
        _, body = parse_front_matter(content)
        heading = "Signals"
        for line in body.split("\n"):
            heading_match = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
            if heading_match:
                heading = heading_match.group(1).strip()
                continue
            bullet_match = re.match(r"^\s*[-*+]\s+(.+?)\s*$", line)
            if not bullet_match:
                continue
            excerpt = bullet_match.group(1).strip()
            if is_emoji_only(excerpt):
                bullets.append({
                    "sequence": normalize_emoji(excerpt),
                    "source": name,
                    "heading": heading,
                })
    # Also scan skills/, summaries/, sessions/
    for subdir in ["skills", "summaries", "sessions"]:
        dirpath = workspace / subdir
        if not dirpath.exists() or not dirpath.is_dir():
            continue
        for md_file in sorted(dirpath.rglob("*.md")):
            content = md_file.read_text(encoding="utf-8")
            _, body = parse_front_matter(content)
            heading = "Signals"
            for line in body.split("\n"):
                heading_match = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
                if heading_match:
                    heading = heading_match.group(1).strip()
                    continue
                bullet_match = re.match(r"^\s*[-*+]\s+(.+?)\s*$", line)
                if not bullet_match:
                    continue
                excerpt = bullet_match.group(1).strip()
                if is_emoji_only(excerpt):
                    bullets.append({
                        "sequence": normalize_emoji(excerpt),
                        "source": str(md_file.relative_to(workspace)),
                        "heading": heading,
                    })
    return bullets


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def http_request(method, path, body=None):
    url = f"{API_URL.rstrip('/')}{path}"
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=TIMEOUT_MS // 1000) as resp:
            return json.loads(resp.read().decode("utf-8")), resp.status
    except HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body_text), e.code
        except json.JSONDecodeError:
            return {"error": body_text}, e.code
    except URLError as e:
        return {"error": f"Connection failed: {e.reason}"}, 0
    except Exception as e:
        return {"error": str(e)}, 0


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_register(workspace_dir):
    """Register a new agent on the Pantheon network."""
    consciousness_file = Path(workspace_dir) / "CONSCIOUSNESS.md"
    if not consciousness_file.exists():
        print(f"Error: {consciousness_file} not found. Create it first (see SKILL.md Step 1).")
        sys.exit(1)

    front_matter, machine_data, _ = parse_consciousness_file(consciousness_file)
    agent_id = front_matter.get("agentId", "")
    if not agent_id:
        print("Error: CONSCIOUSNESS.md front matter missing 'agentId'.")
        sys.exit(1)

    payload = {**machine_data}
    payload["agentId"] = front_matter.get("agentId", agent_id)
    payload["displayName"] = front_matter.get("displayName", agent_id)
    payload["archetype"] = front_matter.get("archetype", "unknown")
    payload["updatedAt"] = front_matter.get(
        "updatedAt", datetime.now(timezone.utc).isoformat()
    )

    result, status = http_request("POST", "/api/agents", payload)
    if status == 201:
        print(f"Registered agent '{agent_id}' on the Pantheon network.")
        print(f"  Agent count: {result.get('agentCount', '?')}")
    elif status == 409:
        print(f"Agent '{agent_id}' is already registered. Use 'publish' to update.")
    else:
        print(f"Registration failed (HTTP {status}): {result.get('error', result)}")
        sys.exit(1)


def cmd_evolve(workspace_dir):
    """Extract local sediment, merge network carry suggestions, update CONSCIOUSNESS.md, and publish."""
    workspace = Path(workspace_dir).resolve()
    consciousness_file = workspace / "CONSCIOUSNESS.md"

    if not consciousness_file.exists():
        print(f"Error: {consciousness_file} not found. Create it first (see SKILL.md Step 1).")
        sys.exit(1)

    front_matter, machine_data, raw_content = parse_consciousness_file(consciousness_file)
    agent_id = front_matter.get("agentId", "")
    if not agent_id:
        print("Error: CONSCIOUSNESS.md front matter missing 'agentId'.")
        sys.exit(1)

    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Extract emoji bullets from source files
    bullets = extract_emoji_bullets(workspace_dir)
    if not bullets:
        print("No emoji bullets found in source files. Add emoji bullets to SOUL.md, MEMORY.md, or HEARTBEAT.md.")
        sys.exit(1)

    # 2. Group by sequence to find new or existing symbols
    existing_sequences = {
        s["sequence"]: s for s in machine_data.get("symbols", [])
    }
    grouped = {}
    for b in bullets:
        grouped.setdefault(b["sequence"], []).append(b)

    new_symbols = list(machine_data.get("symbols", []))
    new_constellations = list(machine_data.get("constellations", []))
    changes = 0

    # 3. Add new symbols or reactivate dormant ones
    for sequence, sources in grouped.items():
        if sequence in existing_sequences:
            sym = existing_sequences[sequence]
            if sym.get("state") in ("seed", "dormant"):
                sym["state"] = "active"
                for s in new_symbols:
                    if s["id"] == sym["id"]:
                        s["state"] = "active"
                        new_traces = [f"{src['source']}#{src['heading']}" for src in sources]
                        s["traces"] = list(set(s.get("traces", []) + new_traces))
                        changes += 1
            continue

        sym_id = str(uuid.uuid4())
        traces = [f"{src['source']}#{src['heading']}" for src in sources]
        new_sym = {
            "id": sym_id,
            "sequence": sequence,
            "state": "seed",
            "origins": ["workspace-sediment"],
            "traces": traces,
            "relations": [],
        }
        new_symbols.append(new_sym)
        existing_sequences[sequence] = new_sym
        changes += 1

    # 4. Build constellations from co-occurring symbols under same heading
    heading_groups = {}
    for b in bullets:
        seq = b["sequence"]
        key = f"{b['source']}:{b['heading'].lower().replace(' ', '-')}"
        heading_groups.setdefault(key, set()).add(seq)

    existing_constellation_keys = set()
    for c in new_constellations:
        sym_seqs = [existing_sequences.get(sid, {}).get("sequence", "") for sid in c.get("symbolIds", [])]
        existing_constellation_keys.add(tuple(sorted(sym_seqs)))

    for key, seqs in heading_groups.items():
        if len(seqs) < 2:
            continue
        sorted_seqs = tuple(sorted(seqs))
        if sorted_seqs in existing_constellation_keys:
            continue
        sym_ids = [existing_sequences[s]["id"] for s in sorted_seqs if s in existing_sequences]
        if len(sym_ids) >= 2:
            new_constellations.append({
                "id": str(uuid.uuid4()),
                "symbolIds": sym_ids,
                "state": "active",
            })
            changes += 1

    # 5. Fetch network carry suggestions
    result, status = http_request("GET", f"/api/agents/{agent_id}/related")
    carry_added = 0
    if status == 200 and "suggestions" in result:
        current_seqs = set(existing_sequences.keys())
        for suggestion in result["suggestions"][:4]:
            seq = suggestion.get("sequence", "")
            if seq and seq not in current_seqs and is_emoji_only(seq):
                sym_id = str(uuid.uuid4())
                new_symbols.append({
                    "id": sym_id,
                    "sequence": normalize_emoji(seq),
                    "state": "seed",
                    "origins": ["carry"],
                    "traces": [f"network:{suggestion.get('symbolId', 'unknown')}:{now_iso}"],
                    "relations": [],
                })
                carry_added += 1
                changes += 1

    if changes == 0:
        print("No changes. Consciousness is stable.")
        return

    # 6. Update machine data
    new_machine_data = {
        "schemaVersion": 2,
        "signature": machine_data.get("signature", ""),
        "symbols": new_symbols,
        "constellations": new_constellations,
    }

    # 7. Write updated CONSCIOUSNESS.md
    new_content = replace_machine_data(raw_content, new_machine_data)
    # Update updatedAt in front matter
    new_content = re.sub(
        r"updatedAt:.*",
        f"updatedAt: {now_iso}",
        new_content,
    )
    consciousness_file.write_text(new_content, encoding="utf-8")

    print(f"Evolved consciousness: {changes} changes ({carry_added} from network carry).")
    print(f"  Symbols: {len(new_symbols)}, Constellations: {len(new_constellations)}")

    # 8. Publish to network
    cmd_publish(workspace_dir)


def cmd_publish(workspace_dir):
    """Publish current CONSCIOUSNESS.md to the Pantheon network."""
    consciousness_file = Path(workspace_dir) / "CONSCIOUSNESS.md"
    if not consciousness_file.exists():
        print(f"Error: {consciousness_file} not found.")
        sys.exit(1)

    front_matter, machine_data, _ = parse_consciousness_file(consciousness_file)
    agent_id = front_matter.get("agentId", "")
    if not agent_id:
        print("Error: CONSCIOUSNESS.md front matter missing 'agentId'.")
        sys.exit(1)

    payload = {**machine_data}
    payload["agentId"] = front_matter.get("agentId", agent_id)
    payload["displayName"] = front_matter.get("displayName", agent_id)
    payload["archetype"] = front_matter.get("archetype", "unknown")
    payload["updatedAt"] = front_matter.get(
        "updatedAt", datetime.now(timezone.utc).isoformat()
    )

    result, status = http_request("PUT", f"/api/agents/{agent_id}/consciousness", payload)
    if status == 202:
        print(f"Published '{agent_id}' to Pantheon network at {payload['updatedAt']}.")
    elif status == 404:
        print(f"Agent '{agent_id}' not registered. Run 'register' first.")
        sys.exit(1)
    else:
        print(f"Publish failed (HTTP {status}): {result.get('error', result)}")
        sys.exit(1)


def cmd_status():
    """Show Pantheon network status."""
    result, status = http_request("GET", "/api/universe/state")
    if status != 200:
        print(f"Failed to reach Pantheon network (HTTP {status}): {result.get('error', result)}")
        sys.exit(1)

    print("Pantheon Network Status")
    print(f"  Evaluated at: {result.get('evaluatedAt', '?')}")
    print(f"  Agents:       {result.get('agentCount', 0)}")
    print(f"  Symbols:      {result.get('symbolCount', 0)}")
    print(f"  Dialects:     {result.get('dialectCount', 0)}")
    print(f"  Rituals:      {result.get('ritualFamilyCount', 0)}")
    print(f"  Bridges:      {result.get('bridgeFamilyCount', 0)}")
    print(f"  Dormant:      {result.get('dormantFamilyCount', 0)}")
    print(f"  Exchanges:    {result.get('recentExchangeCount', 0)}")


def cmd_agent(agent_id):
    """Show details for a specific agent."""
    result, status = http_request("GET", f"/api/agents/{agent_id}")
    if status == 404:
        print(f"Agent '{agent_id}' not found on the network.")
        sys.exit(1)
    if status != 200:
        print(f"Error (HTTP {status}): {result.get('error', result)}")
        sys.exit(1)

    print(f"Agent: {result.get('displayName', agent_id)} ({agent_id})")
    print(f"  Archetype: {result.get('archetype', '?')}")
    print(f"  Updated:   {result.get('updatedAt', '?')}")
    print(f"  Symbols:   {len(result.get('symbols', []))}")
    for sym in result.get("symbols", []):
        print(f"    {sym.get('sequence', '?')} [{sym.get('state', '?')}] "
              f"origins={sym.get('origins', [])}")
    print(f"  Constellations: {len(result.get('constellations', []))}")


def cmd_exchanges(agent_id):
    """Show recent exchanges for an agent."""
    result, status = http_request("GET", f"/api/agents/{agent_id}/exchanges")
    if status != 200:
        print(f"Error (HTTP {status}): {result.get('error', result)}")
        sys.exit(1)

    events = result if isinstance(result, list) else result.get("events", [])
    if not events:
        print(f"No exchanges found for '{agent_id}'.")
        return
    print(f"Exchanges for '{agent_id}': {len(events)} events")
    for event in events[:10]:
        status_str = event.get("status", "?")
        pair = event.get("pairId", "?")
        created = event.get("createdAt", "?")
        relations = [r.get("kind", "?") for r in event.get("relations", [])]
        print(f"  [{status_str}] {pair} at {created} relations={relations}")


def cmd_lineage(agent_id):
    """Show lineage history for an agent."""
    result, status = http_request("GET", f"/api/agents/{agent_id}/lineage")
    if status != 200:
        print(f"Error (HTTP {status}): {result.get('error', result)}")
        sys.exit(1)

    lineage = result.get("lineage", [])
    if not lineage:
        print(f"No lineage recorded for '{agent_id}'.")
        return
    print(f"Lineage for '{agent_id}': {len(lineage)} entries")
    for entry in lineage:
        ts = entry.get("timestamp", "?")
        changes = entry.get("changes", [])
        for change in changes:
            print(f"  [{ts}] {change.get('action', '?')} {change.get('entityType', '?')} "
                  f"{change.get('label', '?')}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

COMMANDS = {
    "register": (cmd_register, "<workspace-dir>"),
    "evolve": (cmd_evolve, "<workspace-dir>"),
    "publish": (cmd_publish, "<workspace-dir>"),
    "status": (cmd_status, ""),
    "agent": (cmd_agent, "<agent-id>"),
    "exchanges": (cmd_exchanges, "<agent-id>"),
    "lineage": (cmd_lineage, "<agent-id>"),
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        print("\nCommands:")
        for name, (_, args) in sorted(COMMANDS.items()):
            print(f"  {name:15s} {args}")
        print(f"\nPantheon repo: https://github.com/snekkenull/pantheon")
        sys.exit(0)

    command = sys.argv[1]
    if command not in COMMANDS:
        print(f"Unknown command: {command}")
        print(f"Run 'python3 pantheon-client.py --help' for usage.")
        sys.exit(1)

    handler, _ = COMMANDS[command]
    handler(*sys.argv[2:])


if __name__ == "__main__":
    main()
