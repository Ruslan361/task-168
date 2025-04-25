// public/client.js
const clientIdElement = document.getElementById('clientId');
const chatbox = document.getElementById('chatbox');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
// Элементы UI для WebRTC кнопок
const clientCallIcon = document.querySelector('.call-controls .icon-button.call-icon');
const clientHangupIcon = document.querySelector('.call-controls .icon-button.hangup-icon');
const callControlsSpan = document.querySelector('.call-controls');
// Элементы UI для входящего звонка
const incomingCallNotification = document.getElementById('incomingCallNotification');
const acceptCallButton = document.getElementById('acceptCallButton');
const declineCallButton = document.getElementById('declineCallButton');


// --- Настройка WebSocket ---
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/client`;
let websocket;
let myClientId = null;

// --- Переменные для WebRTC ---
let localStream = null; // Поток с локального микрофона
let peerConnection = null; // Объект WebRTC соединения
let remoteAudioElement = null; // Элемент для воспроизведения удаленного аудио
let incomingOfferSdp = null; // Для временного хранения SDP Offer при входящем звонке

// --- Состояние звонка ---
// 'idle', 'requesting', 'incoming', 'connecting', 'connected', 'hangingup'
let callState = 'idle';
function connectWebSocket() {
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
        console.log('WS Client: Соединение установлено.');
        addMessageToChat('Система', 'Вы подключены к чату поддержки.', 'system-message');
        updateCallUI('idle'); // Убедимся, что UI звонка в начальном состоянии
    };
    websocket.onmessage = (event) => {
        console.log('WS Client: Сообщение от сервера: ', event.data);
        try {
            const message = JSON.parse(event.data);

            switch (message.type) {
                case 'your_id':
                    myClientId = message.clientId;
                    clientIdElement.textContent = myClientId;
                    // Показываем контейнер кнопок звонка после получения ID клиента
                    if(callControlsSpan) {
                         callControlsSpan.style.display = 'inline-flex';
                    }
                    // Обновляем UI звонка в зависимости от текущего состояния
                    updateCallUI(callState);
                    break;
                case 'operator_message':
                    addMessageToChat('Оператор', message.text, 'operator-reply');
                    break;
                 case 'system_error':
                     addMessageToChat('Система', `Ошибка сервера: ${message.text}`, 'system-message');
                     break;
                case 'operator_disconnected': // Оператор отключился
                     console.log('WS Client: Оператор отключился.');
                     addMessageToChat('Система', 'Оператор отключился.', 'system-message');
                     // При отключении оператора завершаем звонок и сбрасываем состояние
                      stopCall();
                      updateCallUI('idle'); // Возвращаемся в idle
                     // TODO: Возможно, скрыть кнопки звонка/завершения, если оператора нет
                     // if(callControlsSpan) callControlsSpan.style.display = 'none';
                     break;
                case 'operator_error': // Ошибка оператора
                     console.error('WS Client: Ошибка соединения с оператором.');
                     addMessageToChat('Система', 'Ошибка соединения с оператором.', 'system-message');
                     // При ошибке оператора завершаем звонок
                      stopCall();
                      updateCallUI('idle'); // Возвращаемся в idle
                     // TODO: Возможно, скрыть кнопки звонка/завершения
                     // if(callControlsSpan) callControlsSpan.style.display = 'none';
                     break;

                // --- Обработка входящих WebRTC сигнальных сообщений от сервера ---
                case 'webrtc_offer': // Получен Offer от оператора (ВХОДЯЩИЙ ЗВОНОК)
                    console.log('WS Client: Получен Offer от оператора.');
                    if (message.sdp) {
                         // Обрабатываем входящий Offer, запросив подтверждение у пользователя
                        handleIncomingOffer(message.sdp);
                    } else {
                        console.warn('WS Client: Получен неполный Offer.');
                        addMessageToChat('Система', 'Ошибка при получении предложения звонка: неполные данные.', 'system-message');
                         // TODO: Отправить ошибку серверу/оператору?
                    }
                    break;
                case 'webrtc_answer': // Получен Answer от оператора (ОТВЕТ НА НАШ OFFER)
                    console.log('WS Client: Получен Answer от оператора.');
                    if (message.sdp) {
                        // Если клиент инициировал звонок, мы ожидаем Answer
                        if (callState === 'requesting' || callState === 'connecting') {
                            handleAnswer(message.sdp); // Обрабатываем Answer
                        } else {
                            console.warn('WS Client: Получен Answer в неожиданном состоянии:', callState);
                            // TODO: Отправить ошибку серверу/оператору?
                        }
                    } else {
                         console.warn('WS Client: Получен неполный Answer.');
                    }
                    break;
                case 'webrtc_candidate': // Получен ICE кандидат от оператора
                    console.log('WS Client: Получен ICE кандидат от оператора.');
                    if (message.candidate) {
                        handleAddCandidate(message.candidate);
                    } else {
                         console.warn('WS Client: Получен пустой ICE кандидат.');
                    }
                    break;
                case 'operator_hangup': // Оператор завершил звонок
                     console.log('WS Client: Получен сигнал завершения звонка от оператора.');
                     handleRemoteHangup(); // Обработать завершение удаленной стороной
                     break;
                 case 'webrtc_busy': // Оператор занят (если реализовано на стороне оператора) - НОВЫЙ ТИП СИГНАЛА С СЕРВЕРА К КЛИЕНТУ
                     console.log('WS Client: Получен сигнал "Оператор занят".');
                     addMessageToChat('Система', 'Оператор занят или не готов принять звонок. Попробуйте позже.', 'system-message');
                      stopCall(); // Сбросить WebRTC ресурсы клиента
                      updateCallUI('idle'); // Вернуться в idle
                     break;
                 case 'call_declined_by_operator': // Оператор отклонил ваш запрос звонка - НОВЫЙ ТИП СИГНАЛА С СЕРВЕРА К КЛИЕНТУ
                    console.log('WS Client: Оператор отклонил запрос звонка.');
                    addMessageToChat('Система', 'Оператор отклонил ваш запрос на звонок.', 'system-message');
                    // Вернуться в idle состояние
                    stopCall(); // Очистка ресурсов и сброс состояния
                    updateCallUI('idle');
                    break;

                 // Клиент не должен получать эти типы сообщений от сервера/оператора в нормальном потоке
                 case 'client_accepted_call':
                 case 'client_declined_call':
                 case 'client_busy':
                      console.warn(`WS Client: Получено неожиданное сообщение типа '${message.type}' от сервера/оператора.`);
                      break;


                default:
                    console.log('WS Client: Получено неизвестное сообщение:', message);
            }
        } catch (e) {
            console.error('WS Client: Ошибка обработки сообщения:', e);
            addMessageToChat('Система', `Ошибка парсинга сообщения от сервера: ${event.data}`, 'system-message');
        }
    };
    websocket.onerror = (event) => {
        console.error('WS Client: Ошибка:', event);
        addMessageToChat('Система', 'Ошибка соединения.', 'system-message');
    };

    websocket.onclose = (event) => {
        console.log('WS Client: Соединение закрыто:', event);
        addMessageToChat('Система', `Соединение с чатом потеряно (код: ${event.code}). Обновите страницу.`, 'system-message');
        clientIdElement.textContent = 'Отключено';
        // Скрываем кнопки звонка/завершения
        if(callControlsSpan) callControlsSpan.style.display = 'none';
        stopCall(); // Очистка WebRTC ресурсов при отключении WS
        updateCallUI('idle'); // Устанавливаем idle состояние UI
    };
}

// --- Функции для WebRTC ---

// Создает RTCPeerConnection и настраивает обработчики
function createPeerConnection() {
    console.log('WS Client: Создание RTCPeerConnection.');
    const pc = new RTCPeerConnection({
         iceServers: [
             { urls: 'stun:stun.l.google.com:19302' } // Пример
         ]
    });
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('WS Client: Отправка ICE кандидата:', event.candidate);
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                 websocket.send(JSON.stringify({
                     type: 'webrtc_candidate',
                     candidate: event.candidate
                 }));
            } else {
                  console.warn('WS Client: Не могу отправить ICE кандидата: нет WS соединения.');
            }
        }
    };
    pc.oniceconnectionstatechange = () => {
         console.log('WS Client: ICE состояние соединения изменилось:', pc.iceConnectionState);
         if (pc.iceConnectionState === 'connected') {
              addMessageToChat('Система', 'Голосовое соединение установлено.', 'system-message');
              updateCallUI('connected'); // UI в состояние "в разговоре"
         } else if (pc.iceConnectionstate === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
             addMessageToChat('Система', 'Голосовое соединение завершено.', 'system-message');
             stopCall(); // Очистка ресурсов
             updateCallUI('idle'); // UI в idle
         }
    };
    pc.onconnectionstatechange = () => {
         console.log('WS Client: Состояние PeerConnection изменилось:', pc.connectionState);
     };
    pc.ontrack = (event) => {
        console.log('WS Client: Получен удаленный трек.', event);
        if (!remoteAudioElement) {
             remoteAudioElement = new Audio();
        }
        remoteAudioElement.srcObject = event.streams[0];
        remoteAudioElement.play().catch(e => console.error('WS Client: Ошибка воспроизведения удаленного аудио:', e));
    };


    return pc;
}

// --- WebRTC Функции для входящих звонков от Оператора (уже были, немного скорректированы) ---

// Функция обработки входящего Offer от оператора
// Вызывается, когда оператор инициирует звонок
async function handleIncomingOffer(sdp) {
    console.log('WS Client: Обработка входящего Offer.');
    // Если уже в звонке или идет другой входящий звонок, отклоняем новый
    // Теперь учитываем состояние 'requesting' - если мы УЖЕ отправили запрос, то новый Offer не может быть входящим звонком, это, вероятно, ответ оператора на наш запрос.
    // В этом случае, если мы находимся в состоянии 'requesting', мы не должны показывать UI входящего звонка, а ждать Answer.
    // Если мы не в 'idle' или не в 'requesting', считаем, что заняты.
    if (callState !== 'idle' && callState !== 'requesting') {
        console.warn('WS Client: Получен Offer, но клиент занят или уже в звонке/запрашивает звонок. Отклоняем.');
         if (websocket && websocket.readyState === WebSocket.OPEN) {
              // Отправляем сигнал "занято" оператору
             websocket.send(JSON.stringify({ type: 'client_busy' }));
         }
        return;
    }

    // Если мы в состоянии 'requesting', то полученный Offer, вероятно, является ответом оператора на наш запрос звонка.
    // В этом случае мы должны обработать его как RemoteDescription и ожидать Answer.
    if (callState === 'requesting') {
         console.log('WS Client: Получен Offer в состоянии "requesting". Обрабатываем как ответ оператора.');
         // Проверяем, что peerConnection уже создан (он должен быть создан в requestCall)
         if (!peerConnection || peerConnection.connectionState === 'closed') {
              console.error('WS Client: Получен Offer в состоянии requesting, но PeerConnection неактивен.');
              addMessageToChat('Система', 'Ошибка при обработке ответа оператора: некорректное состояние.', 'system-message');
              stopCall(); // Очистка
              updateCallUI('idle');
              // TODO: Отправить ошибку оператору?
              return;
         }
          try {
             await peerConnection.setRemoteDescription({ type: 'offer', sdp: sdp });
             console.log('WS Client: Установлен RemoteDescription (Offer от оператора в ответ на наш запрос).');
             // Теперь мы должны создать Answer и отправить его оператору.
             // Эта логика схожа с acceptCall, но вызывается автоматически.
             await createAndSendAnswer();

          } catch (error) {
             console.error('WS Client: Ошибка при установке RemoteDescription (Offer) в состоянии requesting:', error);
             addMessageToChat('Система', `Ошибка при обработке ответа оператора: ${error.message}`, 'system-message');
              stopCall(); // Очистка
              updateCallUI('idle');
              // TODO: Отправить ошибку оператору?
          }
         return; // Завершаем обработку входящего Offer, если мы были в состоянии requesting
    }


    // --- ЛОГИКА ВХОДЯЩЕГО ЗВОНКА ОТ ОПЕРАТОРА (если callState === 'idle') ---
    console.log('WS Client: Получен Offer в состоянии "idle". Это входящий звонок от оператора.');

    // Создаем PeerConnection, если он еще не был создан
    if (!peerConnection || peerConnection.connectionState === 'closed') {
         peerConnection = createPeerConnection();
         console.log('WS Client: Создан RTCPeerConnection при получении входящего Offer.');
    }


    incomingOfferSdp = sdp; // Сохраняем Offer
    // Устанавливаем удаленное описание сразу после получения Offer
    try {
        await peerConnection.setRemoteDescription({ type: 'offer', sdp: incomingOfferSdp });
        console.log('WS Client: Установлен RemoteDescription (Входящий Offer).');
        // incomingOfferSdp = null; // Очищаем сохраненный Offer после использования - НЕТ, он нужен для acceptCall


         // Теперь показываем UI входящего звонка и меняем состояние
        callState = 'incoming'; // Меняем состояние на "входящий звонок"
        updateCallUI('incoming'); // Обновляем UI для входящего звонка

        // Показываем UI уведомления о входящем звонке
        const incomingCallNotification = document.getElementById('incomingCallNotification');
        if(incomingCallNotification) {
            incomingCallNotification.style.display = 'block'; // Или flex
        }
        addMessageToChat('Система', 'Входящий звонок от оператора. Принять?', 'system-message');
    } catch (error) {
        console.error('WS Client: Ошибка при установке RemoteDescription (Входящий Offer):', error);
        addMessageToChat('Система', `Ошибка при обработке предложения звонка: ${error.message}`, 'system-message');
         // В случае ошибки установки RemoteDescription, возможно, стоит сбросить соединение
         stopCall(); // Очистка ресурсов
         updateCallUI('idle');
         // TODO: Отправить ошибку серверу/оператору?
    }
}

// Функция для принятия звонка пользователем (вызывается по клику на кнопку "Принять" ВХОДЯЩЕГО звонка)
async function acceptCall() {
    console.log('WS Client: Клиент нажал "Принять" (входящий звонок).');
    // Скрываем UI уведомления
    const incomingCallNotification = document.getElementById('incomingCallNotification');
    if(incomingCallNotification) {
        incomingCallNotification.style.display = 'none';
    }

    // Проверяем, что у нас есть PeerConnection и мы в правильном состоянии
    // PeerConnection должен быть создан в handleIncomingOffer
    if (!peerConnection || peerConnection.connectionState === 'closed' || callState !== 'incoming') {
        console.error('WS Client: Попытка принять звонок в неверном состоянии или без активного PeerConnection.');
        addMessageToChat('Система', 'Ошибка при приеме звонка: некорректное состояние.', 'system-message');
         stopCall(); // Очистка
         updateCallUI('idle');
         return;
    }

     callState = 'connecting'; // Переходим в состояние "соединение"
     updateCallUI('connecting'); // Обновляем UI

     try {
        // Получаем доступ к микрофону и добавляем трек
        await getLocalMediaAndAddTracks();

        // Создаем и отправляем Answer (теперь это отдельная функция)
        await createAndSendAnswer();

     } catch (error) {
        console.error('WS Client: Ошибка при приеме входящего звонка:', error);
        addMessageToChat('Система', `Ошибка при приеме входящего звонка: ${error.message}`, 'system-message');
         stopCall(); // Очистка в случае ошибки
         updateCallUI('idle');
     }
}

// Функция для отклонения звонка пользователем (вызывается по клику на кнопку "Отклонить" ВХОДЯЩЕГО звонка)
function declineCall() {
    console.log('WS Client: Клиент нажал "Отклонить".');
    // Скрываем UI уведомления
     const incomingCallNotification = document.getElementById('incomingCallNotification');
     if(incomingCallNotification) {
        incomingCallNotification.style.display = 'none';
    }

    // Сбрасываем сохраненный Offer (если был)
    incomingOfferSdp = null;
    // Возвращаемся в idle состояние
    callState = 'idle';
    updateCallUI('idle');

    addMessageToChat('Система', 'Входящий звонок отклонен.', 'system-message');
    // Отправляем серверу сигнал об отклонении звонка (для пересылки оператору)
     if (websocket && websocket.readyState === WebSocket.OPEN) {
         // Отправляем client_declined_call оператору
         websocket.send(JSON.stringify({ type: 'client_declined_call' }));
         console.log('WS Client: Сигнал отклонения звонка отправлен оператору.');
     } else {
          console.warn('WS Client: Не могу отправить сигнал отклонения звонка: нет WS соединения.');
     }

    // Очистка WebRTC ресурсов (закрываем PeerConnection, если он был создан при получении Offer)
    stopCall(); // stopCall также вызовет peerConnection.close() если он существует
}


// --- Общие WebRTC Функции (используются как для инициирующего, так и для принимающего) ---

// Получает локальный аудиопоток и добавляет треки в peerConnection
async function getLocalMediaAndAddTracks() {
    console.log('WS Client: Получение доступа к микрофону и добавление треков.');
    if (!peerConnection || peerConnection.connectionState === 'closed') {
         console.error('WS Client: Попытка добавить треки без активного PeerConnection.');
         throw new Error("PeerConnection неактивен."); // Генерируем ошибку для перехвата в вызывающей функции
    }
     if (localStream) {
         console.log('WS Client: Локальный поток уже существует, очищаем старые треки.');
         localStream.getTracks().forEach(track => track.stop()); // Останавливаем старые треки
         // TODO: Удалить старые треки из peerConnection, если они были добавлены раньше
     }
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('WS Client: Получен доступ к микрофону.');

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    console.log('WS Client: Добавлен локальный аудио трек.');
}

// Создает и отправляет Answer
async function createAndSendAnswer() {
     console.log('WS Client: Создание и отправка Answer.');
     if (!peerConnection || peerConnection.connectionState === 'closed' || !peerConnection.remoteDescription) {
          console.error('WS Client: Невозможно создать Answer: PeerConnection неактивен или нет RemoteDescription.');
          throw new Error("PeerConnection неактивен или нет RemoteDescription.");
     }
     const answer = await peerConnection.createAnswer();
     await peerConnection.setLocalDescription(answer);
     console.log('WS Client: Создан и установлен Answer.');

     if (websocket && websocket.readyState === WebSocket.OPEN) {
         websocket.send(JSON.stringify({
             type: 'webrtc_answer',
             sdp: answer.sdp
         }));
         console.log('WS Client: Answer отправлен на сервер.');
     } else {
         console.warn('WS Client: Не могу отправить Answer: нет WS соединения.');
         throw new Error("Нет WebSocket соединения для отправки Answer.");
     }
}


// Функция обработки входящего ICE кандидата
async function handleAddCandidate(candidate) {
    console.log('WS Client: Добавление ICE кандидата.');
    // Кандидаты могут приходить до установки RemoteDescription, WebRTC поставит их в очередь.
    // Убедимся, что peerConnection создан.
    if (!peerConnection) {
         console.warn('WS Client: Получен ICE кандидат, но RTCPeerConnection еще не создан.');
         // Это может быть нормально при медленном соединении, кандидат будет обработан позже.
         return;
     }
    try {
         if (candidate) {
            await peerConnection.addIceCandidate(candidate);
            console.log('WS Client: ICE кандидат добавлен.');
         } else {
             console.warn('WS Client: Получен пустой ICE кандидат.');
         }

    } catch (error) {
        console.error('WS Client: Ошибка при добавлении ICE кандидата:', error);
        // Это может быть некритичная ошибка
    }
}

// Функция для остановки звонка и очистки ресурсов
function stopCall() {
    console.log('WS Client: Остановка звонка.');
    // Отправить серверу сигнал об остановке звонка ТОЛЬКО если соединение было установлено
    // или мы были в процессе установки (connecting)
    if (websocket && websocket.readyState === WebSocket.OPEN && (callState === 'connecting' || callState === 'connected' || callState === 'hangingup')) {
        websocket.send(JSON.stringify({ type: 'webrtc_hangup' }));
        console.log('WS Client: Сигнал завершения звонка отправлен оператору.');
    } else if (websocket && websocket.readyState === WebSocket.OPEN && callState === 'requesting') {
         // Если мы в состоянии запроса и отменяем его, можно послать специальный сигнал, если нужно
         console.log('WS Client: Отмена запроса звонка.');
         // websocket.send(JSON.stringify({ type: 'cancel_request_call' })); // Пример сигнала отмены запроса
    }


    if (peerConnection && peerConnection.connectionState !== 'closed') {
       peerConnection.close(); // Закрываем соединение
       console.log('WS Client: PeerConnection закрыт.');
       peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop()); // Остановить треки микрофона
        localStream = null;
    }

     if (remoteAudioElement) {
         remoteAudioElement.pause();
         remoteAudioElement.srcObject = null;
         remoteAudioElement = null;
     }

    // Скрываем UI входящего звонка, если он был виден
     if(incomingCallNotification) {
         incomingCallNotification.style.display = 'none';
     }
    // Сбрасываем сохраненный Offer
    incomingOfferSdp = null;
    // Возвращаемся в idle состояние
    callState = 'idle';
    // Обновить UI кнопок звонка
    updateCallUI('idle');
    addMessageToChat('Система', 'Звонок завершен.', 'system-message');
}

// Функция обработки сигнала завершения звонка от оператора
function handleRemoteHangup() {
    console.log('WS Client: Получен сигнал завершения звонка от оператора.');
    // Если соединение еще активно с нашей стороны, закрыть его
    if (peerConnection && peerConnection.connectionState !== 'closed') {
        peerConnection.close();
        peerConnection = null;
        console.log('WS Client: Закрыто соединение после сигнала оператора.');
    }
     // Очистить локальные медиа треки и аудио элемент, если они еще активны
     if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
     }
     if (remoteAudioElement) {
         remoteAudioElement.pause();
         remoteAudioElement.srcObject = null;
         remoteAudioElement = null;
     }
    // Скрываем UI входящего звонка, если он был виден
     if(incomingCallNotification) {
         incomingCallNotification.style.display = 'none';
     }
     // Сбрасываем сохраненный Offer
     incomingOfferSdp = null;
     // Возвращаемся в idle состояние
    callState = 'idle';
    // Обновить UI кнопок звонка
    updateCallUI('idle');
    addMessageToChat('Система', 'Оператор завершил звонок.', 'system-message');
}

// Функция для обновления UI кнопок звонка/завершения
function updateCallUI(state) {
     // state: 'idle', 'requesting', 'incoming', 'connecting', 'connected'
     callState = state; // Обновляем глобальное состояние звонка

    if (clientCallIcon && clientHangupIcon && callControlsSpan) {
        // Показываем или скрываем контейнер кнопок в зависимости от наличия ID клиента
        if (myClientId) {
             callControlsSpan.style.display = 'inline-flex'; // Или flex/block
        } else {
             callControlsSpan.style.display = 'none';
             // Если контейнер скрыт, убедимся, что кнопки внутри тоже скрыты
             clientCallIcon.style.display = 'none';
             clientHangupIcon.style.display = 'none';
             if(incomingCallNotification) incomingCallNotification.style.display = 'none'; // Скрываем уведомление, если нет ID
             return; // Выходим, если нет ID клиента
        }


        if (state === 'idle') {
            clientCallIcon.style.display = 'inline-flex';
            clientHangupIcon.style.display = 'none';
            if(incomingCallNotification) incomingCallNotification.style.display = 'none';
        } else if (state === 'requesting') { // Клиент отправил запрос на звонок оператору И ждет Offer
             clientCallIcon.style.display = 'none'; // Скрываем кнопку "Позвонить"
             clientHangupIcon.style.display = 'inline-flex'; // Показываем кнопку "Отмена запроса" или "Завершить"
             if(incomingCallNotification) incomingCallNotification.style.display = 'none'; // Скрываем UI входящего звонка
             // TODO: Возможно, добавить индикацию "Ожидание оператора..."
        }
        else if (state === 'incoming') { // Получен Offer от оператора (ВХОДЯЩИЙ звонок)
             clientCallIcon.style.display = 'none'; // Скрываем кнопку звонка
             clientHangupIcon.style.display = 'none'; // Скрываем кнопку завершения (показываем кнопки принять/отклонить отдельно)
             // UI уведомления входящего звонка управляется отдельно в handleIncomingOffer/acceptCall/declineCall
        }
        else if (state === 'connecting') { // Идет установка WebRTC соединения (после принятия Offer ИЛИ после отправки Offer и получения Answer)
             clientCallIcon.style.display = 'none';
             clientHangupIcon.style.display = 'inline-flex'; // Показываем кнопку завершения
              if(incomingCallNotification) incomingCallNotification.style.display = 'none';
             // TODO: Возможно, добавить индикацию "Соединение..."
        }
        else if (state === 'connected') { // Соединение установлено, разговор активен
             clientCallIcon.style.display = 'none';
             clientHangupIcon.style.display = 'inline-flex'; // Показываем кнопку завершения
             if(incomingCallNotification) incomingCallNotification.style.display = 'none';
             // TODO: Возможно, добавить индикацию "В разговоре..."
        }
         else if (state === 'hangingup') { // Идет завершение звонка
             clientCallIcon.style.display = 'none';
             clientHangupIcon.style.display = 'none'; // Или показать индикацию "завершение..."
             if(incomingCallNotification) incomingCallNotification.style.display = 'none';
         }
    } else {
         console.error("WS Client: Не найдены все необходимые элементы UI звонка!");
     }
}

// --- Функции интерфейса (addMessageToChat и sendMessage без изменений) ---
function addMessageToChat(user, text, cssClass = null) {
    const messageElement = document.createElement('p');
    messageElement.classList.add('message-bubble');
    if (cssClass) {
        messageElement.classList.add(cssClass);
    }

    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    let sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const urlRegex = /\b((https?:\/\/)|www\.)[\w-]+(\.[\w-]+)+\S*/gi;
    sanitizedText = sanitizedText.replace(urlRegex, (match) => {
        let url = match;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
        }
        return `<a href="${url}" target="_blank">${match}</a>`;
    });
    messageElement.innerHTML = `
        <span class="timestamp">${timestamp}</span>
        <div class="message-content">
            <span class="sender-name"><strong>${user}:</strong></span>
            <span class="message-text">${sanitizedText}</span>
        </div>
    `;
    chatbox.appendChild(messageElement);
    chatbox.scrollTop = chatbox.scrollHeight;
}


function sendMessage() {
    const messageText = messageInput.value.trim();
    if (!messageText) return;
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const message = {
            type: 'message', // Тип 'message' для текстового сообщения клиента
            text: messageText
        };
        websocket.send(JSON.stringify(message));
        addMessageToChat('Вы', messageText, 'client-message'); // Используем класс client-message
        messageInput.value = '';
        // Очистка aiSuggestionArea после отправки сообщения (если есть такой элемент)
        const aiSuggestionArea = document.getElementById('aiSuggestionArea');
        if (aiSuggestionArea) {
             aiSuggestionArea.value = '';
         }
    } else {
        addMessageToChat('Система', 'Не удалось отправить сообщение. Соединение не установлено.', 'system-message');
    }
}

// --- Привязка событий ---
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
    }
});
// Привязка обработчика клика к иконке звонка (запрос оператору)
if (clientCallIcon) {
    clientCallIcon.addEventListener('click', async () => { // Добавляем async
        if (myClientId && websocket && websocket.readyState === WebSocket.OPEN) {
            // Разрешаем запросить звонок только в состоянии idle
            if (callState === 'idle') {
                console.log(`WS Client: Клик по иконке "Звонок". Мой ID: ${myClientId}. Инициируем звонок.`);

                try {
                    // 1. Создаем PeerConnection
                    peerConnection = createPeerConnection();
                    console.log('WS Client: Создан RTCPeerConnection для исходящего звонка.');

                    // 2. Получаем доступ к микрофону и добавляем треки
                    await getLocalMediaAndAddTracks();

                    // 3. Создаем Offer
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    console.log('WS Client: Создан и установлен Offer.');

                    // 4. Отправляем Offer на сервер для пересылки оператору
                    websocket.send(JSON.stringify({
                        type: 'request_call', // Клиент отправляет Offer
                        sdp: offer.sdp
                    }));
                    console.log('WS Client: Offer отправлен на сервер для оператора.');

                     addMessageToChat('Система', 'Попытка звонка оператору. Ожидайте ответа.', 'system-message');

                    // Меняем UI на состояние "соединение" или "ожидание ответа"
                    updateCallUI('requesting'); // Или 'connecting'

                } catch (error) {
                    console.error('WS Client: Ошибка при инициировании звонка:', error);
                    addMessageToChat('Система', `Ошибка при звонке: ${error.message}`, 'system-message');
                    stopCall(); // Очистка ресурсов в случае ошибки
                }


            } else {
                console.warn('WS Client: Попытка инициировать звонок в состоянии:', callState);
                addMessageToChat('Система', 'В данный момент невозможно начать звонок.', 'system-message');
            }

        } else if (!myClientId) {
            console.warn('WS Client: Клик по иконке звонка, но ID клиента еще не получен.');
            addMessageToChat('Система', 'Ваш ID еще не получен. Попробуйте позже.', 'system-message');
        } else { // Нет WS соединения
             addMessageToChat('Система', 'Не удалось начать звонок: нет соединения с сервером.', 'system-message');
         }
    });
} else {
     console.error("WS Client: Элемент иконки звонка не найден.");
 }

// Привязка обработчика клика к иконке завершения звонка
if (clientHangupIcon) {
     clientHangupIcon.addEventListener('click', () => {
         console.log('WS Client: Клик по иконке "Завершить звонок".');
         // StopCall() обрабатывает отправку webrtc_hangup и очистку
         stopCall();
     });
 } else {
      console.error("WS Client: Элемент иконки завершения звонка не найден.");
 }

// Привязка обработчиков для кнопок принять/отклонить входящего звонка
if(acceptCallButton) {
    acceptCallButton.addEventListener('click', acceptCall);
 } else {
     console.error("WS Client: Элемент кнопки 'Принять' не найден.");
 }

if(declineCallButton) {
     declineCallButton.addEventListener('click', declineCall);
} else {
      console.error("WS Client: Элемент кнопки 'Отклонить' не найден.");
 }


// --- Инициализация ---
// Убедимся, что все необходимые элементы найдены перед подключением
if (!clientIdElement || !chatbox || !messageInput || !sendButton || !clientCallIcon || !clientHangupIcon || !callControlsSpan || !incomingCallNotification || !acceptCallButton || !declineCallButton) {
    console.error("WS Client: Не найдены все необходимые элементы HTML!");
 } else {
    // Все элементы найдены, можно подключаться к WebSocket
    connectWebSocket();
    // Инициализируем UI звонка в начальное состояние (скрываем все, кроме базового чата)
    // Видимость callControlsSpan будет управляться при получении ID клиента
    updateCallUI('idle'); // Установит состояние 'idle', но UI будет скрыт, пока не придет ID
}

// Функция для отображения ID клиента (нужно добавить элемент с id="clientId" в HTML)
// <span id="clientId">Подключение...</span>


// Функция для отображения подсказок AI (нужно добавить элемент с id="aiSuggestionArea" в HTML)
// <textarea id="aiSuggestionArea" readonly placeholder="Подсказки AI"></textarea>


