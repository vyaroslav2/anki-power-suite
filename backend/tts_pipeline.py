import os
import json
import urllib.request
import urllib.error
import ssl
import random
import hashlib
import re
import time
from aqt import mw

def get_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

from ..types import TTSSettings

def generate_audio(text: str, tts_config: TTSSettings, voice_override: dict = None, abort_check=None, on_retry=None) -> str:
    """Takes pure text, fetches audio from ElevenLabs (or uses cached file), saves it, returns filename."""
    api_key = tts_config.get("elevenlabs_api_key")
    
    # Use override if provided (for batch generation), otherwise fallback to global defaults
    active_voice_id = tts_config.get("voice_id", "ZF6FPAbjXT4488VcRRnw")
    active_slug = "Amelia"
    
    if voice_override:
        active_voice_id = voice_override.get("voice_id", active_voice_id)
        active_slug = voice_override.get("slug", active_slug)
        
    model_id = tts_config.get("model_id", "eleven_multilingual_v2")
    
    if not api_key or api_key == "YOUR_ELEVENLABS_KEY":
        return "Error: No ElevenLabs API Key in config"

    # --- 1. Deterministic Filename Generation ---
    # First 8 chars of SHA-256 over exact string
    hash_val = hashlib.sha256(text.encode('utf-8')).hexdigest()[:8].lower()
    
    # Sentence slug: lowercase, remove punctuation, replace spaces with _, truncate
    text_lower = text.lower()
    text_no_punct = re.sub(r'[^\w\s]', '', text_lower)
    sentence_slug = "_".join(text_no_punct.split())[:150].strip('_')
    if not sentence_slug:
        sentence_slug = "audio"
        
    filename = f"{hash_val}_{active_slug}_{sentence_slug}.mp3"
    file_path = os.path.join(mw.col.media.dir(), filename)
    
    # --- 2. File Caching (Idempotency) ---
    if os.path.exists(file_path):
        return filename

    # --- 3. Generate via API ---
    api_base = tts_config.get("api_base", "https://api.elevenlabs.io")
    url = f"{api_base}/v1/text-to-speech/{active_voice_id}?output_format=mp3_44100_128"
    
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key
    }
    
    payload = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.5}
    }

    data = json.dumps(payload).encode('utf-8')
    ssl_context = get_ssl_context()
    
    retryable_codes = {429, 500, 503, 504}
    max_retries = 3
    
    for attempt in range(max_retries + 1):
        if abort_check and abort_check():
            return "Error: Process aborted by user."
            
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, context=ssl_context, timeout=60) as response:
                with open(file_path, 'wb') as f:
                    f.write(response.read())
                return filename

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8')
            
            if e.code in retryable_codes and attempt < max_retries:
                if e.code == 500 and attempt > 0:
                    return f"Error {e.code}: {err_body}"
                    
                wait_time = 2 ** (attempt + 1)
                retry_after = e.headers.get('Retry-After')
                if retry_after and retry_after.isdigit():
                    wait_time = min(int(retry_after), 30)
                
                if on_retry:
                    on_retry(attempt + 1, max_retries, e.code, "")
                
                sleep_intervals = 10
                for _ in range(sleep_intervals):
                    if abort_check and abort_check():
                        return "Error: Process aborted by user."
                    time.sleep(wait_time / sleep_intervals)
                continue
                
            return f"Error {e.code}: {err_body}"
        except Exception as e:
            return f"Error: {str(e)}"
    
    return "Error: Maximum retries exhausted."