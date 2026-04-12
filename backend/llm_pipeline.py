import json
import urllib.request
import urllib.error
import ssl

def get_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

def list_available_models(api_key, api_base="https://generativelanguage.googleapis.com"):
    """Debug function to find out what models this API key can see."""
    url = f"{api_base}/v1beta/models?key={api_key}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, context=get_ssl_context()) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            models = [m['name'] for m in res_data.get('models',[])]
            return "\n".join(models)
    except Exception as e:
        return f"Error listing models: {str(e)}"

def translate_via_gemini(text: str, ai_config: dict) -> str:
    """Pure function: takes text and config, returns text safely."""
    api_key = ai_config.get("gemini_api_key")
    model = ai_config.get("model_name", "gemini-2.5-flash")
    prompt_prefix = ai_config.get("prompt_prefix", "Translate to Russian:")
    
    if not api_key or api_key == "YOUR_API_KEY_HERE": 
        return "Error: No API Key in config.json"

    api_base = ai_config.get("api_base", "https://generativelanguage.googleapis.com")
    url = f"{api_base}/v1beta/models/{model}:generateContent?key={api_key}"
    
    # FIX: Separate the prompt rules (System) from the text (User) 
    payload = {
        "systemInstruction": {
            "parts": [{"text": prompt_prefix}]
        },
        "contents": [
            {"parts":[{"text": f"Translate this text strictly following the system rules:\n\n{text}"}]}
        ]
    }

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        
        with urllib.request.urlopen(req, context=get_ssl_context(), timeout=30) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
            # FIX: Safely parse the JSON to prevent KeyError: 'parts'
            candidates = res_data.get('candidates',[])
            if not candidates:
                return f"Error: No AI candidates returned. Data: {res_data}"
                
            candidate = candidates[0]
            
            # Handle Gemini Safety Filters gracefully
            if candidate.get('finishReason') == 'SAFETY':
                return "Error: Blocked by Gemini Safety Filters."
                
            content = candidate.get('content', {})
            parts = content.get('parts',[])
            
            if not parts:
                reason = candidate.get('finishReason', 'Unknown')
                return f"Error: Missing text parts. Finish Reason: {reason}"
                
            return parts[0]['text'].strip()
                
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        if e.code == 404:
            api_base = ai_config.get("api_base", "https://generativelanguage.googleapis.com")
            available = list_available_models(api_key, api_base)
            return f"Error 404: Model '{model}' not found.\n\nAvailable models:\n{available}"
        return f"HTTP Error {e.code}: {err_body}"
    except Exception as e:
        # If any other error occurs, it will log clearly
        return f"General Error: {str(e)}"