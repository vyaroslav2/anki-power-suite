import os
import json
import re
from aqt import mw, gui_hooks
from aqt.editor import Editor
from aqt.utils import tooltip

from .backend.llm_pipeline import translate_via_gemini

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

def on_editor_init(editor: Editor):
    config = load_config()
    try:
        with open(UTILS_JS_PATH, "r", encoding="utf-8") as f:
            utils_js = f.read()
            
        passive_js = ""
        if config.get("enable_smart_trim", False):
            with open(PASSIVE_JS_PATH, "r", encoding="utf-8") as f:
                passive_js = f.read()

        combined_js = f"{utils_js}\n{passive_js}"
        editor.web.eval(combined_js)
    except Exception as e:
        print(f"Error loading background JS: {e}")

def trigger_formatter(editor: Editor):
    try:
        with open(UTILS_JS_PATH, "r", encoding="utf-8") as f: utils_js = f.read()
        with open(ACTIONS_JS_PATH, "r", encoding="utf-8") as f: actions_js = f.read()
        editor.web.eval(f"{utils_js}\n{actions_js}\nwindow.PowerSuite.formatCurrentLine();")
    except Exception as e:
        print(f"Error reading JS files: {e}")

def trigger_ai_pipeline(editor: Editor, is_combo=False):
    config = load_config()
    ai_settings = config.get("ai_settings", {})

    # Ensure the latest logic is injected
    try:
        with open(UTILS_JS_PATH, "r", encoding="utf-8") as f: utils_js = f.read()
        with open(ACTIONS_JS_PATH, "r", encoding="utf-8") as f: actions_js = f.read()
        editor.web.eval(f"{utils_js}\n{actions_js}")
    except Exception as e:
        print(f"Error loading AI JS: {e}")
        return

    def handle_extracted_text(selected_text):
        if not selected_text:
            return # JS already handled unlocking Traffic Cop
            
        tooltip("Gemini is thinking...")

        # 1. Clean Text for AI
        ai_prompt_text = re.sub(r'\(.*?\)', '', selected_text)
        ai_prompt_text = re.sub(r'\s{2,}', ' ', ai_prompt_text).strip()

        # 2. Worker Function
        def do_work():
            return translate_via_gemini(ai_prompt_text, ai_settings)

        # 3. Callback Function
        def on_finished(future):
            try:
                translation = future.result()

                if translation.startswith("Error"):
                    tooltip(translation)
                    # Manually unlock the traffic cop if AI fails
                    editor.web.eval("window.PowerSuite.isProcessing = false;")
                    return
                
                # Clean up Russian translation
                cloze_translation = re.sub(r'["“”«»]', '', translation)
                cloze_translation = re.sub(r"(?<!\w)['‘’]|['‘’](?!\w)", "", cloze_translation)
                cloze_translation = re.sub(r'(^|[.!?])\s*[\-—–]+\s*', r'\1 ', cloze_translation)
                cloze_translation = cloze_translation.replace('\n', ' ')
                cloze_translation = re.sub(r'\s{2,}', ' ', cloze_translation).strip()

                # SAFELY pass the translation to JS using json.dumps
                safe_translation = json.dumps(cloze_translation)
                editor.web.eval(f"window.PowerSuite.aiInjectCloze({safe_translation});")
                
                # FUTURE TTS COMBO LOGIC HERE
                if is_combo:
                    tooltip("Cloze generated! (TTS Pipeline coming soon)")
                else:
                    tooltip("Cloze generated!")

            except Exception as e:
                print(f"Callback Error: {e}")
                editor.web.eval("window.PowerSuite.isProcessing = false;")

        # Run in Anki's background thread
        mw.taskman.run_in_background(do_work, on_finished)

    # Trigger JS to get text and evaluate the callback
    editor.web.evalWithCallback("window.PowerSuite.aiGetText()", handle_extracted_text)

def on_setup_shortcuts(shortcuts: list[tuple], editor: Editor):
    config = load_config()
    hotkeys = config.get("hotkeys", {})

    if config.get("enable_line_formatter", True):
        shortcuts.append((hotkeys.get("line_formatter", "Alt+Shift+Q"), lambda: trigger_formatter(editor)))
        
    if config.get("enable_ai_translator", True):
        shortcuts.append((hotkeys.get("ai_translator", "F8"), lambda: trigger_ai_pipeline(editor, is_combo=False)))
        shortcuts.append((hotkeys.get("ai_combo", "Ctrl+F10"), lambda: trigger_ai_pipeline(editor, is_combo=True)))

# Register hooks
gui_hooks.editor_did_init.append(on_editor_init)
gui_hooks.editor_did_init_shortcuts.append(on_setup_shortcuts)