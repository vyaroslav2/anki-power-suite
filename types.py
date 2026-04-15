from typing import TypedDict, List

class VoicePoolItem(TypedDict):
    name: str
    voice_id: str
    slug: str

class TTSSettings(TypedDict):
    elevenlabs_api_key: str
    voice_id: str
    model_id: str
    target_field_index: int
    voice_pool: List[VoicePoolItem]

class AISettings(TypedDict):
    gemini_api_key: str
    model_name: str
    model_fallback: List[str]
    prompt_prefix: str

class Config(TypedDict, total=False):
    enable_line_formatter: bool
    enable_smart_trim: bool
    enable_ai_translator: bool
    enable_tts: bool
    hotkeys: dict
    ai_settings: AISettings
    tts_settings: TTSSettings
