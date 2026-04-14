# backend/logger.py
import os
import json
import subprocess
from datetime import datetime
from aqt import mw

# Define the log file path (lives right next to your config.json)
ADDON_PATH = os.path.dirname(os.path.dirname(__file__))
LOG_FILE = os.path.join(ADDON_PATH, "debug.head.jsonl")
MAX_LOG_FILES = 5

def get_git_commit():
    """Retrieve the current git commit hash."""
    try:
        # Prevent showing a console window on Windows
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], 
            cwd=ADDON_PATH, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE, 
            text=True, 
            check=True,
            startupinfo=startupinfo
        )
        return result.stdout.strip()
    except Exception:
        return "unknown_commit"

def rotate_logs():
    """Rotates log files: head -> head~1 -> head~2 ... deleting the oldest."""
    # Handle migration from old debug.jsonl
    old_legacy_log = os.path.join(ADDON_PATH, "debug.jsonl")
    if os.path.exists(old_legacy_log):
        try:
            os.rename(old_legacy_log, LOG_FILE)
        except Exception:
            pass

    for i in range(MAX_LOG_FILES - 1, 0, -1):
        old_name = "debug.head.jsonl" if i == 1 else f"debug.head~{i-1}.jsonl"
        new_name = f"debug.head~{i}.jsonl"
        
        old_path = os.path.join(ADDON_PATH, old_name)
        new_path = os.path.join(ADDON_PATH, new_name)
        
        if os.path.exists(old_path):
            try:
                if os.path.exists(new_path):
                    os.remove(new_path)
                os.rename(old_path, new_path)
            except Exception as e:
                print(f"Failed to rotate {old_name} to {new_name}: {e}")

def wipe_log_on_init(editor):
    """Fired when Editor opens. Rotates old logs and starts fresh."""
    rotate_logs()
    
    try:
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            # Start the file with a system info block
            f.write(json.dumps({
                "timestamp": datetime.now().isoformat(),
                "type": "system_init",
                "git_commit": get_git_commit(),
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

import aqt.utils
_original_tooltip = aqt.utils.tooltip

def log_tooltip(message: str, period: int = 3000, parent=None, **kwargs):
    """Intercepts Python tooltips to log them before showing, and logs when they disappear."""
    from aqt.qt import QTimer
    
    # 1. Log the exact moment it appears and how long it is scheduled to stay
    write_to_log({
        "type": "tooltip_show",
        "message": message,
        "duration_ms": period
    })
    
    # 2. Define a delayed function to log when it vanishes
    def on_hide():
        write_to_log({
            "type": "tooltip_hide",
            "message": message
        })
        
    # 3. Spawn a native Qt timer to fire the hide log exactly when the tooltip fades
    QTimer.singleShot(period, on_hide)
    
    # 4. Call the real Anki tooltip so it actually shows up on screen
    _original_tooltip(message, period=period, parent=parent, **kwargs)

# Globally monkey-patch Anki's tooltip so we catch system messages like 'Processing...'
aqt.utils.tooltip = log_tooltip

# Catch native Anki progress dialogs (like the striped "Processing..." window)
import aqt.progress
_original_progress_start = aqt.progress.ProgressManager.start
_original_progress_update = aqt.progress.ProgressManager.update
_original_progress_finish = aqt.progress.ProgressManager.finish

def log_progress_start(self, *args, **kwargs):
    label = kwargs.get('label') or (args[0] if args else "Processing...")
    write_to_log({
        "type": "progress_start",
        "message": label
    })
    return _original_progress_start(self, *args, **kwargs)

def log_progress_update(self, *args, **kwargs):
    label = kwargs.get('label') or (args[0] if args else None)
    if label:
        write_to_log({
            "type": "progress_update",
            "message": label
        })
    return _original_progress_update(self, *args, **kwargs)

def log_progress_finish(self, *args, **kwargs):
    write_to_log({
        "type": "progress_finish"
    })
    return _original_progress_finish(self, *args, **kwargs)

aqt.progress.ProgressManager.start = log_progress_start
aqt.progress.ProgressManager.update = log_progress_update
aqt.progress.ProgressManager.finish = log_progress_finish