import os
import json
import urllib.request
import urllib.error
import ssl
import random
from aqt import mw

def get_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

def generate_audio(text: str, tts_config: dict) -> str:
    """Takes pure text, fetches audio from ElevenLabs, saves it, returns filename."""
    api_key = tts_config.get("elevenlabs_api_key")
    voice_id = tts_config.get("voice_id", "ZF6FPAbjXT4488VcRRnw") # Defaulted to Amelia!
    model_id = tts_config.get("model_id", "eleven_multilingual_v2") # Using the stable v2 model
    
    if not api_key or api_key == "YOUR_ELEVENLABS_KEY":
        return "Error: No ElevenLabs API Key in config"

    # Define the URL exactly ONCE, including the 128kbps MP3 parameter
    api_base = tts_config.get("api_base", "https://api.elevenlabs.io")
    url = f"{api_base}/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
    
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

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        with urllib.request.urlopen(req, context=get_ssl_context(), timeout=15) as response:
            # Generate random hex for filename
            hex_str = "".join(random.choices("0123456789abcdef", k=8))
            filename = f"eleven_{hex_str}.mp3"
            file_path = os.path.join(mw.col.media.dir(), filename)
            
            with open(file_path, 'wb') as f:
                f.write(response.read())
                
            return filename

    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        return f"Error {e.code}: {err_body}"
    except Exception as e:
        return f"Error: {str(e)}"