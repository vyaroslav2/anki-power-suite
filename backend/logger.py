# backend/logger.py
import os
import json
from datetime import datetime
from aqt import mw

# Define the log file path (lives right next to your config.json)
ADDON_PATH = os.path.dirname(os.path.dirname(__file__))
LOG_FILE = os.path.join(ADDON_PATH, "debug.jsonl")

def wipe_log_on_init(editor):
    """Fired when Editor opens. Wipes the old log and starts fresh."""
    try:
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            # Start the file with a system info block
            f.write(json.dumps({
                "timestamp": datetime.now().isoformat(),
                "type": "system_init",
                "message": "New Editor Session Started"
            }) + "\n")
    except Exception as e:
        print(f"Failed to clear log: {e}")

def write_to_log(event_dict):
    """Appends a single JSON line to the log file."""
    if "timestamp" not in event_dict:
        event_dict["timestamp"] = datetime.now().isoformat()
        
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(event_dict) + "\n")
    except Exception as e:
        print(f"Failed to write to log: {e}")

def handle_js_message(handled: tuple[bool, object], message: str, context: object) -> tuple[bool, object]:
    """Intercepts pycmd messages from our JavaScript Flight Recorder."""
    # Check if the message is meant for our debugger
    if message.startswith("powersuite-debug:"):
        json_payload = message.replace("powersuite-debug:", "", 1)
        try:
            event_dict = json.loads(json_payload)
            write_to_log(event_dict)
        except json.JSONDecodeError:
            write_to_log({
                "type": "error", 
                "message": "Failed to parse JS debug payload", 
                "raw_payload": json_payload
            })
        
        # Tell Anki we handled this message so it doesn't throw an error
        return (True, None)
        
    # Let Anki handle normal messages
    return handled

def log_tooltip(message: str):
    """Intercepts Python tooltips to log them before showing."""
    write_to_log({
        "type": "tooltip",
        "message": message
    })
    # We still import the real tooltip to actually show it
    from aqt.utils import tooltip
    tooltip(message)