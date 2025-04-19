import config as cfg
import numpy as np
import torch

def tts_init():
    try:
        print(f"Загрузка Silero TTS '{cfg.TTS_MODEL_VERSION}'...")
        silero_tts_model, _ = torch.hub.load(
            repo_or_dir='snakers4/silero-models',
            model='silero_tts',
            language=cfg.LANGUAGE,
            speaker=cfg.TTS_MODEL_VERSION 
        )
        print(f"Silero TTS '{cfg.TTS_MODEL_VERSION}' загружена.")

    except Exception as e:
        raise
    return silero_tts_model

def generate_audio_data(tts_model):

    print(f"Генерация аудио для прогрева моделей...")

    audio_data_list = []

    for i in range(cfg.TTS_NUM_SPEAKERS):
        try:
            audio_segment = tts_model.apply_tts(
                text=cfg.TTS_WARMUP_TEXT,
                speaker=cfg.TTS_SPEAKER, 
                sample_rate=cfg.TTS_SAMPLE_RATE
            ).numpy() # Конвертируем тензор в numpy array
            audio_data_list.append(audio_segment)

        except Exception as e:
            print(f"Ошибка при синтезе аудио: {e}")
            # Можно проигнорировать этого спикера и продолжить

    if audio_data_list:
        audio_data = np.concatenate(audio_data_list)
    else:
        # Если ни одного спикера не удалось использовать, прогреваем тишиной
        print("Не удалось сгенерировать аудио ни одним спикером. Используется тишина для прогрева.")
        audio_data = np.zeros(int(cfg.TTS_SAMPLE_RATE * 1.0), dtype=np.float32) # 1 секунда тишины

    print("Аудио для прогрева сгенерировано.")
    return audio_data

def warmup_models(whisper_model, vad_model, timestamps_func):
    try:
        print("Прогрев моделей Whisper и Silero VAD...") 
        tts_model = tts_init()
        warmup_audio_data = generate_audio_data(tts_model)

        for i in range(cfg.NUM_WARMUP_RUNS):
            _ = whisper_model.transcribe(warmup_audio_data, language=cfg.LANGUAGE)
            _ = timestamps_func(warmup_audio_data, vad_model, sampling_rate=cfg.SAMPLE_RATE, **cfg.VAD_PARAMETERS)
            print(f"Прогрев: запуск {i+1}/{cfg.NUM_WARMUP_RUNS} завершен.")

        print("Прогрев моделей завершен.")

    except Exception as e:
        raise
