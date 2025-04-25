const activeClientsElement = document.getElementById('activeClients'); // Это span с ID
const chatbox = document.getElementById('chatbox');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const aiSuggestionArea = document.getElementById('aiSuggestionArea');
// Новые элементы UI для WebRTC
const callIcon = document.querySelector('#clientsList .icon-button.call-icon');
const hangupIcon = document.querySelector('#clientsList .icon-button.hangup-icon');
const clientsListDiv = document.getElementById('clientsList'); // Родитель для делегирования
const clientIntentElement = document.getElementById('clientIntent');
const clientEmotionElement = document.getElementById('clientEmotion');
const loadingIndicator = document.getElementById('loadingIndicator');

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/operator`;
let websocket;
let currentActiveClients = new Set(); // Set для хранения ID клиента (максимум 1)
let oldAiVal = '';

const incomingRequestUI = document.getElementById('incomingRequestUI'); // Контейнер UI входящего запроса
const incomingRequestClientInfo = document.getElementById('incomingRequestClientInfo'); // Элемент для отображения ID клиента в запросе
const acceptRequestButton = document.getElementById('acceptRequestButton'); // Кнопка "Принять запрос"
const declineRequestButton = document.getElementById('declineRequestButton'); // Кнопка "Отклонить запрос"

// Переменная для хранения ID клиента при входящем ЗАПРОСЕ звонка
let pendingClientRequestId = null;


// --- Новые функции для UI входящего ЗАПРОСА звонка ---

function showLoadingIndicator() {
    if (loadingIndicator) {
        loadingIndicator.style.display = 'inline-block'; // Или 'block', в зависимости от элемента и макета
    }
}

function hideLoadingIndicator() {
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
}

function showIncomingRequestUI(clientId) {
    console.log('WS Operator: Показ UI входящего запроса звонка.');
    if (incomingRequestUI && incomingRequestClientInfo) {
        // Отображаем ID клиента в UI запроса
        incomingRequestClientInfo.textContent = clientId ? clientId.substring(0, 8) + '...' : 'Неизвестно';
        // Показываем контейнер UI
        incomingRequestUI.style.display = 'block'; // Или 'flex', в зависимости от вашего CSS
        addMessageToChat('Система', `Входящий запрос звонка от клиента ${clientId.substring(0,8)}...`, 'system-message');
        // TODO: Возможно, отключить другие действия оператора, пока висит запрос
    } else {
         console.error("WS Operator: Элементы UI входящего запроса звонка не найдены!");
         // Если UI не найден, возможно, стоит автоматически отклонить запрос?
         // declineRequest(); // Автоматически отклоняем, если UI не готов
    }
    // TODO: Возможно, скрыть кнопки звонка/завершения в clientsList, пока висит запрос
}

function hideIncomingRequestUI() {
    console.log('WS Operator: Скрытие UI входящего запроса звонка.');
    if (incomingRequestUI) {
        incomingRequestUI.style.display = 'none';
    }
    // TODO: Возможно, снова показать кнопки звонка/завершения в clientsList
}

// --- Новые функции для обработки действий оператора с входящим ЗАПРОСОМ звонка ---

async function acceptRequest() {
     console.log('WS Operator: Оператор нажал "Принять запрос".');
     hideIncomingRequestUI(); // Скрываем UI запроса

     if (pendingClientRequestId) {
          const clientIdToCall = pendingClientRequestId;
          pendingClientRequestId = null; // Очищаем ID после принятия

          // Проверяем, не занят ли оператор уже другим звонком
          if (peerConnection && peerConnection.connectionState !== 'closed') {
               console.warn('WS Operator: Попытка принять запрос, но оператор уже в активном звонке.');
               addMessageToChat('Система', 'Не удалось принять запрос звонка: оператор уже в звонке.', 'system-message');
               // TODO: Отправить клиенту сигнал "оператор занят"
               if (websocket && websocket.readyState === WebSocket.OPEN) {
                    websocket.send(JSON.stringify({ type: 'operator_busy', targetClientId: clientIdToCall }));
               }
               return;
          }

          // Инициируем WebRTC звонок этому клиенту
          initiateCall(clientIdToCall);

     } else {
          console.error('WS Operator: Нажата кнопка "Принять запрос", но нет ожидающего запроса.');
          addMessageToChat('Система', 'Нет активного запроса звонка для принятия.', 'system-message');
     }
}

function declineRequest() {
     console.log('WS Operator: Оператор нажал "Отклонить запрос".');
     hideIncomingRequestUI(); // Скрываем UI запроса

     if (pendingClientRequestId) {
          const clientIdDeclined = pendingClientRequestId;
          pendingClientRequestId = null; // Очищаем ID после отклонения

          addMessageToChat('Система', `Запрос звонка от клиента ${clientIdDeclined.substring(0,8)}... отклонен.`, 'system-message');

          // TODO: Отправить клиенту сигнал об отклонении запроса (НОВЫЙ ТИП СООБЩЕНИЯ)
          if (websocket && websocket.readyState === WebSocket.OPEN) {
               websocket.send(JSON.stringify({ type: 'call_declined_by_operator', targetClientId: clientIdDeclined }));
               console.log('WS Operator: Сигнал об отклонении запроса отправлен клиенту.');
          } else {
               console.warn('WS Operator: Не могу отправить сигнал об отклонении запроса: нет WS соединения.');
          }

     } else {
          console.warn('WS Operator: Нажата кнопка "Отклонить запрос", но нет ожидающего запроса.');
     }
     // Убедимся, что UI звонка в idle состоянии
     updateCallUI('idle');
}

// --- Переменные для WebRTC ---
let localStream = null; // Поток с локального микрофона
let peerConnection = null; // Объект WebRTC соединения
let remoteAudioElement = null; // Элемент для воспроизведения удаленного аудио
// --- Функции для WebRTC ---

// Создает RTCPeerConnection и настраивает обработчики
function createPeerConnection() {
    console.log('WS Operator: Создание RTCPeerConnection.');
    // Здесь можно указать STUN/TURN серверы
    const pc = new RTCPeerConnection({
         iceServers: [
             { urls: 'stun:stun.l.google.com:19302' } // Пример бесплатного STUN сервера Google
         ]
    });

    // Обрабатываем входящие треки от удаленного пира (клиента)
    pc.ontrack = (event) => {
        console.log('WS Operator: Получен удаленный трек.', event);
        // Воспроизвести удаленный аудио поток.
        if (!remoteAudioElement) {
             remoteAudioElement = new Audio();
             // Можно добавить remoteAudioElement в DOM для отладки или управления
             // document.body.appendChild(remoteAudioElement);
        }
        remoteAudioElement.srcObject = event.streams[0];
        remoteAudioElement.play().catch(e => console.error('WS Operator: Ошибка воспроизведения удаленного аудио:', e));
    };

    // Обрабатываем изменения состояния ICE сбора кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('WS Operator: Отправка ICE кандидата:', event.candidate);
            // Отправить event.candidate на сервер для пересылки клиенту
             if (websocket && websocket.readyState === WebSocket.OPEN && currentActiveClients.size > 0) {
                 const targetClientId = currentActiveClients.values().next().value;
                 websocket.send(JSON.stringify({
                     type: 'webrtc_candidate',
                     targetClientId: targetClientId, // Указываем, кому предназначен кандидат
                     candidate: event.candidate
                 }));
             } else {
                  console.warn('WS Operator: Не могу отправить ICE кандидата: нет WS соединения или активного клиента.');
             }
        }
    };

    // Обрабатываем изменения состояния соединения
    pc.oniceconnectionstatechange = () => {
         console.log('WS Operator: ICE состояние соединения изменилось:', pc.iceConnectionState);
         // TODO: Обновить UI в зависимости от состояния (connected, disconnected, failed)
         if (pc.iceConnectionState === 'connected') {
              addMessageToChat('Система', 'Голосовое соединение установлено.', 'system-message');
              updateCallUI('connected');
         } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
             addMessageToChat('Система', 'Голосовое соединение завершено.', 'system-message');
             stopCall(); // Очистка ресурсов
         }
    };

     pc.onconnectionstatechange = () => {
         console.log('WS Operator: Состояние PeerConnection изменилось:', pc.connectionState);
         // Можно использовать connectionState как более высокоуровневый индикатор
         // connected, disconnected, failed, closed
     };


    return pc;
}


// Функция для инициации звонка оператором
async function initiateCall(targetClientId) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        addMessageToChat('Система', 'Ошибка: нет соединения с сервером.', 'system-message');
        return;
    }
    if (!targetClientId) {
         addMessageToChat('Система', 'Ошибка: нет активного клиента для звонка.', 'system-message');
         return;
    }
     if (peerConnection && peerConnection.connectionState !== 'closed') {
         console.warn('WS Operator: Попытка начать звонок, но предыдущее соединение еще активно.');
          addMessageToChat('Система', 'Звонок уже активен или устанавливается.', 'system-message');
         return;
     }


    addMessageToChat('Система', `Попытка звонка клиенту ${targetClientId.substring(0, 8)}...`, 'system-message');
    console.log(`WS Operator: Инициация звонка клиенту ${targetClientId}`);

    try {
        // 1. Получаем доступ к микрофону
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('WS Operator: Получен доступ к микрофону.');

        // 2. Создаем RTCPeerConnection
        peerConnection = createPeerConnection();
        console.log('WS Operator: Создан RTCPeerConnection.');

        // 3. Добавляем локальный аудио трек в соединение
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        console.log('WS Operator: Добавлен локальный аудио трек.');

        // 4. Создаем Offer (предложение)
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        console.log('WS Operator: Создан и установлен Offer.');

        // 5. Отправляем Offer на сервер для пересылки клиенту
        websocket.send(JSON.stringify({
            type: 'webrtc_offer',
            targetClientId: targetClientId, // Указываем, кому предназначен Offer
            sdp: offer.sdp
        }));
        console.log('WS Operator: Offer отправлен на сервер.');
         updateCallUI('calling'); // Обновляем UI: индикация вызова

    } catch (error) {
        console.error('WS Operator: Ошибка при инициации звонка:', error);
        addMessageToChat('Система', `Ошибка при звонке: ${error.message}`, 'system-message');
        stopCall(); // Очистка ресурсов в случае ошибки
    }
}

// Функция обработки входящего Answer от клиента
async function handleAnswer(sdp) {
    console.log('WS Operator: Обработка входящего Answer.');
    if (!peerConnection) {
         console.error('WS Operator: Получен Answer, но RTCPeerConnection не создан.');
         // Это может произойти, если Answer пришел после того, как оператор уже сбросил звонок
         // TODO: Возможно, отправить клиенту сигнал об ошибке или завершении
         return;
    }
     if (peerConnection.connectionState === 'closed') {
         console.warn('WS Operator: Получен Answer, но соединение уже закрыто.');
          // TODO: Отправить клиенту сигнал об ошибке или завершении
         return;
     }

    try {
        // Устанавливаем удаленное описание (Answer)
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: sdp });
        console.log('WS Operator: Установлен RemoteDescription (Answer).');
        // Звонок должен начать соединяться (обмен кандидатами)
    } catch (error) {
         console.error('WS Operator: Ошибка при обработке Answer:', error);
         addMessageToChat('Система', `Ошибка при обработке ответа на звонок: ${error.message}`, 'system-message');
         stopCall(); // Очистка в случае ошибки
    }
}

// Функция обработки входящего ICE кандидата от клиента
async function handleAddCandidate(candidate) {
    console.log('WS Operator: Добавление ICE кандидата.');
    if (!peerConnection || !peerConnection.remoteDescription) {
        console.warn('WS Operator: Получен ICE кандидат, но удаленное описание еще не установлено.');
        // Это может быть нормально, если кандидат пришел раньше SDP.
        // WebRTC добавит его в очередь автоматически.
        // TODO: Если нужна ручная очередь кандидатов, реализовать ее здесь
        return;
    }
    try {
        // Добавляем удаленный ICE кандидат в Peer Connection
        // Проверяем, что candidate не null/undefined
         if (candidate) {
            await peerConnection.addIceCandidate(candidate);
            console.log('WS Operator: ICE кандидат добавлен.');
         } else {
            console.warn('WS Operator: Получен пустой ICE кандидат.');
         }

    } catch (error) {
        console.error('WS Operator: Ошибка при добавлении ICE кандидата:', error);
        // Это может быть некритичная ошибка в некоторых случаях
    }
}

// Функция для остановки звонка и очистки ресурсов
function stopCall() {
    console.log('WS Operator: Остановка звонка.');
    if (peerConnection && peerConnection.connectionState !== 'closed') {
        // Отправить серверу сигнал об остановке звонка, чтобы он уведомил клиента
        if (websocket && websocket.readyState === WebSocket.OPEN && currentActiveClients.size > 0) {
             const targetClientId = currentActiveClients.values().next().value;
             websocket.send(JSON.stringify({ type: 'webrtc_hangup', targetClientId: targetClientId }));
             console.log('WS Operator: Сигнал завершения звонка отправлен клиенту.');
        }
        peerConnection.close(); // Закрываем соединение
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop()); // Остановить треки микрофона/камеры
        localStream = null;
    }

     if (remoteAudioElement) {
         remoteAudioElement.pause();
         remoteAudioElement.srcObject = null; // Отвязать поток
         // remoteAudioElement.remove(); // Если добавляли в DOM
         remoteAudioElement = null;
     }

    // TODO: Обновить UI
    updateCallUI('idle'); // Обновляем UI: ожидание звонка
    addMessageToChat('Система', 'Звонок завершен.', 'system-message'); // Сообщаем в чате
}

// Функция обработки сигнала завершения звонка от клиента
function handleRemoteHangup() {
    console.log('WS Operator: Получен сигнал завершения звонка от клиента.');
    // Если соединение еще активно с нашей стороны, закрыть его
    if (peerConnection && peerConnection.connectionState !== 'closed') {
        peerConnection.close();
        peerConnection = null;
        console.log('WS Operator: Закрыто соединение после сигнала клиента.');
    }
     // TODO: Очистить локальные медиа треки и аудио элемент, если они еще активны
     if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
     }
     if (remoteAudioElement) {
         remoteAudioElement.pause();
         remoteAudioElement.srcObject = null;
         remoteAudioElement = null;
     }
    // TODO: Обновить UI
    updateCallUI('idle'); // Обновляем UI: ожидание звонка
    addMessageToChat('Система', 'Клиент завершил звонок.', 'system-message');
}

// Функция для обновления UI кнопок звонка/завершения
function updateCallUI(state) {
    // state может быть 'idle', 'calling', 'connected'
    if (callIcon && hangupIcon) {
        if (state === 'idle') {
             // Показываем кнопку звонка только если есть активный клиент
             if (currentActiveClients.size > 0) {
                callIcon.style.display = 'inline-flex';
             } else {
                 callIcon.style.display = 'none';
             }
            hangupIcon.style.display = 'none';
        } else if (state === 'calling') {
            callIcon.style.display = 'none'; // Или показать индикацию на самой кнопке звонка
            hangupIcon.style.display = 'inline-flex';
            // TODO: Возможно, добавить индикацию "Вызов..."
        } else if (state === 'connected') {
            callIcon.style.display = 'none';
            hangupIcon.style.display = 'inline-flex';
            // TODO: Возможно, добавить индикацию "В разговоре..."
        }
         // Состояние incoming обрабатывается на клиенте, оператор только видит ответ клиента (accepted, declined, busy)
    }
     // TODO: Обновить статус клиента в clientsListElement, если нужно (например, "в сети", "в звонке", "запрашивает звонок")
     // activeClientsElement.textContent = clientId.substring(0, 8) + '... (в звонке)';
}


// --- Функции интерфейса (addMessageToChat и updateClientsList) ---
function addMessageToChat(user, text, cssClass = '') { // Убрал clientId=null по умолчанию
    const messageElement = document.createElement('p');
    messageElement.classList.add('message-bubble');
    if (cssClass) {
        messageElement.classList.add(cssClass);
    }

    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const sanitizedUser = user.replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
            <span class="sender-name"><strong>${sanitizedUser}:</strong></span>
            <span class="message-text">${sanitizedText}</span>
        </div>
    `;

    chatbox.appendChild(messageElement);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function updateClientsList() {
    activeClientsElement.innerHTML = '';

    // Скрываем весь блок списка клиентов по умолчанию, если клиентов нет
    if (clientsListDiv) {
        clientsListDiv.style.display = currentActiveClients.size > 0 ? 'block' : 'none'; // Используем block или flex в зависимости от вашего CSS
    }

    // Видимость кнопок звонка/завершения управляется в updateCallUI
    // поэтому вызываем ее после обновления списка клиентов
    updateCallUI(peerConnection && peerConnection.connectionState !== 'closed' ? 'connected' : 'idle');


    if (currentActiveClients.size > 0) {
        const clientId = currentActiveClients.values().next().value;
        activeClientsElement.textContent = clientId.substring(0, 8) + '...';
        activeClientsElement.title = clientId;
    }
    // Если currentActiveClients пуст, activeClientsElement останется пустым, и clientsListDiv будет скрыт
}


function sendMessage() {
    const messageText = messageInput.value.trim();

    if (currentActiveClients.size === 0) {
        addMessageToChat('Система', 'Не удалось отправить сообщение: клиент не подключен.', 'system-message');
        console.warn('WS Operator: Попытка отправить сообщение без активного клиента.');
        return;
    }

    if (!messageText) {
        alert('Пожалуйста, введите текст сообщения.');
        return;
    }

    const targetClientId = currentActiveClients.values().next().value;

    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const message = {
            type: 'message_to_client',
            clientId: targetClientId,
            text: messageText
        };
        websocket.send(JSON.stringify(message));
        addMessageToChat(`Вы -> ${targetClientId.substring(0,8)}...`, messageText, 'operator-reply');
        messageInput.value = '';
    } else {
        addMessageToChat('Система', 'Не удалось отправить сообщение. Соединение с сервером не установлено.', 'system-message');
    }
}

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
    }
});

// --- Обработка кликов по иконкам через делегирование ---
if (clientsListDiv) {
    clientsListDiv.addEventListener('click', (event) => {
        const target = event.target;

        // Проверяем, что клик был именно по кнопке, а не по контейнеру clientsListDiv
         if (!target.classList.contains('icon-button')) {
             return;
         }


         const currentClient = currentActiveClients.size > 0 ? currentActiveClients.values().next().value : null;

         if (!currentClient) {
             console.warn('WS Operator: Клик по иконке, но активного клиента нет.');
             addMessageToChat('Система', 'Нет активного клиента для этого действия.', 'system-message');
             return;
         }

         if (target.classList.contains('settings-icon')) {
             console.log(`WS Operator: Клик по иконке "Настройки" для клиента: ${currentClient}`);
              addMessageToChat('Система', `Настройки клиента ${currentClient.substring(0, 8)}... (действие не реализовано).`, 'system-message');

         } else if (target.classList.contains('call-icon')) {
             console.log(`WS Operator: Клик по иконке "Звонок" для клиента: ${currentClient}`);
             // Проверяем, что звонок не активен
              if (!peerConnection || peerConnection.connectionState === 'closed') {
                initiateCall(currentClient); // Инициируем звонок
              } else {
                console.warn('WS Operator: Попытка начать звонок, но соединение уже активно.');
                addMessageToChat('Система', 'Звонок уже активен.', 'system-message');
              }


         } else if (target.classList.contains('hangup-icon')) {
             console.log(`WS Operator: Клик по иконке "Завершить звонок" для клиента: ${currentClient}`);
             // Завершаем звонок
              if (peerConnection && peerConnection.connectionState !== 'closed') {
                 stopCall(); // Завершаем звонок
              } else {
                 console.warn('WS Operator: Попытка завершить звонок, но соединение неактивно.');
                 addMessageToChat('Система', 'Звонок неактивен.', 'system-message');
                updateCallUI('idle'); // Убедимся, что UI в правильном состоянии
              }
         }
    });
} else {
    console.error("WS Operator: Элемент #clientsList не найден для привязки делегирования событий.");
}

// --- Обработка входящих сообщений от сервера (интегрировано) ---
function connectWebSocket() {
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
        console.log('WS Operator: Соединение установлено.');
        addMessageToChat('Система', 'Подключено к серверу.', 'system-message');
        // При успешном подключении сервер сам пришлет active_clients, если клиент уже есть.
        // updateClientsList() будет вызвана при получении active_clients.
    };

    websocket.onmessage = (event) => {
        console.log('WS Operator: Сообщение от сервера: ', event.data);
        try {
            const message = JSON.parse(event.data);

            if (!message || !message.type) {
                 console.warn('WS Operator: Неверный формат сообщения от сервера: Отсутствует поле \'type\'.', event.data);
                 addMessageToChat('Система', 'Получено сообщение в неверном формате от сервера.', 'system-message');
                 return;
            }

            switch (message.type) {
                case 'active_clients': // Получен список активных клиентов при подключении оператора
                     console.log('WS Operator: Получен список активных клиентов:', message.clientIds);
                     currentActiveClients.clear();
                     if (Array.isArray(message.clientIds)) {
                          message.clientIds.forEach(clientId => currentActiveClients.add(clientId));
                     }
                     updateClientsList(); // Обновляем UI списка клиентов
                     break;

                case 'client_connected': // Новый клиент подключился
                    console.log('WS Operator: Клиент подключился:', message.clientId);
                    currentActiveClients.add(message.clientId); // Добавляем клиента в Set
                    updateClientsList(); // Обновляем UI списка клиентов
                     addMessageToChat('Система', `Клиент ${message.clientId.substring(0,8)}... подключился.`, 'system-message');
                    break;

                case 'client_disconnected': // Клиент отключился
                     console.log('WS Operator: Клиент отключился:', message.clientId);
                     currentActiveClients.delete(message.clientId); // Удаляем клиента из Set
                     updateClientsList(); // Обновляем UI списка клиентов
                     addMessageToChat('Система', `Клиент ${message.clientId.substring(0,8)}... отключился.`, 'system-message');
                    // Если клиент отключился, возможно, нужно завершить звонок с его стороны
                    handleRemoteHangup(); // Используем ту же функцию, что и при сигнале hangup

                    break;

                 case 'client_error': // Ошибка клиента
                     console.warn('WS Operator: Ошибка на стороне клиента:', message.clientId, message.error);
                     // В случае ошибки клиента, считаем, что связь потеряна, и удаляем из списка
                     currentActiveClients.delete(message.clientId);
                     updateClientsList();
                      addMessageToChat('Система', `Ошибка на стороне клиента ${message.clientId.substring(0,8)}...: ${message.error}`, 'system-message');
                      // Также завершаем звонок
                      handleRemoteHangup();

                     break;

                 case 'client_message': // Текстовое сообщение от клиента
                    console.log('WS Operator: Сообщение от клиента:', message.clientId, message.text);
                     addMessageToChat(`Клиент ${message.clientId.substring(0,8)}...`, message.text, 'client-message');
                     showLoadingIndicator()
                     // TODO: Возможно, передать сообщение для AI анализа
                     if (aiSuggestionArea && typeof message.text === 'string') {
                         // triggerPythonEvent('analyze_message.py', { text: message.text }); // Пример вызова анализа
                     }
                    break;

                 case 'ai_suggestion': // Ответ от AI (если используете)
                     console.log('WS Operator: Получен ответ от AI:', message.suggestion);
                     if (aiSuggestionArea && typeof message.suggestion === 'string') {
                          aiSuggestionArea.value = message.suggestion;
                     }
                     break;

                case 'system_error': // Системная ошибка с сервера
                     console.error('WS Operator: Ошибка сервера:', message.text);
                      addMessageToChat('Система', `Ошибка сервера: ${message.text}`, 'system-message');
                     break;


                // --- Обработка входящих WebRTC сигнальных сообщений ---
                case 'webrtc_offer': // Оператор не должен получать Offer в этой модели
                     console.warn('WS Operator: Получен unexpected Offer от сервера.');
                     // TODO: Отправить ошибку серверу?
                     break;
                case 'webrtc_answer': // Получен Answer от клиента (через сервер)
                    console.log('WS Operator: Получен Answer от клиента.');
                    if (message.sdp) {
                        handleAnswer(message.sdp);
                    } else {
                         console.warn('WS Operator: Получен неполный Answer.');
                    }
                    break;
                case 'webrtc_candidate': // Получен ICE кандидат от клиента (через сервер)
                    console.log('WS Operator: Получен ICE кандидат от клиента.');
                    if (message.candidate) {
                        handleAddCandidate(message.candidate);
                    } else {
                         console.warn('WS Operator: Получен пустой ICE кандидат.');
                    }
                    break;
                case 'client_hangup': // Клиент завершил звонок
                     console.log('WS Operator: Получен сигнал завершения звонка от клиента.');
                     handleRemoteHangup(); // Обработать завершение удаленной стороной
                     break;

                case 'client_request_call': // Клиент запрашивает звонок
                    console.log(`WS Operator: Получен запрос звонка от клиента ${message.clientId}.`);
                    
                    // Проверяем, что оператор не занят другим звонком или запросом
                    if (peerConnection && peerConnection.connectionState !== 'closed') {
                        console.warn('WS Operator: Получен запрос звонка, но оператор уже в звонке.');
                        addMessageToChat('Система', `Получен запрос звонка от клиента ${message.clientId.substring(0,8)}..., но оператор уже в звонке.`, 'system-message');
                        // TODO: Отправить клиенту сигнал "оператор занят"
                        // if (websocket && websocket.readyState === WebSocket.OPEN) {
                        //     websocket.send(JSON.stringify({ type: 'operator_busy', targetClientId: message.clientId }));
                        // }
                    } else {
                        // Если оператор свободен, сохраняем ID клиента и показываем UI входящего запроса
                        pendingClientRequestId = message.clientId; // Сохраняем ID клиента, запросившего звонок
                        addMessageToChat('Система', `Входящий запрос звонка от клиента ${message.clientId.substring(0,8)}...`, 'system-message');
                    }
                    break;

                case 'processing_results':
                    console.log('WS Operator: Получены результаты обработки от сервера:', message.data);
                    if (message.data && typeof message.data === 'object') {
                        // Получили объект с результатами обработки от Python
                        const results = message.data;
                        // Выводим alert с некоторыми данными из результатов
                        // Для примера используем JSON.stringify, чтобы показать весь объект
                        // В реальном приложении вы бы отобразили это более дружелюбно в UI
                        // TODO: Отобразить результаты в UI вместо alert
                        // Например, обновить элементы на панели оператора
                        if (clientIntentElement) {
                            clientIntentElement.textContent = results.intent || 'Не определено';
                        }
                        if (clientEmotionElement) {
                            clientEmotionElement.textContent = results.emotion || 'Не определено';
                        }
                        if (aiSuggestionArea) {
                            
                            aiSuggestionArea.value = results.reference_answer + 
                                `\n\nНе забудьте добавить:\n${results.action}\n` +
                                `\nКорректность ответа:\n${results.qa}` +
                                `\n####################\n\n` + 
                                oldAiVal;

                            oldAiVal = aiSuggestionArea.value;
                        }
                        hideLoadingIndicator()


                    } else {
                        console.warn('WS Operator: Получены результаты обработки в неверном формате.', message);
                    }
                    break;

                // --- Обработка сигналов от клиента о подтверждении/отклонении звонка ---
                case 'client_accepted_call': // Клиент принял входящий звонок (новый тип!)
                     console.log('WS Operator: Клиент подтвердил принятие звонка.');
                     addMessageToChat('Система', `Клиент ${message.clientId.substring(0,8)}... принял звонок. Соединение устанавливается...`, 'system-message');
                     // На этом этапе оператор уже отправил Offer и ожидает Answer/Candidates.
                     // Получение этого сигнала подтверждает, что клиент начал процесс ответа.
                     // UI уже в состоянии 'calling'. Фактический переход в 'connected' произойдет по ICE.
                     // TODO: Возможно, обновить индикацию вызова на "Клиент принял, установка соединения..."
                     break;

                case 'client_declined_call': // Клиент отклонил звонок (новый тип!)
                     console.log('WS Operator: Клиент отклонил звонок.');
                     addMessageToChat('Система', `Клиент ${message.clientId.substring(0,8)}... отклонил звонок.`, 'system-message');
                     // Клиент отказался, нужно завершить попытку звонка со стороны оператора
                     stopCall(); // Завершаем звонок

                     break;

                case 'client_busy': // Клиент занят (новый тип!)
                     console.log('WS Operator: Получен сигнал "клиент занят" от клиента.');
                     addMessageToChat('Система', `Клиент ${message.clientId.substring(0,8)}... занят.`, 'system-message');
                     // Клиент занят, нужно завершить попытку звонка со стороны оператора
                     stopCall(); // Завершаем звонок

                     break;

                default:
                    console.log('WS Operator: Получено неизвестное сообщение:', message);
            }
        } catch (e) {
            console.error('WS Operator: Ошибка обработки сообщения:', e);
            addMessageToChat('Система', `Ошибка парсинга сообщения от сервера: ${event.data}`, 'system-message');
        }
    };

    websocket.onerror = (event) => {
        console.error('WS Operator: Ошибка:', event);
        addMessageToChat('Система', 'Ошибка соединения.', 'system-message');
    };

    websocket.onclose = (event) => {
        console.log('WS Operator: Соединение закрыто:', event);
        addMessageToChat('Система', `Соединение с сервером потеряно (код: ${event.code}). Обновите страницу.`, 'system-message');
        currentActiveClients.clear(); // Очищаем список активных клиентов при отключении от сервера
        updateClientsList(); // Обновляем UI списка клиентов
        stopCall(); // Завершаем активный звонок при потере соединения с сервером
    };
}


// Инициализация
// Убедимся, что все необходимые элементы найдены перед подключением
if (!activeClientsElement || !chatbox || !messageInput || !sendButton || !clientsListDiv || !callIcon || !hangupIcon || !aiSuggestionArea) { // Добавил aiSuggestionArea
     console.error("WS Operator: Не найдены все необходимые элементы HTML!");
} else {
    // Все элементы найдены, можно подключаться к WebSocket
    connectWebSocket();

    // Инициализируем UI звонка в начальное состояние (скрываем кнопку завершения)
    // Это нужно сделать после того, как элементы callIcon и hangupIcon найдены
    // updateCallUI('idle'); // Initial call moved inside updateClientsList

    // При старте список клиентов пуст. updateClientsList скроет блок.
    // Фактическое обновление списка клиентов и UI звонка произойдет
    // при получении active_clients или client_connected от сервера.
    updateClientsList();
}