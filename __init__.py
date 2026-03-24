import os
import json
import re
from aqt import mw, gui_hooks, sound
from aqt.editor import Editor
from aqt.utils import tooltip

from .backend.llm_pipeline import translate_via_gemini
from .backend.tts_pipeline import generate_audio

ADDON_PATH = os.path.dirname(__file__)
CONFIG_PATH = os.path.join(ADDON_PATH, "config.json")
UTILS_JS_PATH = os.path.join(ADDON_PATH, "frontend", "shared_utils.js")
ACTIONS_JS_PATH = os.path.join(ADDON_PATH, "frontend", "hotkey_actions.js")
PASSIVE_JS_PATH = os.path.join(ADDON_PATH, "frontend", "passive_listeners.js")

def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def inject_js(editor: Editor, include_passive=False):
    config = load_config()
    try:
        with open(UTILS_JS_PATH, "r", encoding="utf-8") as f: utils_js = f.read()
        with open(ACTIONS_JS_PATH, "r", encoding="utf-8") as f: actions_js = f.read()
        passive_js = ""
        if include_passive and config.get("enable_smart_trim", False):
            with open(PASSIVE_JS_PATH, "r", encoding="utf-8") as f: passive_js = f.read()
            
        editor.web.eval(f"{utils_js}\n{passive_js}\n{actions_js}")
    except Exception as e:
        print(f"Error loading JS: {e}")

def on_editor_init(editor: Editor):
    inject_js(editor, include_passive=True)

def trigger_formatter(editor: Editor):
    inject_js(editor)
    editor.web.eval("window.PowerSuite.formatCurrentLine();")

# --- CORE TTS WORKER (Used by both Standalone and Combo) ---
def run_tts_process(editor: Editor, text: str, config: dict):
    tts_settings = config.get("tts_settings", {})
    
    def do_tts():
        return generate_audio(text, tts_settings)
        
    def on_tts_finished(future):
        filename = future.result()
        if filename.startswith("Error"):
            tooltip(filename)
            editor.web.eval("window.PowerSuite.isProcessing = false;")
        else:
            # 1. Play the audio
            file_path = os.path.join(mw.col.media.dir(), filename)
            sound.av_player.play_file(file_path)
            
            # 2. Inject the audio tag into Anki
            safe_filename = json.dumps(filename)
            target_idx = tts_settings.get("target_field_index", 2)
            editor.web.eval(f"window.PowerSuite.ttsInjectAudio({safe_filename}, {target_idx});")
            
    mw.taskman.run_in_background(do_tts, on_tts_finished)


# --- STANDALONE TTS HOTKEY ---
def trigger_tts_standalone(editor: Editor):
    inject_js(editor)
    config = load_config()
    
    def handle_text(selected_text):
        if not selected_text: return
        tooltip("Fetching ElevenLabs Audio...")
        run_tts_process(editor, selected_text, config)

    editor.web.evalWithCallback("window.PowerSuite.ttsGetText()", handle_text)


# --- AI TRANSLATOR & COMBO HOTKEY ---
def trigger_ai_pipeline(editor: Editor, is_combo=False):
    inject_js(editor)
    config = load_config()

    def handle_extracted_text(selected_text):
        if not selected_text: return
            
        tooltip("Gemini is thinking...")
        ai_prompt_text = re.sub(r'\(.*?\)', '', selected_text)
        ai_prompt_text = re.sub(r'\s{2,}', ' ', ai_prompt_text).strip()

        def do_work():
            return translate_via_gemini(ai_prompt_text, config.get("ai_settings", {}))

        def on_finished(future):
            translation = future.result()
            if translation.startswith("Error"):
                tooltip(translation)
                editor.web.eval("window.PowerSuite.isProcessing = false;")
                return
            
            cloze_translation = re.sub(r'["“”«»]', '', translation)
            cloze_translation = re.sub(r"(?<!\w)['‘’]|['‘’](?!\w)", "", cloze_translation)
            cloze_translation = re.sub(r'(^|[.!?])\s*[\-—–]+\s*', r'\1 ', cloze_translation).replace('\n', ' ').strip()

            safe_translation = json.dumps(cloze_translation)
            editor.web.eval(f"window.PowerSuite.aiInjectCloze({safe_translation});")
            
            if is_combo:
                tooltip("Cloze generated! Fetching Audio...")
                # Start TTS using the same extracted text!
                run_tts_process(editor, ai_prompt_text, config)
            else:
                tooltip("Cloze generated!")

        mw.taskman.run_in_background(do_work, on_finished)

    editor.web.evalWithCallback("window.PowerSuite.aiGetText()", handle_extracted_text)


def on_setup_shortcuts(shortcuts: list[tuple], editor: Editor):
    config = load_config()
    hotkeys = config.get("hotkeys", {})

    if config.get("enable_line_formatter", True):
        shortcuts.append((hotkeys.get("line_formatter", "Alt+Shift+Q"), lambda: trigger_formatter(editor)))
        
    if config.get("enable_tts", True):
        shortcuts.append((hotkeys.get("tts_standalone", "F9"), lambda: trigger_tts_standalone(editor)))
        
    if config.get("enable_ai_translator", True):
        shortcuts.append((hotkeys.get("ai_translator", "F8"), lambda: trigger_ai_pipeline(editor, is_combo=False)))
        shortcuts.append((hotkeys.get("ai_combo", "Ctrl+F10"), lambda: trigger_ai_pipeline(editor, is_combo=True)))

gui_hooks.editor_did_init.append(on_editor_init)
gui_hooks.editor_did_init_shortcuts.append(on_setup_shortcuts)