// server.js - Версия с поддержкой WebRTC сигнализации, подтверждения клиента И приема структурированных JSON от Python

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const port = 3000;
const server = http.createServer(app);

const clientWss = new WebSocket.Server({ noServer: true });
const operatorWss = new WebSocket.Server({ noServer: true });

let currentClientWs = null;
let currentClientId = null;
let currentOperatorWs = null; // Храним ссылку на единственного оператора

// TODO: Возможно, добавить состояние звонка на сервере, чтобы лучше управлять логикой

// Функция для запуска Python скриптов (модифицирована для обработки JSON на stdout)
function triggerPythonEvent(scriptName, data) {
    const pythonExecutable = 'python';
    const scriptPath = `./${scriptName}`; // Предполагаем, что скрипты в корне или подпапке
    console.log(`[Node->Py] Запуск ${scriptName} с помощью '${pythonExecutable}' и данными:`, data);

    try {
        const pythonProcess = spawn(pythonExecutable, [scriptPath]);

        pythonProcess.on('error', (err) => {
            console.error(`[Node->Py] Ошибка запуска ${scriptName}: ${err.message}`);
        });

        // Передаем данные в JSON формате через stdin
        // Добавляем перевод строки в конце, чтобы Python знал, когда сообщение закончилось
        pythonProcess.stdin.write(JSON.stringify(data) + '\n');
        pythonProcess.stdin.end();


        // --- НОВАЯ ЛОГИКА: Обработка stdout Python скрипта для JSON ---
        let pythonStdoutBuffer = ''; // Буфер для накопления данных из stdout Python скрипта
        pythonProcess.stdout.on('data', (output) => {
            // Добавляем полученные данные в буфер (предполагаем UTF-8 кодировку для текстового вывода)
            pythonStdoutBuffer += output.toString('utf8');

            // Ищем разделитель (перевод строки) в буфере. Python скрипт должен печатать JSON,
            // а затем перевод строки после каждого объекта.
            let newlineIndex = pythonStdoutBuffer.indexOf('\n');

            // Обрабатываем все полные JSON сообщения, которые есть в буфере
            while (newlineIndex > -1) {
                const jsonString = pythonStdoutBuffer.substring(0, newlineIndex); // Извлекаем строку до перевода строки
                pythonStdoutBuffer = pythonStdoutBuffer.substring(newlineIndex + 1); // Оставшаяся часть буфера

                // Логируем полученную JSON строку (опционально, для отладки)
                console.log(`[Py->Node] Получена JSON строка из ${scriptName} stdout: ${jsonString}`);

                try {
                    // Парсим JSON строку в JavaScript объект
                    const processingResults = JSON.parse(jsonString);
                    console.log('[Node] Распарсены результаты обработки:', processingResults);

                    // TODO: Теперь отправляем эти результаты оператору по WebSocket
                    if (currentOperatorWs && currentOperatorWs.readyState === WebSocket.OPEN) {
                        // Отправляем объект напрямую, он будет сериализован в JSON библиотекой ws
                        sendToOperator({ type: 'processing_results', data: processingResults }); // НОВЫЙ ТИП СООБЩЕНИЯ для структурированных результатов
                        console.log(`[Node] Processing results from ${scriptName} sent to operator.`);

                        // TODO: Можно также проверить наличие поля 'reference_answer' или 'summary'
                        // в результатах и отправить их оператору как обычный текстовый AI ответ,
                        // используя существующий механизм (если нужно)
                        if (processingResults.summary) {
                            // Send summary as an AI suggestion message
                            sendToOperator({ type: 'ai_suggestion', text: processingResults.summary });
                            console.log(`[Node] Sent AI suggestion from ${scriptName} (summary) to operator.`);
                        } else if (processingResults.reference_answer) {
                            // Send reference answer as an AI suggestion message if no summary
                             sendToOperator({ type: 'ai_suggestion', text: processingResults.reference_answer });
                             console.log(`[Node] Sent AI suggestion from ${scriptName} (reference_answer) to operator.`);
                        }


                    } else {
                        console.warn(`[Node] Received processing results from ${scriptName}, but operator not connected to send.`);
                    }

                } catch (e) {
                    // Исправлена ошибка в строке для корректного использования обратных кавычек и двойных кавычек
                    console.error(`[Node] Error parsing JSON from ${scriptName} stdout: ${e}. Invalid string: "${jsonString}"`);
                    // TODO: Handle parsing errors, perhaps notify operator/admin
                }

                // Ищем следующий перевод строки в оставшейся части буфера
                newlineIndex = pythonStdoutBuffer.indexOf('\n');
            }

            // Optional: Limit buffer size to prevent memory issues if newlines are missing
            const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // Example: 10 MB limit
            if (pythonStdoutBuffer.length > MAX_BUFFER_SIZE) {
                console.error(`[Node] ${scriptName} stdout buffer is too large. Missing newline delimiter? Clearing buffer.`);
                pythonStdoutBuffer = ''; // Clear buffer to recover
                // TODO: Maybe terminate the Python process if this happens repeatedly?
            }
        });
        // --- Конец НОВОЙ ЛОГИКИ обработки stdout ---


        pythonProcess.stderr.on('data', (error) => {
             // Указываем кодировку при преобразовании буфера в строку для stderr
            // Попробуйте 'utf8', 'cp866', 'cp1251'
            console.error(`[Py->Node] ${scriptPath} stderr: ${error.toString('utf8').trim()}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`[Node->Py] ${scriptName} завершился с кодом ${code}`);
             // TODO: Уведомить оператора или клиента о завершении работы скрипта?
        });

         pythonProcess.on('error', (err) => { // Обработчик 'error' для spawn
            console.error(`[Node->Py] Ошибка при запуске/работе Python процесса ${scriptName}: ${err}`);
        });


    } catch (spawnError) {
        console.error(`[Node->Py] Критическая ошибка при попытке запуска ${scriptName}: ${spawnError.message}`);
    }
}


// Упрощенные функции отправки для 1 на 1 (без изменений)
function sendToClient(message) {
    if (currentClientWs && currentClientWs.readyState === WebSocket.OPEN) {
        const messageString = JSON.stringify(message);
        console.log(`[Node->Client] Отправка клиенту ${currentClientId}:`, messageString);
        currentClientWs.send(messageString, (err) => {
            if (err) { console.error(`[Node->Client] Ошибка отправки клиенту ${currentClientId}: ${err}`); }
        });
    } else {
        console.warn('[Node->Client] Клиент не подключен. Сообщение не отправлено.');
        // Уведомить оператора, если он есть
        if (currentOperatorWs && currentOperatorWs.readyState === WebSocket.OPEN) {
            currentOperatorWs.send(JSON.stringify({ type: 'system_error', text: 'Не удалось отправить сообщение клиенту: не подключен.' }));
        }
    }
}

function sendToOperator(message) {
    if (currentOperatorWs && currentOperatorWs.readyState === WebSocket.OPEN) {
           const messageString = JSON.stringify(message);
           console.log('[Node->Op] Отправка оператору:', messageString);
           currentOperatorWs.send(messageString, (err) => {
               if (err) { console.error(`[Node->Op] Ошибка отправки оператору: ${err}`); }
           });
    } else {
        console.warn('[Node->Op] Оператор не подключен. Сообщение не отправлено.');
        // Уведомить клиента, если он есть
        if (currentClientWs && currentClientWs.readyState === WebSocket.OPEN) {
            currentClientWs.send(JSON.stringify({ type: 'system_error', text: 'Не удалось отправить сообщение оператору: не подключен.' }));
        }
    }
}


clientWss.on('connection', (ws, request) => {
    if (currentClientWs && currentClientWs.readyState === WebSocket.OPEN) {
        console.log('[Node] Попытка подключения второго клиента отклонена.');
        ws.close(1000, 'Only one client allowed');
        return;
    }

    currentClientWs = ws;
    currentClientId = crypto.randomUUID();
    console.log(`[Node] Клиент подключился: ${currentClientId} (с IP: ${request.socket.remoteAddress})`);

    sendToClient({ type: 'your_id', clientId: currentClientId });

    // Уведомляем оператора о новом клиенте (если он есть)
    if (currentOperatorWs) {
          sendToOperator({ type: 'client_connected', clientId: currentClientId });
          // Отправляем оператору список активных клиентов (только 1)
          sendToOperator({ type: 'active_clients', clientIds: [currentClientId] });
    }


    ws.on('message', (messageBuffer) => {
        const messageString = messageBuffer.toString();
        console.log(`[Client->Node] Сообщение от клиента ${currentClientId}: ${messageString}`);
        try {
            const message = JSON.parse(messageString);

             if (!message || !message.type) {
                 console.warn(`[Node] Неверный формат сообщения от клиента ${currentClientId}: Отсутствует поле 'type'.`, messageString);
                 // TODO: Отправить ошибку клиенту?
                 return;
             }

            // --- Обработка сообщений клиента, включая WebRTC сигнализацию ---
            switch (message.type) {
                case 'message': // Обычное текстовое сообщение
                     if (typeof message.text === 'string') {
                         const safeText = message.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                         triggerPythonEvent('../src/ask_agent.py', { // Вызов скрипта для текстового сообщения
                             clientId: currentClientId,
                             text: safeText
                         });
                         // Отправляем текстовое сообщение оператору (если он есть)
                         if (currentOperatorWs) {
                            sendToOperator({ type: 'client_message', clientId: currentClientId, text: safeText });
                         }
                     } else {
                         console.warn(`[Node] Неверный формат текстового сообщения от клиента ${currentClientId}:`, message);
                         // TODO: Отправить ошибку клиенту?
                     }
                     break;

                case 'request_call': // Клиент запрашивает звонок
                     console.log(`[Node] Получен запрос звонка от клиента ${currentClientId}`);
                     // Уведомить оператора о запросе звонка (если он есть)
                     if (currentOperatorWs) {
                         sendToOperator({ type: 'client_request_call', clientId: currentClientId });
                     } else {
                          // Если оператора нет, уведомить клиента
                          sendToClient({ type: 'system_error', text: 'Оператор не в сети. Попробуйте позже.' });
                     }
                     break;

                case 'webrtc_offer': // Клиент отправляет Offer (неожиданно в этой модели)
                     console.warn(`[Node] Получен неверный тип сообщения 'webrtc_offer' от клиента ${currentClientId}. Ожидается 'webrtc_answer'.`);
                     // TODO: Отправить ошибку клиенту?
                     break;

                case 'webrtc_answer': // Клиент отправляет Answer в ответ на Offer оператора
                     console.log(`[Node] Получен Answer от клиента ${currentClientId}`);
                     if (message.sdp) {
                         // Переслать Answer оператору (если он есть)
                         if (currentOperatorWs) {
                            sendToOperator({ type: 'webrtc_answer', clientId: currentClientId, sdp: message.sdp });
                         } else {
                             console.warn('[Node] Получен Answer от клиента, но оператор не в сети.');
                             // TODO: Уведомить клиента об ошибке?
                         }
                     } else {
                         console.warn(`[Node] Получен неполный Answer от клиента ${currentClientId}`);
                          // TODO: Отправить ошибку клиенту?
                     }
                     break;

                case 'webrtc_candidate': // Клиент отправляет ICE кандидат
                    console.log(`[Node] Получен ICE кандидат от клиента ${currentClientId}`);
                     if (message.candidate) {
                         // Переслать кандидат оператору (если он есть)
                         if (currentOperatorWs) {
                            sendToOperator({ type: 'webrtc_candidate', clientId: currentClientId, candidate: message.candidate });
                         } else {
                             console.warn('[Node] Получен ICE кандидат от клиента, но оператор не в сети.');
                              // TODO: Уведомить клиента об ошибке?
                         }
                     } else {
                          console.warn(`[Node] Получен неполный ICE кандидат от клиента ${currentClientId}`);
                           // TODO: Отправить ошибку клиенту?
                     }
                     break;

                case 'webrtc_hangup': // Клиент завершает звонок
                     console.log(`[Node] Получен сигнал завершения звонка от клиента ${currentClientId}`);
                     // Уведомить оператора (если он есть)
                      if (currentOperatorWs) {
                          sendToOperator({ type: 'client_hangup', clientId: currentClientId });
                      }
                     // TODO: Возможно, сбросить состояние звонка на сервере
                     break;

                    case 'client_accepted_call': // Клиент принял входящий звонок (новый тип!)
                     console.log(`[Node] Получен сигнал принятия звонка от клиента ${currentClientId}`);
                     // Переслать оператору
                      if (currentOperatorWs) {
                           sendToOperator({ type: 'client_accepted_call', clientId: currentClientId });
                       }
                     break;

                    case 'client_declined_call': // Клиент отклонил входящий звонок (новый тип!)
                     console.log(`[Node] Получен сигнал отклонения звонка от клиента ${currentClientId}`);
                      // Переслать оператору
                       if (currentOperatorWs) {
                            sendToOperator({ type: 'client_declined_call', clientId: currentClientId });
                       }
                     break;

                     case 'client_busy': // Клиент занят (новый тип!)
                     console.log(`[Node] Получен сигнал "клиент занят" от клиента ${currentClientId}`);
                      // Переслать оператору
                       if (currentOperatorWs) {
                            sendToOperator({ type: 'client_busy', clientId: currentClientId });
                       }
                     break;


                default:
                     console.warn(`[Node] Получено неизвестное сообщение типа '${message.type}' от клиента ${currentClientId}:`, message);
                     // TODO: Отправить ошибку клиенту?
            }

        } catch (e) {
            console.error(`[Node] Ошибка парсинга JSON от клиента ${currentClientId}: ${e}. Сообщение: "${messageString}"`);
             // TODO: Отправить ошибку клиенту?
        }
    });

    ws.on('close', (code, reason) => {
        const reasonString = reason.toString();
        console.log(`[Node] Клиент отключился: ${currentClientId} (Код: ${code}, Причина: ${reasonString})`);
        const disconnectedClientId = currentClientId;
        currentClientWs = null;
        currentClientId = null;
        // Уведомить оператора об отключении клиента (если он есть)
        if (currentOperatorWs) {
            sendToOperator({ type: 'client_disconnected', clientId: disconnectedClientId, reason: reasonString });
             // Отправить оператору сигнал, что звонок (если он был активен) завершен
            sendToOperator({ type: 'client_hangup', clientId: disconnectedClientId }); // Отключение клиента = завершение звонка с его стороны
        }
    });

    ws.on('error', (error) => {
        console.error(`[Node] WebSocket ошибка клиента ${currentClientId}: ${error.message}`);
        const erroredClientId = currentClientId;
        currentClientWs = null;
        currentClientId = null;
         // Уведомить оператора об ошибке клиента (если он есть)
        if (currentOperatorWs) {
            sendToOperator({ type: 'client_error', clientId: erroredClientId, error: error.message });
             // Отправить оператору сигнал, что звонок (если он был активен) завершен
            sendToOperator({ type: 'client_hangup', clientId: erroredClientId }); // Ошибка соединения = завершение звонка
        }
    });
});

operatorWss.on('connection', (ws, request) => {
     // Если оператор уже подключен, отклонить новое подключение (для 1 на 1 демо)
     if (currentOperatorWs && currentOperatorWs.readyState === WebSocket.OPEN) {
          console.log('[Node] Попытка подключения второго оператора отклонена.');
          ws.close(1000, 'Only one operator allowed');
          return;
     }

    currentOperatorWs = ws; // Устанавливаем ссылку на единственного оператора
    console.log(`[Node] Оператор подключился (с IP: ${request.socket.remoteAddress})`);

    // Отправляем новому оператору список активных клиентов (теперь только один или ноль)
    const activeClientIds = currentClientId ? [currentClientId] : [];
    sendToOperator({ type: 'active_clients', clientIds: activeClientIds });

     // Если есть активный клиент, уведомить оператора о его наличии
    if (currentClientId) {
        sendToOperator({ type: 'client_connected', clientId: currentClientId });
         // TODO: Если клиент запросил звонок до подключения оператора, уведомить оператора об этом здесь
    }


    ws.on('message', (messageBuffer) => {
        // Оператор отправляет только JSON сигнальные сообщения или текстовые сообщения
        // Здесь не ожидаются бинарные аудиоданные в этой версии.
        const messageString = messageBuffer.toString();
        console.log(`[Op->Node] Сообщение от оператора: ${messageString}`);
        try {
            const message = JSON.parse(messageString);

             if (!message || !message.type) {
                 console.warn('[Node] Неверный формат сообщения от оператора: Отсутствует поле \'type\'.', messageString);
                 // TODO: Отправить ошибку оператору
                 return;
             }

            // --- Обработка сообщений оператора, включая WebRTC сигнализацию ---
            switch (message.type) {
                 case 'message_to_client': // Обычное текстовое сообщение
                     // Убедимся, что оператор указал clientId, хотя в 1 на 1 он всегда один
                     // В этой демо-версии мы просто отправляем текущему клиенту, если он есть
                      if (currentClientWs && currentClientId && typeof message.text === 'string') {
                          const safeText = message.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                          triggerPythonEvent('../src/ask_agent.py', { // Вызов скрипта для текстового сообщения
                            clientId: currentClientId, // Используем ID текущего клиента
                            text: safeText
                          });
                          sendToClient({ type: 'operator_message', text: safeText });
                      } else {
                         console.warn('[Node] Оператор попытался отправить текстовое сообщение, но клиент не подключен или формат неверен.');
                          // TODO: Отправить ошибку оператору
                          if (ws.readyState === WebSocket.OPEN) { // Убедимся, что ws еще активно
                                ws.send(JSON.stringify({ type: 'system_error', text: 'Не удалось отправить текстовое сообщение: клиент не подключен или формат неверен.' }));
                           }
                      }
                      break;

                case 'webrtc_offer': // Оператор инициирует звонок, отправляя Offer
                     console.log('[Node] Получен Offer от оператора.');
                     if (currentClientWs && currentClientId && message.sdp) {
                         // Переслать Offer текущему клиенту
                         sendToClient({ type: 'webrtc_offer', sdp: message.sdp });
                         console.log(`[Node] Offer от оператора переслан клиенту ${currentClientId}`);
                     } else {
                         console.warn('[Node] Оператор попытался отправить Offer, но клиент не подключен или Offer неполный.');
                         // TODO: Отправить ошибку оператору
                          if (ws.readyState === WebSocket.OPEN) { // Убедимся, что ws еще активно
                                ws.send(JSON.stringify({ type: 'system_error', text: 'Не удалось начать звонок: клиент не подключен или Offer неполный.' }));
                           }
                     }
                     break;

                case 'webrtc_answer': // Оператор отправляет Answer (неожиданно в этой модели)
                     console.log('[Node] Получен Answer от оператора.');
                     console.warn('[Node] Получен неверный тип сообщения \'webrtc_answer\' от оператора. Оператор не должен отправлять Answer.');
                     // TODO: Отправить ошибку оператору
                      if (ws.readyState === WebSocket.OPEN) { // Убедимся, что ws еще активно
                           ws.send(JSON.stringify({ type: 'system_error', text: 'Получен неверный тип сообщения (Answer). Оператор не должен отправлять Answer.' }));
                      }
                     break;


                case 'webrtc_candidate': // Оператор отправляет ICE кандидат
                     console.log('[Node] Получен ICE кандидат от оператора.');
                     if (currentClientWs && currentClientId && message.candidate) {
                         // Переслать кандидат текущему клиенту
                         sendToClient({ type: 'webrtc_candidate', candidate: message.candidate });
                         console.log(`[Node] ICE кандидат от оператора переслан клиенту ${currentClientId}`);
                     } else {
                         console.warn('[Node] Оператор попытался отправить ICE кандидат, но клиент не подключен или кандидат неполный.');
                         // TODO: Отправить ошибку оператору
                          if (ws.readyState === WebSocket.OPEN) { // Убедимся, что ws еще активно
                                ws.send(JSON.stringify({ type: 'system_error', text: 'Не удалось отправить ICE кандидат: клиент не подключен или кандидат неполный.' }));
                           }
                     }
                     break;

                case 'webrtc_hangup': // Оператор завершает звонок
                     console.log('[Node] Получен сигнал завершения звонка от оператора.');
                     // Переслать сигнал завершения звонка текущему клиенту
                     if (currentClientWs && currentClientId) {
                         sendToClient({ type: 'operator_hangup' }); // Уведомляем клиента
                     }
                     // TODO: Возможно, сбросить состояние звонка на сервере
                     break;

                // --- Обработка сигналов от клиента о подтверждении/отклонении звонка (пересылаются оператору) ---
                case 'client_accepted_call': // Клиент принял звонок (после получения Offer)
                case 'client_declined_call': // Клиент отклонил звонок (после получения Offer)
                case 'client_busy': // Клиент занят
                     console.log(`[Node] Пересылка сигнала от клиента оператору: ${message.type}`);
                     // Переслать оператору (текущему)
                     if (currentOperatorWs && currentOperatorWs.readyState === WebSocket.OPEN) {
                         // В этих сообщениях уже есть clientId, пересылаем их как есть
                         currentOperatorWs.send(messageString); // Пересылаем оригинальную строку
                     } else {
                         console.warn(`[Node] Получен сигнал '${message.type}' от клиента, но оператор не в сети.`);
                         // TODO: Что делать, если оператор не в сети при получении client_accepted/declined/busy?
                     }
                     break;


                default:
                     console.warn(`[Node] Получено неизвестное сообщение типа '${message.type}' от оператора:`, message);
                      // TODO: Отправить ошибку оператору
                      if (ws.readyState === WebSocket.OPEN) { // Убедимся, что ws еще активно
                           ws.send(JSON.stringify({ type: 'system_error', text: `Получен неизвестный тип сообщения: ${message.type}` }));
                      }
            }

        } catch (e) {
            console.error(`[Node] Ошибка парсинга JSON от оператора: ${e}. Сообщение: "${messageString}"`);
             // TODO: Отправить ошибку оператору
             if (ws.readyState === WebSocket.OPEN) { // Убедимся, что ws еще активно
                  ws.send(JSON.stringify({ type: 'system_error', text: 'Ошибка обработки вашего сообщения сервером.' }));
             }
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[Node] Оператор отключился (Код: ${code}, Причина: ${reason.toString()})`);
        currentOperatorWs = null; // Сбрасываем ссылку на оператора
        // Уведомить клиента об отключении оператора (если он есть)
        if (currentClientWs) {
             sendToClient({ type: 'operator_disconnected' }); // Новый тип сообщения для клиента
              // Отправить клиенту сигнал, что звонок (если он был активен) завершен
             sendToClient({ type: 'operator_hangup' }); // Отключение оператора = завершение звонка
         }
         // TODO: Возможно, сбросить состояние звонка на сервере
    });

    ws.on('error', (error) => {
        console.error(`[Node] WebSocket ошибка оператора: ${error.message}`);
         currentOperatorWs = null; // Сбрасываем ссылку на оператора при ошибке
        // Уведомить клиента об ошибке оператора (если он есть)
         if (currentClientWs) {
             sendToClient({ type: 'operator_error' }); // Новый тип сообщения для клиента
              // Отправить клиенту сигнал, что звонок (если он был активен) завершен
             sendToClient({ type: 'operator_hangup' }); // Ошибка оператора = завершение звонка
         }
         // TODO: Возможно, сбросить состояние звонка на сервере
    });
});


// --- Настройка Express и ручной обработки Upgrade ---
app.use(express.static(path.join(__dirname, 'public')));

server.on('upgrade', (request, socket, head) => {
    const pathname = request.url;

    console.log(`[HTTP] Попытка WebSocket upgrade для пути: ${pathname}`);

    if (pathname === '/client') {
        clientWss.handleUpgrade(request, socket, head, (ws) => {
            clientWss.emit('connection', ws, request);
        });
    } else if (pathname === '/operator') {
        operatorWss.handleUpgrade(request, socket, head, (ws) => {
            operatorWss.emit('connection', ws, request);
        });
    } else {
        console.log(`[HTTP] Неверный путь для WebSocket: ${pathname}. Соединение закрыто.`);
        socket.destroy();
    }
});

// --- Запуск HTTP сервера ---
server.listen(port, () => {
    console.log(`[HTTP] Сервер запущен на http://localhost:${port}`);
    console.log(`[WS] Клиенты подключаются к ws://localhost:${port}/client`);
    console.log(`[WS] Операторы подключаются к ws://localhost:${port}/operator`);
});