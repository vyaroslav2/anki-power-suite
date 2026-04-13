import os
import json
import re
from aqt import mw, gui_hooks, sound
from aqt.editor import Editor
from .backend.logger import wipe_log_on_init, handle_js_message, log_tooltip as tooltip

from .backend.llm_pipeline import translate_via_gemini
from .backend.tts_pipeline import generate_audio

ADDON_PATH = os.path.dirname(__file__)
CONFIG_PATH = os.path.join(ADDON_PATH, "config.json")
UTILS_JS_PATH = os.path.join(ADDON_PATH, "frontend", "shared_utils.js")
ACTIONS_JS_PATH = os.path.join(ADDON_PATH, "frontend", "hotkey_actions.js")
PASSIVE_JS_PATH = os.path.join(ADDON_PATH, "frontend", "passive_listeners.js")
DEBUG_JS_PATH = os.path.join(ADDON_PATH, "frontend", "debugger_flight_recorder.js")

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
        
        # Load the flight recorder
        with open(DEBUG_JS_PATH, "r", encoding="utf-8") as f: debug_js = f.read()
        
        passive_js = ""
        if include_passive and config.get("enable_smart_trim", False):
            with open(PASSIVE_JS_PATH, "r", encoding="utf-8") as f: passive_js = f.read()
            
        # Add debug_js to the eval string
        editor.web.eval(f"{utils_js}\n{passive_js}\n{actions_js}\n{debug_js}")
    except Exception as e:
        print(f"Error loading JS: {e}")
def on_editor_init(editor: Editor):
    inject_js(editor, include_passive=True)

def trigger_formatter(editor: Editor):
    inject_js(editor)
    editor.web.eval("window.PowerSuite.formatCurrentLine();")


# --- PROCESSING LOCK (JS overlay replaces mw.progress to avoid focus stealing) ---
_abort_flag = False

def _start_progress(editor: Editor, message: str, lock_type: str = "unknown"):
    """Show the JS lock overlay and reset the abort flag."""
    global _abort_flag
    _abort_flag = False
    safe_msg = json.dumps(message)
    safe_type = json.dumps(lock_type)
    editor.web.eval(f"window.PowerSuite.showLock({safe_msg}, {safe_type})")

def _update_progress(editor: Editor, message: str):
    """Update the lock overlay label text."""
    safe_msg = json.dumps(message)
    editor.web.eval(f"window.PowerSuite.updateLock({safe_msg})")

def _finish_progress(editor: Editor):
    """Remove the lock overlay."""
    editor.web.eval("window.PowerSuite.hideLock()")

def _handle_abort_pycmd(handled, message, context):
    """Receive abort signal from JS Esc key handler."""
    global _abort_flag
    if message == "ps__abort":
        _abort_flag = True
        tooltip("Process aborted.")
        return (True, None)
    return handled


# --- CORE TTS WORKER (Used by both Standalone and Combo) ---
def run_tts_process(editor: Editor, text: str, config: dict):
    tts_settings = config.get("tts_settings", {})
    
    def do_tts():
        return generate_audio(text, tts_settings)
        
    def on_tts_finished(future):
        if _abort_flag:
            _finish_progress(editor)
            return
        _finish_progress(editor)
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


# --- BATCH TTS WORKER (Used by Combos) ---
def run_batch_tts_process(editor: Editor, text: str, config: dict, track_for_unwrap: bool = False):
    import random
    tts_settings = config.get("tts_settings", {})
    voice_pool = tts_settings.get("voice_pool", [])
    
    default_voice_id = tts_settings.get("voice_id", "ZF6FPAbjXT4488VcRRnw")
    default_slug = "Amelia"
    for v in voice_pool:
        if v.get("voice_id") == default_voice_id:
            default_slug = v.get("slug", "Amelia")
            break
            
    default_voice = {"voice_id": default_voice_id, "slug": default_slug}
    
    unique_slug_voices = {}
    for v in voice_pool:
        vol_slug = v.get("slug")
        if vol_slug and vol_slug != default_slug:
            unique_slug_voices[vol_slug] = {"voice_id": v.get("voice_id"), "slug": vol_slug}
            
    random_candidates = list(unique_slug_voices.values())
    if len(random_candidates) >= 4:
        chosen_randoms = random.sample(random_candidates, 4)
    else:
        chosen_randoms = random_candidates
        
    random.shuffle(chosen_randoms)
    batch_voices = [default_voice] + chosen_randoms
    
    def do_batch():
        filenames = []
        for v in batch_voices:
            if _abort_flag:
                return filenames, "CANCELLED"
            res = generate_audio(text, tts_settings, voice_override=v)
            if res.startswith("Error"):
                return filenames, res
            filenames.append(res)
        return filenames, None
        
    def on_batch_finished(future):
        filenames, err = future.result()
        if err == "CANCELLED" or _abort_flag:
            _finish_progress(editor)
            return
        _finish_progress(editor)
        if err:
            tooltip(f"TTS Failed: {err}. Generated {len(filenames)}/{len(batch_voices)}.")
            editor.web.eval("window.PowerSuite.isProcessing = false;")
            return
            
        safe_filenames = json.dumps(filenames)
        target_idx = tts_settings.get("target_field_index", 2)
        js_track = 'true' if track_for_unwrap else 'false'
        
        def on_injected(success):
            if success and filenames:
                file_path = os.path.join(mw.col.media.dir(), filenames[0])
                sound.av_player.play_file(file_path)
                
        editor.web.evalWithCallback(
            f"window.PowerSuite.ttsInjectAudio({safe_filenames}, {target_idx}, {js_track});", 
            on_injected
        )
            
    mw.taskman.run_in_background(do_batch, on_batch_finished)

# --- STANDALONE TTS HOTKEY ---
def trigger_tts_standalone(editor: Editor):
    inject_js(editor)
    config = load_config()
    
    tts_settings = config.get("tts_settings", {})
    active_model = tts_settings.get("model_id", "Unknown Model")
    
    def handle_text(selected_text):
        if not selected_text: return
        _start_progress(editor, "Synthesising audio...", "tts")
        run_tts_process(editor, selected_text, config)

    editor.web.evalWithCallback("window.PowerSuite.ttsGetText()", handle_text)

# --- STANDALONE COMBO TTS HOTKEY (Ctrl+F9) ---
def trigger_tts_combo_standalone(editor: Editor):
    inject_js(editor)
    config = load_config()
    
    def handle_text(selected_text):
        if not selected_text: return
        _start_progress(editor, "Synthesising multiple voices...", "tts_batch")
        run_batch_tts_process(editor, selected_text, config, track_for_unwrap=False)

    editor.web.evalWithCallback("window.PowerSuite.ttsGetText()", handle_text)

# --- AI TRANSLATOR & COMBO HOTKEY ---
def trigger_ai_pipeline(editor: Editor, is_combo=False):
    inject_js(editor)
    config = load_config()

    def handle_extracted_text(selected_text):
        if not selected_text: return
            
        _start_progress(editor, "Analysing text and generating cloze...", "combo" if is_combo else "ai")
        ai_prompt_text = re.sub(r'\(.*?\)', '', selected_text)
        ai_prompt_text = re.sub(r'\s{2,}', ' ', ai_prompt_text).strip()

        def do_work():
            return translate_via_gemini(ai_prompt_text, config.get("ai_settings", {}))

        def on_finished(future):
            if _abort_flag:
                _finish_progress(editor)
                return
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
                if not success or _abort_flag:
                    _finish_progress(editor)
                    return
                
                if is_error:
                    _finish_progress(editor)
                    msg = "AI Error pasted in editor. Combo aborted." if is_combo else "AI Error pasted in editor."
                    tooltip(msg)
                    return
                
                if is_combo:
                    _update_progress(editor, "Cloze generated. Synthesising voice bundle...")
                    run_batch_tts_process(editor, ai_prompt_text, config, track_for_unwrap=True)
                else:
                    _finish_progress(editor)
                    tooltip("Cloze generated.")

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
        global _abort_flag
        if result == "ABORTED":
            _abort_flag = True
            _finish_progress(editor)
            tooltip("Process aborted.")
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
        if "tts_combo" in hotkeys:
            shortcuts.append((hotkeys["tts_combo"], lambda: trigger_tts_combo_standalone(editor)))
        
    if config.get("enable_ai_translator", True):
        shortcuts.append((hotkeys.get("ai_translator", "F8"), lambda: trigger_ai_pipeline(editor, is_combo=False)))
        shortcuts.append((hotkeys.get("ai_combo", "Ctrl+F10"), lambda: trigger_ai_pipeline(editor, is_combo=True)))

    if "unwrap_cloze" in hotkeys:
        shortcuts.append((hotkeys["unwrap_cloze"], lambda: trigger_unwrapper(editor)))
        

gui_hooks.editor_did_init.append(on_editor_init)
gui_hooks.editor_did_init_shortcuts.append(on_setup_shortcuts)
gui_hooks.editor_did_init.append(wipe_log_on_init)
gui_hooks.webview_did_receive_js_message.append(handle_js_message)
gui_hooks.webview_did_receive_js_message.append(_handle_abort_pycmd)