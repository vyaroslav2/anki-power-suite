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
            return
            
        safe_filename = json.dumps(filename)
        target_idx = tts_settings.get("target_field_index", 2)
        
        # Check if JS accepts the audio. If it aborted, we delete the MP3 silently.
        def on_injected(success):
            if success:
                file_path = os.path.join(mw.col.media.dir(), filename)
                sound.av_player.play_file(file_path)
            else:
                try:
                    os.remove(os.path.join(mw.col.media.dir(), filename))
                except Exception:
                    pass
                    
        editor.web.evalWithCallback(
            f"window.PowerSuite.ttsInjectAudio({safe_filename}, {target_idx});", 
            on_injected
        )
            
    mw.taskman.run_in_background(do_tts, on_tts_finished)


# --- STANDALONE TTS HOTKEY ---
def trigger_tts_standalone(editor: Editor):
    inject_js(editor)
    config = load_config()
    
    tts_settings = config.get("tts_settings", {})
    active_model = tts_settings.get("model_id", "Unknown Model")
    
    def handle_text(selected_text):
        if not selected_text: return
        tooltip(f"Fetching Audio ({active_model})...")
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
            
            # 1. Identify if the result is an error message (catches 'Error:', 'HTTP Error', etc.)
            is_error = translation.startswith("Error") or translation.startswith("HTTP Error") or translation.startswith("General Error")
            
            # 2. Sanitize braces to prevent Anki's cloze regex from breaking (prevents dangling '}' on unwrap)
            translation = translation.replace('{', '[').replace('}', ']')
            
            cloze_translation = re.sub(r'["“”«»]', '', translation)
            cloze_translation = re.sub(r"(?<!\w)['‘’]|['‘’](?!\w)", "", cloze_translation)
            cloze_translation = re.sub(r'(^|[.!?])\s*[\-—–]+\s*', r'\1 ', cloze_translation).replace('\n', ' ').strip()

            safe_translation = json.dumps(cloze_translation)
            
            # 3. If it's an error, force JS to treat isCombo as false so it instantly unlocks the Editor UI
            combo_for_js = 'true' if (is_combo and not is_error) else 'false'
            
            # 4. Check if user aborted during the AI wait time.
            def on_injected(success):
                if not success:
                    return # Task was aborted manually! Do not trigger TTS or show ghostly tooltips.
                
                if is_error:
                    msg = "AI Error pasted in editor. Combo aborted." if is_combo else "AI Error pasted in editor."
                    tooltip(msg)
                    return # Abort here to completely block TTS from firing
                
                if is_combo:
                    tts_settings = config.get("tts_settings", {})
                    active_model = tts_settings.get("model_id", "Unknown Model")
                    tooltip(f"Cloze generated! Fetching Audio ({active_model})...")
                    run_tts_process(editor, ai_prompt_text, config)
                else:
                    tooltip("Cloze generated!")

            editor.web.evalWithCallback(
                f"window.PowerSuite.aiInjectCloze({safe_translation}, {combo_for_js});", 
                on_injected
            )

        mw.taskman.run_in_background(do_work, on_finished)

    editor.web.evalWithCallback("window.PowerSuite.aiGetText()", handle_extracted_text)

# --- UNWRAPPER UTILITY (ALSO ACTS AS ABORT) ---
def trigger_unwrapper(editor: Editor):
    inject_js(editor)
    def on_unwrapped(result):
        if result == "ABORTED":
            tooltip("Generation Aborted.")
        elif result.startswith("UNWRAPPED"):
            tooltip("Cloze unwrapped.")
            
    editor.web.evalWithCallback("window.PowerSuite.unwrapCloze();", on_unwrapped)


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

    if "unwrap_cloze" in hotkeys:
        shortcuts.append((hotkeys["unwrap_cloze"], lambda: trigger_unwrapper(editor)))
        

gui_hooks.editor_did_init.append(on_editor_init)
gui_hooks.editor_did_init_shortcuts.append(on_setup_shortcuts)