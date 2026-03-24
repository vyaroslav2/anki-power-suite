import json
import urllib.request
import urllib.error
import ssl

def get_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

def list_available_models(api_key):
    """Debug function to find out what models this API key can see."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, context=get_ssl_context()) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            models = [m['name'] for m in res_data.get('models',[])]
            return "\n".join(models)
    except Exception as e:
        return f"Error listing models: {str(e)}"

def translate_via_gemini(text: str, ai_config: dict) -> str:
    """Pure function: takes text and config, returns text."""
    api_key = ai_config.get("gemini_api_key")
    model = ai_config.get("model_name", "gemini-1.5-flash")
    prompt_prefix = ai_config.get("prompt_prefix", "Translate to Russian:")
    
    if not api_key or api_key == "YOUR_API_KEY_HERE": 
        return "Error: No API Key in config.json"

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": f"{prompt_prefix} {text}"}]}]
    }

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        
        with urllib.request.urlopen(req, context=get_ssl_context(), timeout=30) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            return res_data['candidates'][0]['content']['parts'][0]['text'].strip()
                
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        if e.code == 404:
            available = list_available_models(api_key)
            return f"Error 404: Model '{model}' not found.\n\nAvailable models:\n{available}"
        return f"HTTP Error {e.code}: {err_body}"
    except Exception as e:
        return f"General Error: {str(e)}"