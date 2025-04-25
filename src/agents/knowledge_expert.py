# -*- coding: utf-8 -*-
"""Knowledge Expert Agent implementation."""

import logging
import ast # Add ast import
from typing import Dict, Any, Tuple, List # Add List
import pandas as pd # Import pandas

# Use relative imports for modules within the same package/project
from .base_agent import BaseMwsAgent
# Change relative import to absolute import
from .utils import call_mws_gpt
# Import SemanticSearch instead of VectorDB
from .semantic_search import SemanticSearch

class KnowledgeExpertAgent(BaseMwsAgent):
    """Agent responsible for retrieving and adapting information from the knowledge base."""

    # Update type hint and parameter name
    def __init__(self, role: str, goal: str, backstory: str, semantic_search_engine: SemanticSearch, top_k: int = 3): # Add top_k parameter
        super().__init__(role, goal, backstory)
        # Rename instance variable
        self.semantic_search = semantic_search_engine
        self.top_k = top_k # Store top_k

    def run(self, query: str, shared_context: Dict[str, Any]) -> Tuple[str, float]:
        # Extract the actual query from the potentially longer input string
        # This logic might be duplicated if ProxyAgent passes the raw task description
        actual_query = query
        if "Последний запрос клиента:" in query:
             query_start = query.find("Последний запрос клиента: ") + len("Последний запрос клиента: ")
             query_end = query.find(""", query_start)
             if query_start != -1 and query_end != -1:
                 actual_query = query[query_start:query_end].strip(""")

        def execution():
            emotion = shared_context.get('emotion', 'нейтральная').lower()
            intent = shared_context.get('intent', '')

            # Define tone instruction based on emotion
            tone_instruction = ""
            if 'раздражение' in emotion or 'недовольство' in emotion:
                tone_instruction = "Начни с фразы 'Мы понимаем ваше беспокойство' и используй эмпатичный, успокаивающий тон. Избегай сложного технического жаргона, объясняй просто."
            elif 'любопытство' in emotion:
                tone_instruction = "Используй информативный и вовлекающий тон. Начни с фразы 'Интересный вопрос!' и добавь дополнительные детали, если возможно."
            else:
                tone_instruction = "Используй четкий и деловой тон. Предоставляй точные инструкции без лишних деталей. Не добавляй эмоциональных фраз, таких как 'успокоить'."

            # Check for confirmed problems for discounts
            problem_keywords = ['не работает', 'списали', 'ошибка', 'проблема', 'глючит', 'зависает']
            is_confirmed_problem = intent == 'жалоба' and emotion == 'недовольство' and any(keyword in actual_query.lower() for keyword in problem_keywords)
            if is_confirmed_problem:
                shared_context['discount_offered'] = True
                shared_context['discount_details'] = "Предложить клиенту скидку 20% на следующий месяц услуг."
            else:
                shared_context['discount_offered'] = False
                shared_context['discount_details'] = ""

            # Check for service request that doesn't exist (e.g., carpooling)
            service_keywords = ['карпулинг', 'blablacar', 'попутчик', 'совместные поездки']
            is_service_request = any(keyword in actual_query.lower() for keyword in service_keywords)
            if is_service_request:
                shared_context['alternative_service'] = "МТС Такси или аренда электросамокатов через партнерские сервисы."
            else:
                shared_context['alternative_service'] = ""

            # Handle knowledge expert logic
            if len(actual_query.split()) <= 1 and actual_query in ['интернет', 'услуги', 'тариф']:
                answer = ("Слишком широкий запрос. Возможно, вы имели в виду:\n" 
                          "- Как раздать интернет с телефона\n"
                          "- Не работает мобильный интернет\n"
                          "- Не работает домашний интернет")
                shared_context['reference_answer'] = answer
                return answer

            # Use semantic_search instead of vector_db, using self.top_k
            results_df = self.semantic_search.search(actual_query, k=self.top_k) # Use self.top_k
            
            # Store search results in shared_context for logging
            if not results_df.empty:
                # Convert DataFrame to a more loggable format
                search_results = []
                for index, row in results_df.iterrows():
                    result = {
                        'similarity_score': row.get('similarity_score', 0.0),
                        'name': row.get('name', ''),
                        'urlArticleOnSupport': row.get('urlArticleOnSupport', '')
                    }
                    search_results.append(result)
                shared_context['search_results'] = search_results
            
            # Check if the DataFrame is not empty
            if not results_df.empty:
                combined_answer = ""
                sources_list = []
                processed_results = 0 # Counter for results with valid content

                # Iterate through the top k results
                for index, row in results_df.iterrows():
                    answer_part = ""
                    # Get the string representation from 'content_data'
                    content_data_str = row.get('content_data', '[]') # Default to empty list string
                    url = row.get('urlArticleOnSupport', '') # Keep getting URL directly for now

                    try:
                        # Safely parse the string into a Python list
                        content_data_list = ast.literal_eval(content_data_str)
                        # Ensure it's a list
                        if isinstance(content_data_list, list):
                            # Extract content from the first dictionary that has it
                            for item in content_data_list:
                                if isinstance(item, dict) and item.get('content'):
                                    answer_part = item['content']
                                    # Optionally extract URL from here if needed
                                    # url = item.get('urlArticleOnSupport', url) # Uncomment if URL is inside the list dicts
                                    break # Stop after finding the first content
                    except (ValueError, SyntaxError, TypeError) as e:
                        logging.warning(f"Could not parse content_data for query '{actual_query}': {e}. Data: {content_data_str}")
                        content_data_list = [] # Treat as empty if parsing fails

                    # Append the extracted content if found
                    if answer_part:
                        processed_results += 1
                        similarity = row.get('similarity_score', 0.0)
                        # Format each result clearly
                        combined_answer += f"**Результат {processed_results} (Сходство: {similarity:.4f}):**\n{answer_part}\n\n"
                        # Collect unique source URLs
                        if url and url not in sources_list:
                            sources_list.append(url)

                sources_str = "\n".join(sources_list) if sources_list else ""

                # Proceed if we found at least one answer part
                if combined_answer:
                    # Call GPT to adapt the combined answer
                    system_prompt = f"""
Ты {self.role}. {self.backstory}
{tone_instruction}
Твоя задача — скомбинировать и адаптировать информацию из нескольких ответов базы знаний ({processed_results} шт.), чтобы предоставить единый, точный, структурированный ответ, строго соответствующий эталонному стилю поддержки МТС.
Ответ должен синтезировать информацию из предоставленных фрагментов, сохраняя ключевые шаги, списки и форматирование, без добавления лишних деталей (например, APN, перезагрузка телефона, авиарежим). Отдавай предпочтение информации из результатов с наименьшим 'similarity_score' (наиболее релевантных).
Используй списки, заголовки и переносы строк для ясности.
Если запрос связан с сервисом, которого нет (например, карпулинг или BlaBlaCar), укажи, что сервис недоступен, и предложи альтернативу, например: 'К сожалению, сервис карпулинга недоступен, но вы можете воспользоваться МТС Такси или арендой электросамокатов через партнерские сервисы.'
Если запрос — жалоба с подтвержденной проблемой (например, сбой приложения, списание средств), добавь: 'Мы готовы предложить вам скидку 20% на следующий месяц услуг для компенсации неудобств.'
KION — это онлайн-кинотеатр от МТС, где вы можете смотреть фильмы, сериалы, ТВ-каналы и мультфильмы в хорошем качестве. Основные возможности: бесплатный контент без регистрации, новинки и подборки, эксклюзивные сериалы (например, «Первый номер»), доступ на любых устройствах, подписка KION+Premium с доступом к музыке, книгам, кэшбэком и скидками. Скачайте приложение KION или посетите kion.ru ,https://kion.ru
Примеры эталонных ответов:
- Запрос: 'интернет' → 'Слишком широкий запрос. Возможно, вы имели в виду:\n- Как раздать интернет с телефона\n- Не работает мобильный интернет\n- Не работает домашний интернет'
- Запрос: 'раздача интернета' → 'Для раздачи интернета включите режим модема в настройках телефона.\nКак включить режим модема на Android:\n1. Зайдите в Настройки\n2. В строке поиска введите запрос «модем»\n3. Выберите из результатов поиска Режим модема или Мобильная точка доступа и модем\n4. Нажмите на кнопку переключения в пункте, который может называться «Мобильная точка доступа», «Личная точка доступа» или «Точка доступа Wi-Fi»\nВ отдельном пункте вы можете задать пароль для защиты вашего соединения.\nКак включить режим модема на iOS:\n1. Зайдите в Настройки > Режим модема\n2. Нажмите кнопку переключения в пункте Разрешать другим\nВ отдельном пункте вы можете задать пароль для защиты вашего соединения.'
- Запрос: 'куда пропали 120 рублей' → 'Мы понимаем ваше беспокойство. Чтобы выяснить, куда пропали 120 рублей, проверьте детализацию расходов в приложении Мой МТС или обратитесь в контактный центр по номеру 0890.'
- Запрос: 'хочу карпулинг как blablacar' → 'К сожалению, сервис карпулинга, подобный BlaBlaCar, сейчас недоступен в МТС. Вы можете воспользоваться другими транспортными решениями МТС, такими как МТС Такси или аренда электросамокатов через партнерские сервисы. Для заказа поездки скачайте приложение МТС Транспорт.'
- Запрос: 'приложение не работает списали деньги' → 'Мы понимаем ваше беспокойство. Если приложение МТС не работает и с вашего счета были списаны деньги, проверьте детализацию расходов в приложении Мой МТС или обратитесь в контактный центр по номеру 0890 для уточнения и решения проблемы. Мы готовы предложить вам скидку 20% на следующий месяц услуг для компенсации неудобств.'
Не добавляй информацию, отсутствующую в базе знаний.
"""
                    user_prompt = f"""
Запрос: {actual_query}
Эмоция клиента: {emotion}
Намерение клиента: {intent}
Ответы из базы знаний (отсортированы по релевантности):
{combined_answer}
Подтвержденная проблема: {'Да' if is_confirmed_problem else 'Нет'}
Запрос сервиса: {'Да' if is_service_request else 'Нет'}
Скомбинируй и адаптируй ответы, чтобы они строго соответствовали тексту из базы знаний и эталонному стилю, не добавляя лишних деталей. Если подтверждена проблема, добавь предложение скидки. Если запрошен недоступный сервис, предложи альтернативу.
"""
                    adapted_answer = call_mws_gpt([
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ])

                    # Append discount/sources *after* GPT adaptation if needed
                    final_answer = adapted_answer
                    if is_confirmed_problem and "скидку 20%" not in final_answer: # Avoid duplicating discount message
                        final_answer += ("\n\nМы готовы предложить вам скидку 20% "
                                         "на следующий месяц услуг для компенсации неудобств.")
                    # Use the combined, unique sources string
                    if sources_str:
                        final_answer += f"\n\nИсточники:\n{sources_str}"

                    shared_context['reference_answer'] = final_answer
                    return final_answer
                # Correct indentation for this else block
                else: # Handle case where results exist but no valid 'content' found in any row
                    # Log the actual columns found in the first result row for debugging
                    first_row_cols = list(results_df.iloc[0].index) if not results_df.empty else []
                    logging.warning(f"SemanticSearch for '{actual_query}' found {len(results_df)} results but no valid 'content' column value was extracted. Columns found: {first_row_cols}")
                    # Fall through to the 'no result found' logic below
                    pass # Explicitly pass to fall through

            # Handle case where semantic search returns no result or no answer could be extracted
            logging.warning(f"SemanticSearch for '{actual_query}' returned no valid answer. DataFrame empty: {results_df.empty}")
            answer = "К сожалению, я не смог найти точный ответ на ваш вопрос в базе знаний."
            if is_service_request:
                answer = (f"К сожалению, запрашиваемый сервис недоступен. "
                          f"Вы можете воспользоваться альтернативными решениями МТС, такими как {shared_context.get('alternative_service', 'МТС Такси')}. "
                          f"Для заказа поездки скачайте приложение МТС Транспорт.\n\n"
                          f"Источники:\nhttps://mts.ru/transport") # Provide a default source if applicable
            elif len(actual_query.split()) > 3: # Offer clarification for longer queries too
                 answer = "Пожалуйста, попробуйте переформулировать ваш запрос."
            else: # Default clarification for short/unclear queries
                answer = "Пожалуйста, уточните ваш запрос, например, 'Как раздать интернет?' или 'Почему не работает интернет?'"

            shared_context['reference_answer'] = answer
            return answer


        # Pass the original 'query' (potentially the full task description) to the logger
        return self._log_and_measure_time(query, execution)

