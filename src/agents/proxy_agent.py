# -*- coding: utf-8 -*-
"""
Proxy agent to integrate MwsAgent with CrewAI framework
"""

from crewai import Agent
# Import the base class from its new location
from agents.base_agent import BaseMwsAgent
from typing import Dict, Any

class ProxyAgent(Agent):
    """Proxy Agent to adapt MwsAgent for use with CrewAI framework"""

    class Config:
        # Allow extra fields if needed by specific agent implementations
        # passed via shared_context, although direct passing is preferred.
        extra = "allow"

    def __init__(self, mws_agent: BaseMwsAgent, shared_context: Dict[str, Any]):
        """
        Initialize ProxyAgent

        Args:
            mws_agent (BaseMwsAgent): An instance of a class derived from BaseMwsAgent.
            shared_context (Dict[str, Any]): Shared context dictionary passed between agents.
        """
        super().__init__(
            role=mws_agent.role,
            goal=mws_agent.goal,
            backstory=mws_agent.backstory,
            allow_delegation=False # Typically, proxy agents don't delegate
        )
        self.mws_agent = mws_agent
        self.shared_context = shared_context

    def execute_task(self, task, context: str | None = None, tools: list | None = None) -> str:
        """
        Execute task using the wrapped MwsAgent's run method.

        Args:
            task: The task object assigned by CrewAI. Contains task description and other metadata.
            context (str | None): Additional context provided by CrewAI (e.g., from previous tasks).
            tools (list | None): Tools available to the agent (not used by MwsAgent directly).

        Returns:
            str: The result from the MwsAgent's run method.
        """
        # Extract task description from the task object
        task_description = task.description if hasattr(task, 'description') else str(task)
        
        # Construct the input for the agent's run method.
        # Pass the task description, as it usually contains the query.
        # The specific agent's run method is responsible for parsing the actual query if needed.
        agent_input = task_description
        if context:
             # Corrected multiline f-string
             agent_input = (f"Context from previous steps: {context}\n"
                          f"---\n"
                          f"Task: {task_description}")

        # Call the run method of the specific MwsAgent instance
        result, _ = self.mws_agent.run(agent_input, self.shared_context)

        # CrewAI expects a string return
        return str(result)

# Note: The original execute_task signature might vary slightly depending
# on the CrewAI version. Adjusted to common parameters.
# Removed unused 'tools' parameter from the call signature if not needed.