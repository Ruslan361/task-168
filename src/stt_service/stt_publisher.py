import whisper as wr
import config as cfg
import threading
import logging 
import queue 
import sys 

class STTPublisher:
    def __init__(self, max_batch_size=5):

        if cfg.WRITE_TO_FILE:
            logging.basicConfig(level=cfg.LOGGING_LEVEL, 
                            format='%(asctime)s - %(levelname)s - %(message)s',
                            filename=cfg.LOG_FILE_PATH,
                            filemode=cfg.LOG_FILE_MODE)
        else:
            logging.basicConfig(level=cfg.LOGGING_LEVEL, format='%(asctime)s - %(levelname)s - %(message)s')

        self._utterances_history_lock = threading.Lock()
        self.all_utterances = []
        self.subscribers = []
        self.max_batch_size = max_batch_size # размер отправляемого пакета
        self._new_utterances_buffer = [] # <-- Буфер для накопления реплик для следующего пакета

        self._publish_queue = queue.Queue() # Очередь для данных, ожидающих отправки подписчикам
        self._subscribers_lock = threading.Lock() # Блокировка для потокобезопасного доступа к списку подписчиков
        self._dispatcher_thread = None # Поток, который будет вызывать колбеки
        self._dispatcher_stop_event = threading.Event() # Событие для сигнализации остановки потока-диспетчера
        self._is_running = False # Флаг состояния издателя

        self._stt_thread = None # Поток, в котором будет выполняться transcribe_audio

        logging.debug("STTPublisher: инициализация...") 
        success = wr.init_transcribe()
        if not success:
            logging.error("STTPublisher: ошибка инициализации.")
            sys.exit(1)
        logging.debug("STTPublisher: инициализация завершена.") 

    def start(self):
        logging.debug("STTPublisher: инициализация потоков транскрибации и публикации...")
        if not self._is_running:
            self._is_running = True
            wr.is_running = True

            self._stt_thread = threading.Thread(target=wr.transcribe_audio, args=(self,), name="STTProcessor")
            self._stt_thread.daemon = True 
            self._stt_thread.start()
            logging.debug("STTPublisher: поток транскрибации запущен.")

            self._dispatcher_stop_event.clear()
            self._dispatcher_thread = threading.Thread(target=self._dispatcher_loop, name="STTDispatcher")
            self._dispatcher_thread.daemon = True
            self._dispatcher_thread.start()
            logging.debug("STTPublisher: поток публикации запущен.")

    def stop(self):
        if self._is_running:
            logging.debug("STTPublisher: остановка...")
            self._is_running = False
            wr.is_running = False 

            if self._stt_thread and self._stt_thread.is_alive():
                self._stt_thread.join(timeout=10)
                if self._stt_thread.is_alive():
                    logging.warning("STTPublisher: поток транскрибации не завершился вовремя.")

            if self._new_utterances_buffer: 
                try:
                    self._publish_queue.put_nowait(list(self._new_utterances_buffer))
                    self._new_utterances_buffer = [] 
                except queue.Full: 
                    logging.warning("STTPublisher: очередь публикации заполнена, оставшиеся реплики могут быть потеряны.")
                except Exception as e: 
                    logging.error(f"STTPublisher: ошибка при публикации: {e}")

            self._dispatcher_stop_event.set() 
            if self._dispatcher_thread and self._dispatcher_thread.is_alive():
                self._dispatcher_thread.join(timeout=5) # Ждем завершения потока диспетчера
                if self._dispatcher_thread.is_alive():
                    logging.warning("STTPublisher: поток диспетчера не завершился вовремя.")
            
            logging.debug("STTPublisher: остановлен.")

    def _dispatcher_loop(self):

        while True: 
            try:
                item = self._publish_queue.get(timeout=0.1) 
                if item is None: 
                    break
                
                if isinstance(item, list):
                    subscribers_copy = []
                    with self._subscribers_lock:
                        subscribers_copy = list(self.subscribers)

                    utterance_batch = item 
                    for callback in subscribers_copy:
                        try:
                            callback(utterance_batch) 
                        except Exception as e:
                            callback_name = callback.__name__ if hasattr(callback, '__name__') else 'callback'
                            logging.error(f"STTPublisher: ошибка при вызове колбека подписчика '{callback_name}': {e}.")
                            pass

                elif isinstance(item, tuple) and len(item) == 2: 
                    target_callback, history_data = item 
                    if callable(target_callback):
                        try:
                            target_callback(history_data) 
                            logging.debug(f"История отправлена подписчику '{target_callback.__name__ if hasattr(target_callback, '__name__') else 'callback'}'.")
                        except Exception as e:
                            callback_name = target_callback.__name__ if hasattr(target_callback, '__name__') else 'callback'
                            logging.error(f"Ошибка при отправке истории подписчику '{callback_name}': {e}.")

            except queue.Empty:
                pass 
            except Exception as e:
                logging.error(f"STTPublisher: неожиданная ошибка в цикле диспетчера: {e}.")
            
        logging.debug("STTPublisher: поток публикации остановлен.")

    def subscribe(self, callback):
        with self._subscribers_lock:
            if callable(callback) and callback not in self.subscribers:
                self.subscribers.append(callback)
                logging.info(f"STTPublisher: подписчик '{callback.__name__ if hasattr(callback, '__name__') else 'callback'}' подписан.")
                # Опционально: отправить текущую историю при подписке (потокобезопасно)
                # self._publish_queue.put(self.all_utterances[-self.max_batch_size:]) # Отправка через очередь
            else:
                logging.error(f"STTPublisher: ошибка подписки: '{callback}'. Ожидается вызываемый объект (функция).")

    def unsubscribe(self, callback):
        with self._subscribers_lock:
            if callback in self.subscribers:
                self.subscribers.remove(callback)
                logging.info(f"STTPublisher: подписчик '{callback.__name__ if hasattr(callback, '__name__') else 'callback'}' отписан.")
            else:
                logging.error(f"STTPublisher: ошибка отписки: Подписчик '{callback.__name__ if hasattr(callback, '__name__') else 'callback'}' не найден.")

    def publish(self, new_utterance):

        if not self._is_running:
            return 

        if not new_utterance or not new_utterance.strip():
            return

        processed_utterance = new_utterance.strip()
        self.all_utterances.append(processed_utterance) 

        self._new_utterances_buffer.append(processed_utterance)

        if len(self._new_utterances_buffer) >= self.max_batch_size: 

            batch_to_send = list(self._new_utterances_buffer) 
            self._new_utterances_buffer = [] 

            try: 
                self._publish_queue.put_nowait(batch_to_send) 
            except queue.Full:
                logging.warning("STTPublisher: очередь публикации заполнена. Пакет пропущен.") 
            except Exception as e: 
                logging.error(f"STTPublisher: ошибка при постановке пакета в очередь: {e}.")


    def send_full_history(self, callback):
        if not callable(callback):
            logging.error(f"STTPublisher: невозможно отправить историю, ожидался колбек.")
            return

        logging.debug(f"STTPublisher: запрос на отправку полной истории подписчику '{callback.__name__ if hasattr(callback, '__name__') else 'callback'}'.")

        full_history_copy = []
        with self._utterances_history_lock: 
            full_history_copy = list(self.all_utterances)

        try:
            self._publish_queue.put_nowait((callback, full_history_copy))
            logging.debug(f"STTPublisher: запрос истории поставлен в очередь для подписчика '{callback.__name__ if hasattr(callback, '__name__') else 'callback'}'.")
        except queue.Full:
            logging.warning("STTPublisher: очередь публикации полна, запрос истории пропущен.")
        except Exception as e:
            logging.error(f"STTPublisher: ошибка при постановке запроса истории в очередь: {e}.")


    def is_subscribed(self, callback):
        if not callable(callback):
            return False

        with self._subscribers_lock: 
            return callback in self.subscribers 



