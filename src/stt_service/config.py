# audio
SAMPLE_RATE = 16000
BLOCK_DURATION_MS = 100 # Длительность блока аудио для обработки (в миллисекундах)
BLOCK_SIZE = int(SAMPLE_RATE * BLOCK_DURATION_MS / 1000) # Размер блока в сэмплах
CHANNELS = 1 # Моно 

# whisper
MODEL_SIZE = "small"  # "tiny", "base", "small", "medium", "large-v1", "large-v2", "large-v3"
LANGUAGE = "ru"         
DEVICE = "auto" # cpu, cuda, auto       
COMPUTE_TYPE = "auto" # int8, float32, auto
CPU_THREADS = 6
NUM_WORKERS = 6

# silero VAD
SILERO_VAD_MODEL = 'silero_vad' # Модель для обработки тишины и шума в потоке
SILERO_VAD_REPO = 'snakers4/silero-vad'
VAD_PROCESS_INTERVAL_SEC = 0.01 # Интервал, через который проверяем буфер с помощью VAD
VAD_PARAMETERS = dict(min_silence_duration_ms=1000, threshold=0.8)
# threshold: Порог вероятности речи (чем выше, тем строже VAD)
# min_silence_duration_ms: Минимальная длительность тишины для разделения сегментов 

# silero TTS
NUM_WARMUP_RUNS = 3
TTS_NUM_SPEAKERS = 3
TTS_SILERO_MODEL = 'silero_tts' 
TTS_SILERO_REPO = 'snakers4/silero-models'
TTS_SPEAKER = "random" # см. документацию по silero  
TTS_SAMPLE_RATE = 8000
TTS_MODEL_VERSION = "v4_ru"   
TTS_WARMUP_TEXT = "Это текст для прогрева моделей? Невероятно! Это действительно текст для прогрева моделей."