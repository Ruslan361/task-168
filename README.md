## Project Quick Start with Make

Ensure you have the following installed:
[`Python 3.x`](https://www.python.org/)
[`GNU Make`](https://www.gnu.org/software/make/).

### Basic Usage

Open your terminal in the project root directory and use these commands:

* `make setup`
    * Sets up the project: creates a virtual environment (`.venv`), installs dependencies from `requirements.txt`, and
      prepares the `.env` file from `.env.example` (if `.env` doesn't exist). **Remember to edit `.env` afterwards!**

* `make run`
    * Runs the main application (`main.py`) using the Python interpreter from the virtual environment.

* `make freeze`
    * Updates the `requirements.txt` file with the currently installed packages and their versions from the virtual
      environment.

* `make clean`
    * Removes the virtual environment (`.venv`) and Python cache files (`__pycache__`, `.pyc`).
