VENV_DIR = .venv
PYTHON_CMD ?= python3

ifeq ($(OS), Windows_NT)
    VENV_BIN      = $(VENV_DIR)\Scripts
    PYTHON        = $(VENV_BIN)\python.exe
    PIP           = $(VENV_BIN)\pip.exe
    ACTIVATE_CMD  = $(VENV_DIR)\Scripts\activate.bat
    CP            = copy /Y
    RM            = rmdir /s /q
    CHECK_FILE    = if exist
    CHECK_NOT_FILE= if not exist
    CLEAN_PYCACHE = echo "Cleaning __pycache__ and *.pyc (Windows)..." & (for /d /r . %%d in (__pycache__) do if exist "%%d" rmdir /s /q "%%d" 2>nul) & (del /s /q /f *.pyc 2>nul)
else
    VENV_BIN      = $(VENV_DIR)/bin
    PYTHON        = $(VENV_BIN)/python
    PIP           = $(VENV_BIN)/pip
    ACTIVATE_CMD  = source $(VENV_DIR)/bin/activate
    CP            = cp
    RM            = rm -rf
    CHECK_FILE    = test -f
    CHECK_NOT_FILE= test ! -f
    CLEAN_PYCACHE = echo "Cleaning __pycache__ directories (Unix)..." && find . -type d -name "__pycache__" -exec $(RM) {} + ; \
                    echo "Cleaning .pyc files (Unix)..." && find . -type f -name "*.pyc" -delete
endif

.PHONY: all setup venv install env_setup run clean help

all: help

setup: venv install env_setup
	@echo "--------------------------------------------------"
	@echo "Project setup complete!"
	@echo "Virtual environment created in '$(VENV_DIR)'."
	@echo "Dependencies installed."
	@echo ".env file checked/created (remember to edit it!)."
	@echo "To activate venv manually, use: $(ACTIVATE_CMD)"
	@echo "To run the application, use: make run"
	@echo "--------------------------------------------------"

$(VENV_BIN)/activate:
	@echo "Creating virtual environment in '$(VENV_DIR)' using $(PYTHON_CMD)..."
	$(PYTHON_CMD) -m venv $(VENV_DIR)

venv: $(VENV_BIN)/activate
	@echo "Virtual environment is ready."

install: venv
	@echo "Upgrading pip..."
	$(PIP) install --upgrade pip
	@echo "Installing dependencies from requirements.txt..."
	$(PIP) install -r requirements.txt

env_setup:
	@$(CHECK_NOT_FILE) .env && ( \
		echo "Copying .env.example to .env..."; \
		$(CP) .env.example .env; \
		echo "IMPORTANT: Edit the .env file with your actual values!"; \
	) || ( \
		echo ".env file already exists."; \
	)

run: venv
	@echo "Running application using $(PYTHON)..."
	$(PYTHON) main.py

freeze: venv
	@echo "Updating requirements.txt with currently installed packages..."
	@$(PIP) freeze > requirements.txt
	@echo "requirements.txt updated."

clean: clean_venv clean_cache
	@echo "Project cleanup finished."

clean_venv:
	@echo "Removing virtual environment $(VENV_DIR)..."
	@$(CHECK_FILE) $(VENV_DIR)/pyvenv.cfg && $(RM) $(VENV_DIR) || echo "Virtual environment '$(VENV_DIR)' not found."

clean_cache:
	@$(CLEAN_PYCACHE)

help:
	@echo "Available make commands:"
	@echo "  make setup     - Full project setup (venv, install, env_setup)"
	@echo "  make venv      - Create/check virtual environment"
	@echo "  make install   - Install/update dependencies"
	@echo "  make env_setup - Prepare .env file from .env.example"
	@echo "  make run       - Run the main application (main.py)"
	@echo "  make clean     - Remove virtual environment and Python cache files"
	@echo "  make help      - Show this help message"
	@echo ""
	@echo "Note: 'make setup' runs venv, install, and env_setup."
