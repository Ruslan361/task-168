# -*- coding: utf-8 -*-
"""
Script to ask a single question to an MwsAgent instance.
"""
import os
os.environ["CREWAI_TELEMETRY_ENABLED"] = "false"
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter

# Установите пустой экспортёр, чтобы отключить отправку данных
trace_provider = TracerProvider()
trace_provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))


import time
import logging
# Import CrewAI components
from crewai import Crew, Task
# Import SemanticSearch from its new location within agents
from agents.semantic_search import SemanticSearch, APIEmbeddingProvider # Assuming API provider usage
# Import all necessary agent classes
from agents import (
    KnowledgeExpertAgent, IntentRecognizerAgent, EmotionAnalyzerAgent,
    ActionAdvisorAgent, SummaryGeneratorAgent, QualityControllerAgent
)
# Import ProxyAgent if needed for shared context (as in tum.py)
from agents import ProxyAgent

# Import logger from config or use standard logging
# from config import logger
import logging # Using standard logging

# Define API Key (replace with your actual key or import mechanism)
API_KEY = "sk-KNo006G2a48UVE3IxFlQEQ"

def ask_all_agents():
    """
    Instantiates all agents, defines tasks, and runs them sequentially using CrewAI.
    """
    # Configure logging to save logs to a file
    log_file = "app.log"
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file, mode='a', encoding='utf-8'),
            logging.StreamHandler()
        ]
    )

    logging.info("Логирование настроено. Логи будут сохраняться в файл app.log")

    # --- 1. Initialize SemanticSearch --- (Keep as is)
    try:
        print("Инициализация SemanticSearch...")
        semantic_search_engine = SemanticSearch.with_api_provider(api_key=API_KEY)
        print("Загрузка индекса SemanticSearch...")
        semantic_search_engine.load_index(
            df_path="data/faiss_index/corpus.csv",
            index_path="data/faiss_index/faiss.index",
            text_column="name"
        )
        print("SemanticSearch инициализирован и индекс загружен.")
    except Exception as e:
        logging.error(f"Ошибка при инициализации SemanticSearch: {e}")
        print(f"Ошибка при инициализации SemanticSearch: {e}")
        return

    # --- 2. Define the Question --- (Keep as is)
    question = input("Введите ваш вопрос: ")
    print(f"Вопрос к агентам: {question}")

    # --- 3. Define Agents and Shared Context ---
    print("Создание агентов...")
    shared_context = {} # Initialize shared context
    agent_times = {} # To store execution times

    # Instantiate agents using ProxyAgent for shared context management
    intent_agent = ProxyAgent(IntentRecognizerAgent(
        role="распознаватель намерений",
        goal="Определи намерение клиента из текста запроса.",
        backstory="Ты эксперт по классификации клиентских запросов в контакт-центре МТС."
    ), shared_context)

    emotion_agent = ProxyAgent(EmotionAnalyzerAgent(
        role="аналитик эмоций",
        goal="Оцени эмоциональное состояние клиента.",
        backstory="Ты специалист по анализу тональности клиентских сообщений."
    ), shared_context)

    knowledge_agent = ProxyAgent(KnowledgeExpertAgent(
        role="эксперт базы знаний",
        goal="Дай эталонный ответ для подсказки.",
        backstory="Ты работаешь с базой знаний МТС.",
        semantic_search_engine=semantic_search_engine
    ), shared_context)

    action_agent = ProxyAgent(ActionAdvisorAgent(
        role="советник по действиям",
        goal="Предложи действия для оператора.",
        backstory="Ты обучен помогать операторам решать проблемы клиентов."
    ), shared_context)

    summary_agent = ProxyAgent(SummaryGeneratorAgent(
        role="генератор резюме",
        goal="Сформируй резюме обращения для CRM.",
        backstory="Ты готовишь отчеты для CRM."
    ), shared_context)

    qa_agent = ProxyAgent(QualityControllerAgent(
        role="контролер качества",
        goal="Проверь соответствие ответа стандартам МТС и Кодексу.",
        backstory="Ты отвечаешь за качество коммуникации в поддержке МТС."
    ), shared_context)

    # --- 4. Define Tasks --- (Similar to tum.py)
    print("Определение задач...")
    tasks = [
        Task(
            description=f"Клиент обратился в поддержку.\nПоследний запрос клиента: \"{question}\"\nОцени эмоциональное состояние клиента.",
            expected_output="Эмоциональное состояние клиента.",
            agent=emotion_agent
        ),
        Task(
            description=f"Клиент обратился в поддержку.\nПоследний запрос клиента: \"{question}\"\nОпредели намерение клиента из текста запроса.",
            expected_output="Намерение клиента.",
            agent=intent_agent
        ),
        Task(
            description=f"Клиент обратился в поддержку.\nПоследний запрос клиента: \"{question}\"\nДай эталонный ответ для подсказки.",
            expected_output="Эталонный ответ.",
            agent=knowledge_agent
        ),
        Task(
            description=f"Клиент обратился в поддержку.\nПоследний запрос клиента: \"{question}\"\nПредложи, что должен сделать оператор.",
            expected_output="Рекомендации для оператора.",
            agent=action_agent
        ),
        Task(
            description=f"Клиент обратился в поддержку.\nПоследний запрос клиента: \"{question}\"\nСформируй краткое резюме обращения для CRM.",
            expected_output="Краткое резюме обращения.",
            agent=summary_agent
        ),
        Task(
            description=f"Клиент обратился в поддержку.\nПоследний запрос клиента: \"{question}\"\nПроверь, соответствует ли ответ стандартам общения.",
            expected_output="Оценка соответствия ответа стандартам.",
            agent=qa_agent
        )
    ]

    # --- 5. Create and Run Crew --- (Similar to tum.py)
    print("Создание и запуск Crew...")
    crew = Crew(
        agents=[emotion_agent, intent_agent, knowledge_agent, action_agent, summary_agent, qa_agent],
        tasks=tasks,
        process="sequential",
        verbose=False # Set to True for detailed CrewAI logs
    )

    total_start_time = time.time()
    try:
        # CrewAI's kickoff method runs the tasks
        # Note: CrewAI's kickoff doesn't directly return individual agent results like the old loop.
        # Results are stored in the shared_context by the ProxyAgents.
        crew.kickoff()

        # Calculate individual agent times (approximate, based on ProxyAgent logging if available or estimate)
        # For simplicity, we'll just show the total time here.
        # If precise timing per agent is needed, ProxyAgent needs modification or use CrewAI's verbose output.

        total_end_time = time.time()
        total_time = total_end_time - total_start_time

        # Log search results if they were captured
        if 'search_results' in shared_context:
            logging.info(f"Результаты поиска по запросу '{question}': {shared_context['search_results']}")
            print(f"Результаты поиска по запросу '{question}' записаны в лог")

        print(f"\n=== Результаты обработки запроса '{question}' ===")
        print(f"Намерение: {shared_context.get('intent', 'N/A')}")
        print(f"Эмоция: {shared_context.get('emotion', 'N/A')}")
        print(f"Эталонный ответ: {shared_context.get('reference_answer', 'N/A')}")
        print(f"Рекомендации для оператора: {shared_context.get('action', 'N/A')}")
        # 'user_answer' is not applicable here as it was for comparison in tum.py
        print(f"Резюме: {shared_context.get('summary', 'N/A')}")
        print(f"Контроль качества: {shared_context.get('qa', 'N/A')}")
        # Add other context items if needed, e.g., discount, alternative service
        print(f"Скидка предложена: {'Да' if shared_context.get('discount_offered', False) else 'Нет'}")
        print(f"Детали скидки: {shared_context.get('discount_details', 'N/A')}")
        print(f"Альтернативный сервис: {shared_context.get('alternative_service', 'N/A')}")

        print(f"\nОбщее время обработки: {total_time:.2f} секунд")
        logging.info(f"Обработка запроса '{question}' завершена за {total_time:.2f} секунд.")
        logging.info(f"Результаты: {shared_context}")
        

    except Exception as e:
        logging.error(f"Ошибка при выполнении Crew: {e}")
        print(f"Ошибка при выполнении Crew: {e}")

if __name__ == "__main__":
    # Rename the function call to match the new function name
    ask_all_agents()