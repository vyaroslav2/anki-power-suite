import json
import urllib.request
import urllib.error
import ssl
import time

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

def translate_via_gemini(text: str, ai_config: dict, abort_check=None, on_retry=None) -> str:
    """Pure function: takes text and config, returns text safely, with retries and fallback."""
    api_key = ai_config.get("gemini_api_key")
    if not api_key or api_key == "YOUR_API_KEY_HERE": 
        return "Error: No API Key in config.json"

    primary_model = ai_config.get("model_name", "gemini-2.5-flash")
    fallback_models = ai_config.get("model_fallback", [])
    
    models_to_try = [primary_model] + fallback_models
    api_base = ai_config.get("api_base", "https://generativelanguage.googleapis.com")
    prompt_prefix = ai_config.get("prompt_prefix", "Translate to Russian:")
    
    payload = {
        "systemInstruction": {
            "parts": [{"text": prompt_prefix}]
        },
        "contents": [
            {"parts":[{"text": f"Translate this text strictly following the system rules:\n\n{text}"}]}
        ]
    }
    data = json.dumps(payload).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    ssl_context = get_ssl_context()
    
    last_error = "General Error: All models failed."
    retryable_codes = {429, 500, 503, 504}
    
    for model_idx, current_model in enumerate(models_to_try):
        if abort_check and abort_check():
            return "Error: Process aborted by user."
            
        is_fallback = model_idx > 0
        if is_fallback and on_retry:
            on_retry(0, 0, "fallback", f"Primary model busy. Falling back to {current_model}...")
            
        url = f"{api_base}/v1beta/models/{current_model}:generateContent?key={api_key}"
        
        # Max retries: 3 for primary model, 0 for fallbacks
        max_retries = 0 if is_fallback else 3
        
        for attempt in range(max_retries + 1):
            if abort_check and abort_check():
                return "Error: Process aborted by user."
                
            try:
                req = urllib.request.Request(url, data=data, headers=headers)
                with urllib.request.urlopen(req, context=ssl_context, timeout=30) as response:
                    res_data = json.loads(response.read().decode('utf-8'))
                    
                    candidates = res_data.get('candidates', [])
                    if not candidates:
                        return f"Error: No AI candidates returned. Data: {res_data}"
                        
                    candidate = candidates[0]
                    if candidate.get('finishReason') == 'SAFETY':
                        return "Error: Blocked by Gemini Safety Filters."
                        
                    parts = candidate.get('content', {}).get('parts', [])
                    if not parts:
                        reason = candidate.get('finishReason', 'Unknown')
                        return f"Error: Missing text parts. Finish Reason: {reason}"
                        
                    return parts[0]['text'].strip()
                    
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8')
                last_error = f"HTTP Error {e.code} ({current_model}): {err_body}"
                
                if e.code == 404:
                    if is_fallback:
                        break # Go to next fallback
                    available = list_available_models(api_key, api_base)
                    return f"Error 404: Model '{current_model}' not found.\n\nAvailable models:\n{available}"
                
                if e.code in retryable_codes and attempt < max_retries:
                    # 500 should only be retried once
                    if e.code == 500 and attempt > 0:
                        break
                        
                    wait_time = 2 ** (attempt + 1) # 2s, 4s, 8s
                    
                    # Respect Retry-After header if present
                    retry_after = e.headers.get('Retry-After')
                    if retry_after and retry_after.isdigit():
                        wait_time = min(int(retry_after), 30)
                    
                    if on_retry:
                        on_retry(attempt + 1, max_retries, e.code, "")
                    
                    # Sleep in small chunks to remain responsive to abort
                    sleep_intervals = 10
                    for _ in range(sleep_intervals):
                        if abort_check and abort_check():
                            return "Error: Process aborted by user."
                        time.sleep(wait_time / sleep_intervals)
                    continue # Try again
                else:
                    break # Exhausted retries or non-retryable error, move to next model
            except Exception as e:
                last_error = f"General Error ({current_model}): {str(e)}"
                break # Move to next model
                
    return last_error