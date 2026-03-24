import os
import json
from aqt import gui_hooks
from aqt.editor import Editor

ADDON_PATH = os.path.dirname(__file__)
CONFIG_PATH = os.path.join(ADDON_PATH, "config.json")
UTILS_JS_PATH = os.path.join(ADDON_PATH, "frontend", "shared_utils.js")
ACTIONS_JS_PATH = os.path.join(ADDON_PATH, "frontend", "hotkey_actions.js")
PASSIVE_JS_PATH = os.path.join(ADDON_PATH, "frontend", "passive_listeners.js")

def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading config: {e}")
        return {}

# --- NEW: Background Scripts (Smart Trim) ---
def on_editor_init(editor: Editor):
    config = load_config()
    
    try:
        with open(UTILS_JS_PATH, "r", encoding="utf-8") as f:
            utils_js = f.read()
            
        passive_js = ""
        if config.get("enable_smart_trim", True):
            with open(PASSIVE_JS_PATH, "r", encoding="utf-8") as f:
                passive_js = f.read()

        combined_js = f"{utils_js}\n{passive_js}"
        editor.web.eval(combined_js)
    except Exception as e:
        print(f"Error loading background JS: {e}")

# --- EXISTING: Hotkey Scripts (Line Formatter) ---
def trigger_formatter(editor: Editor):
    try:
        with open(UTILS_JS_PATH, "r", encoding="utf-8") as f:
            utils_js = f.read()
        with open(ACTIONS_JS_PATH, "r", encoding="utf-8") as f:
            actions_js = f.read()

        combined_js = f"""
            {utils_js}
            {actions_js}
            window.PowerSuite.formatCurrentLine();
        """
        editor.web.eval(combined_js)
    except Exception as e:
        print(f"Error reading JS files: {e}")

def on_setup_shortcuts(shortcuts: list[tuple], editor: Editor):
    config = load_config()

    if config.get("enable_line_formatter", True):
        hotkeys = config.get("hotkeys", {})
        hotkey = hotkeys.get("line_formatter", "Alt+Shift+Q")
        shortcuts.append((hotkey, lambda: trigger_formatter(editor)))

# Register hooks
gui_hooks.editor_did_init.append(on_editor_init)
gui_hooks.editor_did_init_shortcuts.append(on_setup_shortcuts)