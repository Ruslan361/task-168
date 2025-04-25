import sounddevice as sd
import faster_whisper
import config as cfg
import warmup as wp
import numpy as np
import datetime
import logging
import torch
import queue
import time
import sys

audio_queue = queue.Queue()

is_running = True
whisper_model = None
silero_vad_model = None
get_speech_timestamps = None # Указатель на функцию VAD утилиты
processed_audio_index = 0 # Индекс в буфере, до которого аудио уже было обработано VAD

_stt_device = None

def init_transcribe():
    logging.info("Инициализация моделей...")

    device_type = cfg.DEVICE
    comp_type = cfg.COMPUTE_TYPE

    if cfg.DEVICE == "auto":
        if torch.cuda.is_available():
            device_type = "cuda"
            comp_type = "float32"
        else:
            device_type = "cpu"
            comp_type = "int8"

    global whisper_model, silero_vad_model, get_speech_timestamps, _stt_device
    _stt_device = device_type

    try:
        logging.debug("Загрузка модели Silero VAD...")
        silero_vad_model, vad_utils = torch.hub.load(
            repo_or_dir=cfg.SILERO_VAD_REPO,
            model=cfg.SILERO_VAD_MODEL,
            force_reload=False # Не перезагружать при каждом запуске
        )
        # Извлекаем нужную функцию для получения временных меток сегментов
        (get_speech_timestamps, _, _, _, _) = vad_utils
        silero_vad_model = silero_vad_model.to(device_type)
        logging.debug(f"Модель Silero VAD '{cfg.SILERO_VAD_MODEL}' загружена на {device_type}.")

        logging.debug(f"Загрузка модели Whisper '{cfg.MODEL_SIZE}'...")
        whisper_model = faster_whisper.WhisperModel(
            cfg.MODEL_SIZE, 
            device=device_type, 
            compute_type=comp_type, 
            cpu_threads=cfg.CPU_THREADS, 
            num_workers=cfg.NUM_WORKERS)
        logging.debug(f"Модель Whisper '{cfg.MODEL_SIZE}' загружена на {device_type} ({comp_type}).")
        logging.info("Инициализация завершена.") 

        if cfg.WARMUP_ENABLE:  
            wp.warmup_models(whisper_model, silero_vad_model, get_speech_timestamps)

    except Exception as e:
        logging.error(f"Ошибка на этапе загрузки или прогрева моделей: {e}.")
        return False
     
    return True

def audio_callback(indata, frames, time, status):
    if status:
        logging.warning(status, file=sys.stderr)
    audio_queue.put(indata.copy())

def transcribe_audio(publisher):

    global is_running, processed_audio_index, _stt_device
    accumulated_audio = np.array([], dtype=np.float32) # Буфер для накопления аудио

    logging.info(f"\nНачинаю слушать микрофон (частота: {cfg.SAMPLE_RATE} Гц)...")

    try:
        stream = sd.InputStream(
            samplerate=cfg.SAMPLE_RATE,
            blocksize=cfg.BLOCK_SIZE,
            channels=cfg.CHANNELS, 
            dtype='float32',      
            callback=audio_callback 
        )
        stream.start()
    except Exception as e:
        logging.error(f"Ошибка при открытии аудиопотока: {e}\n"+
                      "Убедитесь, что у вас выбран правильный микрофон по умолчанию и он работает.")
        is_running = False
        return False

    last_vad_process_time = time.time()

    while is_running:
        try:
            while not audio_queue.empty():
                new_data = audio_queue.get_nowait()
                accumulated_audio = np.concatenate((accumulated_audio, new_data.flatten()))

            current_time = time.time()
            buffer_duration = len(accumulated_audio) / cfg.SAMPLE_RATE
            unprocessed_duration = (len(accumulated_audio) - processed_audio_index) / cfg.SAMPLE_RATE

            # Проверяем буфер VAD, если прошло достаточно времени ИЛИ накопилось много необработанных данных
            if unprocessed_duration >= cfg.VAD_PROCESS_INTERVAL_SEC or \
                (buffer_duration > 0 and current_time - last_vad_process_time > cfg.VAD_PROCESS_INTERVAL_SEC * 2): # Форсировать VAD, если буфер долго не обрабатывался

                # Выделяем только ту часть буфера, которую еще не обрабатывали VAD
                current_chunk_for_vad = accumulated_audio[processed_audio_index:]
                chunk_duration = len(current_chunk_for_vad) / cfg.SAMPLE_RATE

                if chunk_duration > 0: 
                    audio_tensor_chunk = torch.from_numpy(current_chunk_for_vad).unsqueeze(0)
                    audio_tensor_chunk = audio_tensor_chunk.to(_stt_device)

                    # Используем Silero VAD для поиска сегментов в текущем чанке
                    with torch.no_grad(): 
                        timestamps = get_speech_timestamps(
                            audio_tensor_chunk,
                            silero_vad_model,
                            sampling_rate=cfg.SAMPLE_RATE,
                            **cfg.VAD_PARAMETERS
                        )

                    last_vad_process_time = current_time 

                    # Проходимся по сегментам, найденным VAD в ТЕКУЩЕМ чанке
                    if timestamps:
                        full_text_this_cycle = ""
                        now = datetime.datetime.now()
                        timestamp_str = now.strftime("[%H:%M:%S]")

                        for i, ts in enumerate(timestamps):
                            start_sample_chunk = ts['start']
                            end_sample_chunk = ts['end']

                            start_sample_abs = processed_audio_index + start_sample_chunk
                            end_sample_abs = processed_audio_index + end_sample_chunk

                            segment_audio = accumulated_audio[start_sample_abs:end_sample_abs]

                            if len(segment_audio) > 0:

                                try:
                                    segment_segments_whisper, segment_info = whisper_model.transcribe(
                                        segment_audio,
                                        language=cfg.LANGUAGE,
                                        beam_size=5,
                                        task="transcribe",
                                        vad_filter=False 
                                    )

                                    if segment_segments_whisper is not None:
                                        for s_seg in segment_segments_whisper:
                                             full_text_this_cycle += s_seg.text + " "

                                except Exception as whisper_e:
                                    logging.warning(f"\nОшибка при транскрипции сегмента Whisper: {whisper_e}")


                        full_text_this_cycle = full_text_this_cycle.strip()

                        max_index_in_chunk_relative_to_its_start = 0
                        if timestamps:
                            max_index_in_chunk_relative_to_its_start = timestamps[-1]['end'] 

                        samples_processed_in_chunk = max_index_in_chunk_relative_to_its_start

                        lookahead_samples = int(cfg.SAMPLE_RATE * cfg.VAD_PROCESS_INTERVAL_SEC * 0.5)
                        samples_processed_in_chunk += lookahead_samples

                        processed_audio_index = samples_processed_in_chunk

                        if full_text_this_cycle:
                             publisher.publish(timestamp_str + " " + full_text_this_cycle)

                        if processed_audio_index > 0:
                             accumulated_audio = accumulated_audio[processed_audio_index:]
                             processed_audio_index = 0

            time.sleep(0.01)

        except queue.Empty:
            time.sleep(0.01)
            continue
        except KeyboardInterrupt:
            logging.info("\nОстановка по требованию пользователя (Ctrl+C)...")
            is_running = False
            return False
        except Exception as e:
            logging.error(f"\nПроизошла ошибка в цикле транскрипции: {e}")
            is_running = False
            return False

    if 'stream' in locals() and stream.active:
        stream.stop()
        stream.close()
        logging.info("Аудиопоток остановлен.")

    return True